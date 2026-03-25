import type { StandardSchemaV1 } from '@standard-schema/spec';
import { promptInteractiveFields } from '../feature/interactive.ts';
import { generateHelp } from '../output/help.ts';
import type {
  AnyPadroneCommand,
  AnyPadroneProgram,
  PadroneActionContext,
  PadroneEvalPreferences,
  PadronePlugin,
  PluginExecuteContext,
  PluginExecuteResult,
  PluginParseContext,
  PluginParseResult,
  PluginValidateContext,
  PluginValidateResult,
} from '../types/index.ts';
import { getVersion } from '../util/utils.ts';
import { type BuiltinAction, checkBuiltinCommands, extractColorFlag, extractConfigPath, resolveInherited } from './builtins.ts';
import { getCommandRuntime, resolveAllCommands, suggestSimilar } from './commands.ts';
import { ConfigError, RoutingError, signalExitCode, ValidationError } from './errors.ts';
import {
  createLazyIndicator,
  createProgress,
  noopIndicator,
  resolveProgressMessage,
  runPluginChain,
  wrapWithLifecycle,
} from './plugins.ts';
import { errorResult, hasInteractiveConfig, noop, outputValue, thenMaybe, warnIfUnexpectedAsync, withDrain } from './results.ts';
import type { PadroneProgressIndicator, PadroneSignal, ResolvedPadroneRuntime } from './runtime.ts';
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
  collectPluginsFn: (cmd: AnyPadroneCommand) => PadronePlugin<any, any>[];
};

/**
 * Collects plugins from the command's parent chain (root → ... → target).
 * Root/program plugins come first (outermost), target command's plugins last (innermost).
 */
export function collectPlugins(cmd: AnyPadroneCommand, rootCommand: AnyPadroneCommand): PadronePlugin<any, any>[] {
  const chain: PadronePlugin<any, any>[][] = [];
  let current: AnyPadroneCommand | undefined = cmd;
  while (current) {
    if (!current.parent) {
      if (rootCommand.plugins?.length) chain.unshift(rootCommand.plugins);
    } else {
      if (current.plugins?.length) chain.unshift(current.plugins);
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
 * Handles builtin commands (help, version, completion, man).
 * Returns the result if a builtin was handled, or null to continue normal execution.
 */
export function handleBuiltinAction(builtin: BuiltinAction, rootCommand: AnyPadroneCommand, runtime: ResolvedPadroneRuntime): any {
  if (builtin.type === 'help') {
    resolveAllCommands(rootCommand);
    const helpText = generateHelp(rootCommand, builtin.command ?? rootCommand, {
      detail: builtin.detail,
      format: builtin.format ?? runtime.format,
      theme: runtime.theme,
      all: builtin.all,
    });
    runtime.output(helpText);
    return withDrain({ command: rootCommand, args: undefined, result: helpText });
  }

  if (builtin.type === 'version') {
    const version = getVersion(rootCommand.version);
    runtime.output(version);
    return withDrain({ command: rootCommand, args: undefined, result: version });
  }

  if (builtin.type === 'completion') {
    resolveAllCommands(rootCommand);
    return import('../feature/completion.ts').then(({ detectShell, generateCompletionOutput, setupCompletions }) => {
      if (builtin.setup) {
        const shell = builtin.shell ?? detectShell();
        if (!shell) throw new Error('Could not detect shell. Specify one: completion bash --setup');
        const result = setupCompletions(rootCommand.name, shell);
        const message = `${result.updated ? 'Updated' : 'Added'} ${rootCommand.name} completions in ${result.file}`;
        runtime.output(message);
        return withDrain({ command: rootCommand, args: undefined, result: message });
      }
      const completionScript = generateCompletionOutput(rootCommand, builtin.shell);
      runtime.output(completionScript);
      return withDrain({ command: rootCommand, args: undefined, result: completionScript });
    });
  }

  if (builtin.type === 'man') {
    resolveAllCommands(rootCommand);
    return import('../docs/index.ts').then(({ setupManPages, removeManPages, generateDocs }) => {
      if (builtin.setup) {
        const result = setupManPages(rootCommand);
        const message = `${result.updated ? 'Updated' : 'Installed'} ${result.written.length} man page(s) in ${result.dir}`;
        runtime.output(message);
        return withDrain({ command: rootCommand, args: undefined, result: message });
      }
      if (builtin.remove) {
        const result = removeManPages(rootCommand);
        const message =
          result.removed.length > 0 ? `Removed ${result.removed.length} man page(s) from ${result.dir}` : 'No man pages found to remove.';
        runtime.output(message);
        return withDrain({ command: rootCommand, args: undefined, result: message });
      }
      const result = generateDocs(rootCommand, { format: 'man' });
      const manPage = result.pages[0]?.content ?? '';
      runtime.output(manPage);
      return withDrain({ command: rootCommand, args: undefined, result: manPage });
    });
  }

  return null;
}

/** Clean up an active progress indicator from the plugin state. */
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
) {
  const { rootCommand, parseCommandFn, collectPluginsFn } = ctx;
  const baseRuntime = getCommandRuntime(rootCommand);
  let runtime = evalOptions?.runtime
    ? Object.assign({}, baseRuntime, Object.fromEntries(Object.entries(evalOptions.runtime).filter(([, v]) => v !== undefined)))
    : baseRuntime;

  const colorFlag = extractColorFlag(resolvedInput);
  if (colorFlag) {
    runtime = {
      ...runtime,
      ...(colorFlag.disableColor ? { format: 'text' as const, theme: undefined } : { theme: colorFlag.theme }),
    };
  }

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

  // Check for built-in help/version/completion commands and flags (bypass plugins)
  const builtin = checkBuiltinCommands(resolvedInput, rootCommand);
  if (builtin) {
    cleanupSignal();
    const builtinResult = handleBuiltinAction(builtin, rootCommand, runtime);
    if (builtinResult != null) return builtinResult;
  }

  const createActionContext = (cmd: AnyPadroneCommand): Omit<PadroneActionContext, 'signal'> => ({
    runtime: getCommandRuntime(cmd),
    command: cmd,
    program: ctx.builder as any,
    progress: noopIndicator,
  });

  // Shared plugin state for this execution
  const state: Record<string, unknown> = {};
  const rootPlugins = rootCommand.plugins ?? [];

  const runPipeline = () => {
    // ── Phase 1: Parse ──────────────────────────────────────────────────
    const signal = abortController.signal;
    const parseCtx: PluginParseContext = { input: resolvedInput, command: rootCommand, state, signal };

    const coreParse = (): PluginParseResult => {
      const { command, rawArgs, args, unmatchedTerms } = parseCommandFn(parseCtx.input);

      // Default help: command with no action → show its help
      const hasSubcommands = command.commands && command.commands.length > 0;
      const hasSchema = command.argsSchema != null;
      if (!command.action && (hasSubcommands || !hasSchema) && unmatchedTerms.length === 0) {
        resolveAllCommands(rootCommand);
        const helpText = generateHelp(rootCommand, command, { format: runtime.format, theme: runtime.theme });
        runtime.output(helpText);
        return { command, rawArgs: { '~help': helpText } as Record<string, unknown>, positionalArgs: [] };
      }

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

    const parsedOrPromise = runPluginChain('parse', rootPlugins, parseCtx, coreParse);

    // ── Phases 2 & 3 chained after parse ────────────────────────────────
    const continueAfterParse = (parsed: PluginParseResult) => {
      const { command } = parsed;
      const commandPlugins = collectPluginsFn(command);

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
      const validateCtx: PluginValidateContext = {
        command,
        rawArgs: parsed.rawArgs,
        positionalArgs: parsed.positionalArgs,
        state,
        signal,
      };

      const coreValidate = (): PluginValidateResult | Promise<PluginValidateResult> => {
        // Determine interactivity
        let flagInteractive: boolean | undefined;
        if (hasInteractiveConfig(command.meta)) {
          if (validateCtx.rawArgs.interactive !== undefined) {
            flagInteractive = validateCtx.rawArgs.interactive !== false && validateCtx.rawArgs.interactive !== 'false';
            delete validateCtx.rawArgs.interactive;
          }
          if (validateCtx.rawArgs.i !== undefined) {
            flagInteractive = validateCtx.rawArgs.i !== false && validateCtx.rawArgs.i !== 'false';
            delete validateCtx.rawArgs.i;
          }
        }

        // Strip --color / --no-color from rawArgs (handled globally)
        delete validateCtx.rawArgs.color;
        delete validateCtx.rawArgs['no-color'];

        const runtimeDefault: boolean | undefined =
          runtime.interactive === 'forced' ? true : runtime.interactive === 'disabled' ? false : undefined;
        const effectiveInteractive: boolean | undefined = flagInteractive ?? evalOptions?.interactive ?? runtimeDefault;
        const commandUsesStdin = !!command.meta?.stdin;
        const stdinIsPiped =
          commandUsesStdin && (runtime.stdin ? !runtime.stdin.isTTY : typeof process !== 'undefined' && process.stdin?.isTTY !== true);
        const interactivitySuppressed =
          runtime.interactive === 'unsupported' || effectiveInteractive === false || (stdinIsPiped && effectiveInteractive !== true);
        const forceInteractive = !interactivitySuppressed && effectiveInteractive === true;

        // Extract config file path from --config or -c flag
        const configPath = extractConfigPath(parseCtx.input);

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
        ): PluginValidateResult | Promise<PluginValidateResult> => {
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
              const checkForProvidedFieldErrors = (result: StandardSchemaV1.Result<unknown>): PluginValidateResult | undefined => {
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

        const continueWithPrompt = (preprocessedArgs: Record<string, unknown>): PluginValidateResult | Promise<PluginValidateResult> => {
          const willPrompt = !interactivitySuppressed && runtime.prompt && hasInteractiveConfig(command.meta);
          const afterInteractive = willPrompt
            ? promptInteractiveFields(preprocessedArgs, command, runtime, forceInteractive || undefined)
            : preprocessedArgs;

          return thenMaybe(afterInteractive, (filledArgs) => {
            const validated = validateCommandArgs(command, filledArgs);
            return thenMaybe(validated, (v) => v as PluginValidateResult);
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

      const validatedOrPromise = runPluginChain('validate', commandPlugins, validateCtx, coreValidate);

      // ── Phase 3: Execute (or handle validation errors) ──────────────
      const continueAfterValidate = (v: PluginValidateResult) => {
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

        const executeCtx: PluginExecuteContext = { command, args: v.args, state, signal };

        const coreExecute = (): PluginExecuteResult => {
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

        const executedOrPromise = runPluginChain('execute', commandPlugins, executeCtx, coreExecute);

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
      rootPlugins,
      rootCommand,
      state,
      resolvedInput,
      runPipeline,
      (result) => withDrain({ command: rootCommand, args: undefined, argsResult: undefined, result }),
      abortController.signal,
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
