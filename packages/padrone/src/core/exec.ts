import type { StandardSchemaV1 } from '@standard-schema/spec';
import { promptInteractiveFields } from '../feature/interactive.ts';
import { generateHelp } from '../output/help.ts';
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
  PadroneInterceptor,
} from '../types/index.ts';
import { resolveInherited } from './builtins.ts';
import { getCommandRuntime, resolveAllCommands, resolveCommand, suggestSimilar } from './commands.ts';
import { ConfigError, RoutingError, signalExitCode, ValidationError } from './errors.ts';
import {
  createLazyIndicator,
  createProgress,
  noopIndicator,
  resolveProgressMessage,
  runInterceptorChain,
  wrapWithLifecycle,
} from './interceptors.ts';
import { errorResult, hasInteractiveConfig, noop, outputValue, thenMaybe, warnIfUnexpectedAsync, withDrain } from './results.ts';
import type { PadroneProgressIndicator, PadroneSignal } from './runtime.ts';
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
  collectInterceptorsFn: (cmd: AnyPadroneCommand) => PadroneInterceptor<any, any>[];
};

/**
 * Collects interceptors from the command's parent chain (root → ... → target).
 * Root/program interceptors come first (outermost), target command's interceptors last (innermost).
 */
export function collectInterceptors(cmd: AnyPadroneCommand, rootCommand: AnyPadroneCommand): PadroneInterceptor<any, any>[] {
  const chain: PadroneInterceptor<any, any>[][] = [];
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

/** Clean up an active progress indicator from the interceptor state. */
function cleanupProgressIndicator(state: Record<string, unknown>, resultOrError: unknown, isError: boolean) {
  const indicator = state._progress as PadroneProgressIndicator | undefined;
  if (!indicator) return;

  const hasProgressConfig = '_progressMsg' in state;
  if (!hasProgressConfig) {
    indicator.stop();
  } else if (isError) {
    const fallback = resultOrError instanceof Error ? resultOrError.message : String(resultOrError);
    const { message: errorMsg, indicator: errorIcon } = resolveProgressMessage(state._progressError, resultOrError, fallback);
    indicator.fail(errorMsg, errorIcon !== undefined ? { indicator: errorIcon } : undefined);
  } else {
    const { message: successMsg, indicator: successIcon } = resolveProgressMessage(state._progressSuccess, resultOrError);
    indicator.succeed(successMsg, successIcon !== undefined ? { indicator: successIcon } : undefined);
  }
  (state._restoreOutput as (() => void) | undefined)?.();
  state._progress = undefined;
  state._restoreOutput = undefined;
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
  initialState?: Record<string, unknown>,
) {
  const { rootCommand, parseCommandFn, collectInterceptorsFn } = ctx;
  const baseRuntime = getCommandRuntime(rootCommand);
  const runtime = evalOptions?.runtime
    ? Object.assign({}, baseRuntime, Object.fromEntries(Object.entries(evalOptions.runtime).filter(([, v]) => v !== undefined)))
    : baseRuntime;

  // ── Signal handling ─────────────────────────────────────────────────
  const abortController = new AbortController();
  let receivedSignal: PadroneSignal | undefined;
  let lastSigintTime = 0;
  const DOUBLE_SIGINT_MS = 2000;

  const unsubscribeSignal = runtime.onSignal?.((sig) => {
    if (abortController.signal.aborted) {
      if (sig === 'SIGINT') {
        const elapsed = Date.now() - lastSigintTime;
        if (elapsed > 0 && elapsed < DOUBLE_SIGINT_MS) {
          if (typeof process !== 'undefined') process.exit(signalExitCode(sig));
        }
        lastSigintTime = Date.now();
      }
      return;
    }
    if (sig === 'SIGINT') lastSigintTime = Date.now();
    receivedSignal = sig;
    abortController.abort(sig);
  });

  const attachSignalInfo = <T extends Record<string, unknown>>(result: T): T => {
    if (receivedSignal) {
      (result as any).signal = receivedSignal;
      (result as any).exitCode = signalExitCode(receivedSignal);
    }
    return result;
  };

  const cleanupSignal = () => unsubscribeSignal?.();

  const tagErrorWithSignal = (err: unknown) => {
    if (receivedSignal && err instanceof Error) {
      (err as any)._padroneSignal = receivedSignal;
      (err as any)._padroneExitCode = signalExitCode(receivedSignal);
    }
  };

  const finalizeResult = (r: unknown) => {
    cleanupSignal();
    return attachSignalInfo(r as Record<string, unknown>);
  };

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

  const createActionContext = (cmd: AnyPadroneCommand): Omit<PadroneActionContext, 'signal'> => ({
    runtime: getCommandRuntime(cmd),
    command: cmd,
    program: ctx.builder as any,
    progress: noopIndicator,
    context: resolveContext(cmd),
  });

  // Shared interceptor state for this execution
  const state: Record<string, unknown> = { ...initialState };
  // Internal keys are non-enumerable so they don't leak into user-facing state spreads
  Object.defineProperty(state, '_execMode', { value: true, writable: true });
  Object.defineProperty(state, '_program', { value: ctx.builder, writable: true });
  const rootInterceptors = rootCommand.interceptors ?? [];

  const runPipeline = () => {
    // ── Phase 1: Parse ──────────────────────────────────────────────────
    const signal = abortController.signal;
    // Start-phase interceptors may override input via state._input
    const effectiveInput = (state._input as string | undefined) ?? resolvedInput;
    const parseCtx: InterceptorParseContext = { input: effectiveInput, command: rootCommand, state, signal, context: initialContext };

    const coreParse = (): InterceptorParseResult => {
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

          if (errorMode === 'hard') {
            runtime.error(errorMsg);
            if (suggestions.length > 0) {
              const visibleCommands = (sourceCmd.commands ?? []).filter((c) => !c.hidden && c.name);
              if (visibleCommands.length > 0) {
                const cmdList = visibleCommands.map((c) => c.name).join(', ');
                runtime.output(`\nAvailable commands: ${cmdList}`);
              }
            } else {
              resolveAllCommands(rootCommand);
              const helpText = generateHelp(rootCommand, isRootCommand ? rootCommand : command, {
                format: runtime.format,
                theme: runtime.theme,
              });
              runtime.error(helpText);
            }
            throw new RoutingError(errorMsg, { suggestions, command: command.path || command.name });
          }

          throw new RoutingError(errorMsg, { suggestions, command: command.path || command.name });
        }
      }

      return { command, rawArgs, positionalArgs: args };
    };

    const parsedOrPromise = runInterceptorChain('parse', rootInterceptors, parseCtx, coreParse);

    // ── Phases 2 & 3 chained after parse ────────────────────────────────
    const continueAfterParse = (parsed: InterceptorParseResult) => {
      const { command } = parsed;
      const commandInterceptors = collectInterceptorsFn(command);

      if (parsed.rawArgs['~help']) {
        return { command, args: undefined, result: parsed.rawArgs['~help'] } as any;
      }

      // ── Auto-progress: start before validation ───────────────────────
      const progressConfig = command.progress;
      if (progressConfig && runtime.progress) {
        const isObj = typeof progressConfig === 'object';
        const defaultMsg = typeof progressConfig === 'string' ? progressConfig : `Running ${command.name}...`;
        const progressMsg = isObj ? (progressConfig.progress ?? defaultMsg) : defaultMsg;
        const validationMsg = isObj ? (progressConfig.validation ?? '') : '';
        state._progressSuccess = isObj ? progressConfig.success : undefined;
        state._progressError = isObj ? progressConfig.error : undefined;
        state._progressMsg = progressMsg;
        state._progressValidationMsg = validationMsg || undefined;
        const spinnerConfig = isObj ? progressConfig.spinner : undefined;
        const progressOptions = spinnerConfig !== undefined ? { spinner: spinnerConfig } : undefined;
        const indicator = createProgress(runtime, validationMsg || progressMsg, progressOptions);
        state._progress = indicator;

        const originalOutput = runtime.output;
        const originalError = runtime.error;
        runtime.output = (...args: unknown[]) => {
          indicator.pause();
          originalOutput(...args);
          indicator.resume();
        };
        runtime.error = (text: string) => {
          indicator.pause();
          originalError(text);
          indicator.resume();
        };
        state._restoreOutput = () => {
          runtime.output = originalOutput;
          runtime.error = originalError;
        };
      }

      // ── Phase 2: Validate ───────────────────────────────────────────
      const validateCtx: InterceptorValidateContext = {
        command,
        rawArgs: parsed.rawArgs,
        positionalArgs: parsed.positionalArgs,
        state,
        signal,
        context: resolveContext(command),
      };

      const coreValidate = (): InterceptorValidateResult | Promise<InterceptorValidateResult> => {
        // Determine interactivity (flag may have been extracted by the interactive extension)
        const flagInteractive = state._interactive as boolean | undefined;

        const runtimeDefault: boolean | undefined =
          runtime.interactive === 'forced' ? true : runtime.interactive === 'disabled' ? false : undefined;
        const effectiveInteractive: boolean | undefined = flagInteractive ?? evalOptions?.interactive ?? runtimeDefault;
        const commandUsesStdin = !!command.meta?.stdin;
        const stdinIsPiped =
          commandUsesStdin && (runtime.stdin ? !runtime.stdin.isTTY : typeof process !== 'undefined' && process.stdin?.isTTY !== true);
        const interactivitySuppressed =
          runtime.interactive === 'unsupported' || effectiveInteractive === false || (stdinIsPiped && effectiveInteractive !== true);
        const forceInteractive = !interactivitySuppressed && effectiveInteractive === true;

        // Config file path (may have been extracted by the config extension)
        const configPath = state._configPath as string | undefined;

        const effectiveConfigFiles = resolveInherited(command, 'configFiles') as string[] | undefined;
        const configSchema = resolveInherited(command, 'configSchema');
        const envSchema = resolveInherited(command, 'envSchema');

        // Determine config data
        let configData: Record<string, unknown> | undefined;
        if (configPath) {
          configData = runtime.loadConfigFile(configPath);
        } else if (effectiveConfigFiles?.length) {
          const foundConfigPath = runtime.findFile(effectiveConfigFiles);
          if (foundConfigPath) configData = runtime.loadConfigFile(foundConfigPath) ?? configData;
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
        if (v.argsResult?.issues) {
          const getKnown = () => getKnownOptionNames(command);
          const allSuggestions = collectSuggestionsFromIssues(v.argsResult.issues, getKnown);
          const issueMessages = formatIssueMessages(v.argsResult.issues, command);

          if (errorMode === 'hard') {
            resolveAllCommands(rootCommand);
            const helpText = generateHelp(rootCommand, command, { format: runtime.format, theme: runtime.theme });
            runtime.error(`Validation error:\n${issueMessages}`);
            runtime.error(helpText);
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

        // Update auto-progress message from validation to execute phase
        const activeIndicator = state._progress as PadroneProgressIndicator | undefined;
        if (activeIndicator && state._progressMsg && state._progressValidationMsg) {
          activeIndicator.update(state._progressMsg as string);
        }

        const executeCtx: InterceptorExecuteContext = { command, args: v.args, state, signal, context: resolveContext(command) };

        const coreExecute = (): InterceptorExecuteResult => {
          const handler = command.action ?? noop;
          const actionCtx: PadroneActionContext = {
            ...createActionContext(command),
            runtime,
            progress: (state._progress as PadroneProgressIndicator) ?? createLazyIndicator(runtime, state),
            signal,
          };
          const result = handler(executeCtx.args as any, actionCtx);
          return { result };
        };

        const executedOrPromise = runInterceptorChain('execute', commandInterceptors, executeCtx, coreExecute);

        return thenMaybe(executedOrPromise, (e) => {
          const finalize = (result: unknown) => {
            cleanupProgressIndicator(state, result, false);

            const commandResult = withDrain({
              command: command as any,
              args: v.args,
              argsResult: v.argsResult,
              result,
            });

            if (command.autoOutput ?? evalOptions?.autoOutput ?? true) {
              const outputOrPromise = outputValue(result, runtime.output);
              if (outputOrPromise instanceof Promise) return outputOrPromise.then(() => commandResult);
            }

            return commandResult;
          };

          if (e.result instanceof Promise) {
            return e.result.then(finalize, (err: unknown) => {
              cleanupProgressIndicator(state, err, true);
              throw err;
            });
          }

          return finalize(e.result);
        });
      };

      return thenMaybe(warnIfUnexpectedAsync(validatedOrPromise, command), continueAfterValidate) as any;
    };

    return thenMaybe(parsedOrPromise, continueAfterParse) as any;
  };

  let lifecycleResult: any;
  try {
    lifecycleResult = wrapWithLifecycle(
      rootInterceptors,
      rootCommand,
      state,
      resolvedInput,
      runPipeline,
      (result) => withDrain({ command: rootCommand, args: undefined, argsResult: undefined, result }),
      abortController.signal,
      initialContext,
    );
  } catch (err) {
    cleanupSignal();
    tagErrorWithSignal(err);
    throw err;
  }

  if (lifecycleResult instanceof Promise) {
    return lifecycleResult.then(finalizeResult, (err: unknown) => {
      cleanupSignal();
      tagErrorWithSignal(err);
      throw err;
    }) as any;
  }
  return finalizeResult(lifecycleResult) as any;
}
