import type {
  AnyPadroneCommand,
  AnyPadroneProgram,
  InterceptorExecuteContext,
  InterceptorExecuteResult,
  InterceptorParseContext,
  InterceptorParseResult,
  InterceptorValidateContext,
  InterceptorValidateResult,
  PadroneActionContext,
  PadroneEvalPreferences,
  RegisteredInterceptor,
  ResolvedInterceptor,
} from '../types/index.ts';
import { getCommandRuntime } from './commands.ts';
import { RoutingError, ValidationError } from './errors.ts';
import { noopIndicator, resolveRegisteredInterceptors, runInterceptorChain, wrapWithLifecycle } from './interceptors.ts';
import { errorResult, noop, thenMaybe, warnIfUnexpectedAsync, withDrain } from './results.ts';
import { buildCommandArgs, formatIssueMessages, validateCommandArgs } from './validate.ts';

export type ExecContext = {
  rootCommand: AnyPadroneCommand;
  builder: AnyPadroneProgram;
  parseCommandFn: (input: string | undefined) => {
    command: AnyPadroneCommand;
    rawArgs: Record<string, unknown>;
    args: string[];
    unmatchedTerms: string[];
  };
  collectInterceptorsFn: (cmd: AnyPadroneCommand) => RegisteredInterceptor[];
};

/**
 * Collects registered interceptors from the command's parent chain (root → ... → target).
 * Root/program interceptors come first (outermost), target command's interceptors last (innermost).
 */
export function collectInterceptors(cmd: AnyPadroneCommand, rootCommand: AnyPadroneCommand): RegisteredInterceptor[] {
  const chain: RegisteredInterceptor[][] = [];
  let current: AnyPadroneCommand | undefined = cmd;
  while (current) {
    if (!current.parent) {
      if (rootCommand.interceptors?.length) chain.unshift(rootCommand.interceptors);
    } else {
      if (current.interceptors?.length) chain.unshift(current.interceptors);
    }
    current = current.parent;
  }
  return chain.flat();
}

/** Wraps an error into a result, preserving any signal info from the pipeline. */
export function errorResultWithSignal(err: unknown) {
  const result = errorResult(err);
  if (err && typeof err === 'object' && '_padroneSignal' in err) {
    (result as any).signal = (err as any)._padroneSignal;
    (result as any).exitCode = (err as any)._padroneExitCode;
  }
  return result;
}

/**
 * Core execution logic shared by eval() and cli().
 * errorMode controls validation error behavior:
 * - 'soft': return result with issues (eval behavior)
 * - 'hard': print error + help and throw (cli-without-input behavior)
 */
export function execCommand(
  resolvedInput: string | undefined,
  ctx: ExecContext,
  evalOptions?: PadroneEvalPreferences,
  errorMode: 'soft' | 'hard' = 'soft',
  caller: PadroneActionContext['caller'] = 'eval',
) {
  const { rootCommand, parseCommandFn, collectInterceptorsFn } = ctx;
  const baseRuntime = getCommandRuntime(rootCommand);
  const runtime = evalOptions?.runtime
    ? Object.assign({}, baseRuntime, Object.fromEntries(Object.entries(evalOptions.runtime).filter(([, v]) => v !== undefined)))
    : baseRuntime;

  // Inert signal — the signal extension overrides this via next({ signal }) in the start phase.
  const inertSignal = new AbortController().signal;

  // Pipeline state accumulated as phases complete — propagated to error/shutdown contexts.
  const pipelineState: { rawArgs?: Record<string, unknown>; positionalArgs?: string[]; args?: unknown } = {};

  const initialContext = evalOptions?.context;

  /** Resolve context by walking the command chain and applying transforms. */
  const resolveContext = (command: AnyPadroneCommand): unknown => {
    const chain: AnyPadroneCommand[] = [];
    let current: AnyPadroneCommand | undefined = command;
    while (current) {
      chain.unshift(current);
      current = current.parent;
    }
    let resolved = initialContext;
    for (const cmd of chain) {
      if (cmd.contextTransform) resolved = cmd.contextTransform(resolved);
    }
    return resolved;
  };

  // Factory resolution cache — ensures each factory is called at most once per execution,
  // so root interceptor closures are shared when they appear in both root and command chains.
  const factoryCache = new Map<RegisteredInterceptor, ResolvedInterceptor>();
  const rootRegistered = rootCommand.interceptors ?? [];
  const rootInterceptors = resolveRegisteredInterceptors(rootRegistered, factoryCache);

  const runPipeline = (signal: AbortSignal) => {
    // ── Phase 1: Parse ──────────────────────────────────────────────────
    const parseCtx: InterceptorParseContext = {
      input: resolvedInput,
      command: rootCommand,
      signal,
      context: initialContext,
      runtime,
      program: ctx.builder,
      caller,
    };

    const coreParse = (parseCtx: InterceptorParseContext): InterceptorParseResult => {
      const { command, rawArgs, args, unmatchedTerms } = parseCommandFn(parseCtx.input);

      // Reject unmatched terms when the matched command doesn't accept positional args
      if (unmatchedTerms.length > 0) {
        const hasPositionalConfig = command.meta?.positional && command.meta.positional.length > 0;
        if (!hasPositionalConfig) {
          const isRootCommand = command === rootCommand;
          const commandDisplayName = command.name || command.aliases?.[0] || command.path || '(default)';
          const errorMsg = isRootCommand
            ? `Unknown command: ${unmatchedTerms[0]}`
            : `Unexpected arguments for '${commandDisplayName}': ${unmatchedTerms.join(' ')}`;

          throw new RoutingError(errorMsg, { command: command.path || command.name });
        }
      }

      return { command, rawArgs, positionalArgs: args };
    };

    const parsedOrPromise = runInterceptorChain('parse', rootInterceptors, parseCtx, coreParse);

    // ── Phases 2 & 3 chained after parse ────────────────────────────────
    const continueAfterParse = (parsed: InterceptorParseResult) => {
      const { command } = parsed;
      pipelineState.rawArgs = parsed.rawArgs;
      pipelineState.positionalArgs = parsed.positionalArgs;
      const commandInterceptors = resolveRegisteredInterceptors(collectInterceptorsFn(command), factoryCache);

      // ── Phase 2: Validate ───────────────────────────────────────────
      const validateCtx: InterceptorValidateContext = {
        command,
        input: resolvedInput,
        rawArgs: parsed.rawArgs,
        positionalArgs: parsed.positionalArgs,
        signal,
        context: resolveContext(command),
        runtime,
        program: ctx.builder,
        caller,
        evalInteractive: evalOptions?.interactive,
      };

      const coreValidate = (validateCtx: InterceptorValidateContext): InterceptorValidateResult | Promise<InterceptorValidateResult> => {
        const preprocessedArgs = buildCommandArgs(validateCtx.command, validateCtx.rawArgs, validateCtx.positionalArgs);
        const validated = validateCommandArgs(validateCtx.command, preprocessedArgs);
        return thenMaybe(validated, (v) => v as InterceptorValidateResult);
      };

      const validatedOrPromise = runInterceptorChain('validate', commandInterceptors, validateCtx, coreValidate);

      // ── Phase 3: Execute (or handle validation errors) ──────────────
      const continueAfterValidate = (v: InterceptorValidateResult) => {
        pipelineState.args = v.args;
        if (v.argsResult?.issues) {
          if (errorMode === 'hard') {
            const issueMessages = formatIssueMessages(v.argsResult.issues);
            throw new ValidationError(`Validation error:\n${issueMessages}`, v.argsResult.issues as any, {
              command: command.path || command.name,
            });
          }

          return withDrain({
            command: command as any,
            args: undefined,
            argsResult: v.argsResult,
            result: undefined,
          });
        }

        const executeCtx: InterceptorExecuteContext = {
          command,
          input: resolvedInput,
          rawArgs: parsed.rawArgs,
          positionalArgs: parsed.positionalArgs,
          args: v.args,
          signal,
          context: resolveContext(command),
          runtime,
          program: ctx.builder,
          caller,
        };

        const coreExecute = (executeCtx: InterceptorExecuteContext): InterceptorExecuteResult => {
          const handler = command.action ?? noop;
          const effectiveRuntime = executeCtx.runtime;
          const actionCtx: PadroneActionContext = {
            runtime: effectiveRuntime,
            command: executeCtx.command,
            program: ctx.builder as any,
            progress: executeCtx.progress ?? noopIndicator,
            signal: executeCtx.signal,
            context: executeCtx.context,
            caller,
          };
          const result = handler(executeCtx.args as any, actionCtx);
          return { result };
        };

        const executedOrPromise = runInterceptorChain('execute', commandInterceptors, executeCtx, coreExecute);

        return thenMaybe(executedOrPromise, (e) => {
          const finalize = (result: unknown) =>
            withDrain({
              command: command as any,
              args: v.args,
              argsResult: v.argsResult,
              result,
            });

          if (e.result instanceof Promise) {
            return e.result.then(finalize);
          }

          return finalize(e.result);
        });
      };

      return thenMaybe(warnIfUnexpectedAsync(validatedOrPromise, command), continueAfterValidate) as any;
    };

    return thenMaybe(parsedOrPromise, continueAfterParse) as any;
  };

  return wrapWithLifecycle(
    rootInterceptors,
    rootCommand,
    resolvedInput,
    runPipeline,
    (result) => withDrain({ command: rootCommand, args: undefined, argsResult: undefined, result }),
    inertSignal,
    initialContext,
    runtime,
    ctx.builder,
    caller,
    pipelineState,
  ) as any;
}
