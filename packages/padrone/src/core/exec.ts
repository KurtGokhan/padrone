import type { StandardSchemaV1 } from '@standard-schema/spec';
import { promptInteractiveFields } from '../feature/interactive.ts';
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
import { resolveInherited } from './builtins.ts';
import { getCommandRuntime, resolveCommand, suggestSimilar } from './commands.ts';
import { ConfigError, RoutingError, ValidationError } from './errors.ts';
import { noopIndicator, resolveRegisteredInterceptors, runInterceptorChain, wrapWithLifecycle } from './interceptors.ts';
import { errorResult, hasInteractiveConfig, noop, thenMaybe, warnIfUnexpectedAsync, withDrain } from './results.ts';
import { collectSuggestionsFromIssues, enrichIssuesWithSuggestions, formatSuggestions } from './suggestions.ts';
import {
  buildCommandArgs,
  checkUnknownArgs,
  formatIssueMessages,
  getKnownOptionNames,
  readStdinData,
  validateCommandArgs,
} from './validate.ts';

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

          const candidateNames: string[] = [];
          const sourceCmd = isRootCommand ? rootCommand : command;
          if (sourceCmd.commands) {
            for (const cmd of sourceCmd.commands) {
              resolveCommand(cmd);
              if (!cmd.hidden) {
                candidateNames.push(cmd.name);
                if (cmd.aliases) candidateNames.push(...cmd.aliases);
              }
            }
          }

          const similarNames = suggestSimilar(unmatchedTerms[0]!, candidateNames);
          const suggestionText = formatSuggestions(similarNames);
          const suggestions = suggestionText ? [suggestionText] : [];
          const baseMsg = isRootCommand
            ? `Unknown command: ${unmatchedTerms[0]}`
            : `Unexpected arguments for '${commandDisplayName}': ${unmatchedTerms.join(' ')}`;
          const errorMsg = suggestionText ? `${baseMsg}\n\n  ${suggestionText}` : baseMsg;

          throw new RoutingError(errorMsg, { suggestions, command: command.path || command.name });
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
      };

      const coreValidate = (validateCtx: InterceptorValidateContext): InterceptorValidateResult | Promise<InterceptorValidateResult> => {
        // Determine interactivity (flag may have been set by the interactive extension via next() override)
        const flagInteractive = validateCtx.interactive;

        const runtimeDefault: boolean | undefined =
          runtime.interactive === 'forced' ? true : runtime.interactive === 'disabled' ? false : undefined;
        const effectiveInteractive: boolean | undefined = flagInteractive ?? evalOptions?.interactive ?? runtimeDefault;
        const commandUsesStdin = !!command.meta?.stdin;
        const stdinIsPiped =
          commandUsesStdin && (runtime.stdin ? !runtime.stdin.isTTY : typeof process !== 'undefined' && process.stdin?.isTTY !== true);
        const interactivitySuppressed =
          runtime.interactive === 'unsupported' || effectiveInteractive === false || (stdinIsPiped && effectiveInteractive !== true);
        const forceInteractive = !interactivitySuppressed && effectiveInteractive === true;

        const effectiveConfigFiles = resolveInherited(command, 'configFiles') as string[] | undefined;
        const configSchema = resolveInherited(command, 'configSchema');
        const envSchema = resolveInherited(command, 'envSchema');

        // Config data: may have been pre-loaded by the config extension (--config flag), or auto-detected
        let configData: Record<string, unknown> | undefined = validateCtx.configData;
        if (!configData && effectiveConfigFiles?.length) {
          const foundConfigPath = runtime.findFile(effectiveConfigFiles);
          if (foundConfigPath) configData = runtime.loadConfigFile(foundConfigPath);
        }

        // Step 1: Validate config data against schema
        const validateConfig = (): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> => {
          if (configData && configSchema) {
            const configValidated = configSchema['~standard'].validate(configData);
            return thenMaybe(configValidated, (result) => {
              if (result.issues) {
                const issueMessages = result.issues
                  .map((i: StandardSchemaV1.Issue) => `  - ${i.path?.join('.') || 'root'}: ${i.message}`)
                  .join('\n');
                throw new ConfigError(`Invalid config file:\n${issueMessages}`, { command: command.path || command.name });
              }
              return result.value as unknown as Record<string, unknown>;
            });
          }
          return configData;
        };

        // Step 2: Validate env vars
        const validateEnv = (): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> => {
          if (!envSchema) return undefined;
          const rawEnv = runtime.env();
          const envValidated = envSchema['~standard'].validate(rawEnv);
          return thenMaybe(envValidated, (result) => {
            if (!result.issues) return result.value as unknown as Record<string, unknown>;
            return undefined;
          });
        };

        // Step 3: Read stdin
        const readStdin = (): Record<string, unknown> | Promise<Record<string, unknown>> =>
          readStdinData(command, validateCtx.rawArgs, rootCommand);

        // Step 4: Preprocess, interactive prompt, and validate
        const finalizeValidation = (
          validatedConfigData: Record<string, unknown> | undefined,
          envData: Record<string, unknown> | undefined,
          stdinData: Record<string, unknown> | undefined,
        ): InterceptorValidateResult | Promise<InterceptorValidateResult> => {
          const preprocessedArgs = buildCommandArgs(command, validateCtx.rawArgs, validateCtx.positionalArgs, {
            stdinData,
            envData,
            configData: validatedConfigData,
          });

          const willPrompt = !interactivitySuppressed && runtime.prompt && hasInteractiveConfig(command.meta);
          if (willPrompt) {
            const unknowns = checkUnknownArgs(command, preprocessedArgs);
            if (unknowns.length > 0) {
              const issues: StandardSchemaV1.Issue[] = unknowns.map(({ key, suggestions }) => {
                const hint = formatSuggestions(suggestions, '--');
                return { path: [key], message: hint ? `Unknown option: "${key}". ${hint}` : `Unknown option: "${key}"` };
              });
              return { args: undefined, argsResult: { issues } as any };
            }

            if (command.argsSchema) {
              const providedKeys = new Set(Object.keys(preprocessedArgs).filter((k) => preprocessedArgs[k] !== undefined));
              const earlyCheck = command.argsSchema['~standard'].validate(preprocessedArgs);
              const checkForProvidedFieldErrors = (result: StandardSchemaV1.Result<unknown>): InterceptorValidateResult | undefined => {
                if (!result.issues) return undefined;
                const providedFieldIssues = result.issues.filter((issue) => {
                  const rootKey = issue.path?.[0];
                  return rootKey !== undefined && providedKeys.has(String(rootKey));
                });
                if (providedFieldIssues.length > 0) return { args: undefined, argsResult: { issues: providedFieldIssues } as any };
                return undefined;
              };
              const earlyResult = thenMaybe(earlyCheck, (result) => checkForProvidedFieldErrors(result) ?? undefined);
              if (earlyResult instanceof Promise) {
                return earlyResult.then((err) => (err ? err : continueWithPrompt(preprocessedArgs)));
              }
              if (earlyResult) return earlyResult;
            }
          }

          return continueWithPrompt(preprocessedArgs);
        };

        const continueWithPrompt = (
          preprocessedArgs: Record<string, unknown>,
        ): InterceptorValidateResult | Promise<InterceptorValidateResult> => {
          const willPrompt = !interactivitySuppressed && runtime.prompt && hasInteractiveConfig(command.meta);
          const afterInteractive = willPrompt
            ? promptInteractiveFields(preprocessedArgs, command, runtime, forceInteractive || undefined)
            : preprocessedArgs;

          return thenMaybe(afterInteractive, (filledArgs) => {
            const validated = validateCommandArgs(command, filledArgs);
            return thenMaybe(validated, (v) => v as InterceptorValidateResult);
          });
        };

        // Chain: config → env → stdin → validate
        const validatedConfig = validateConfig();
        return thenMaybe(validatedConfig, (cfgData) => {
          const validatedEnv = validateEnv();
          return thenMaybe(validatedEnv, (envData) => {
            const stdinDataOrPromise = readStdin();
            return thenMaybe(stdinDataOrPromise, (stdinData) => {
              const hasStdinData = Object.keys(stdinData).length > 0;
              return finalizeValidation(cfgData, envData, hasStdinData ? stdinData : undefined);
            });
          });
        });
      };

      const validatedOrPromise = runInterceptorChain('validate', commandInterceptors, validateCtx, coreValidate);

      // ── Phase 3: Execute (or handle validation errors) ──────────────
      const continueAfterValidate = (v: InterceptorValidateResult) => {
        pipelineState.args = v.args;
        if (v.argsResult?.issues) {
          const getKnown = () => getKnownOptionNames(command);

          if (errorMode === 'hard') {
            const allSuggestions = collectSuggestionsFromIssues(v.argsResult.issues, getKnown);
            const issueMessages = formatIssueMessages(v.argsResult.issues, command);
            throw new ValidationError(`Validation error:\n${issueMessages}`, v.argsResult.issues as any, {
              suggestions: allSuggestions,
              command: command.path || command.name,
            });
          }

          // Soft mode: enrich issues with suggestions and return
          const enrichedIssues = enrichIssuesWithSuggestions(v.argsResult.issues, getKnown);
          return withDrain({
            command: command as any,
            args: undefined,
            argsResult: { ...v.argsResult, issues: enrichedIssues },
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
