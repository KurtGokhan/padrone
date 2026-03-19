import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Schema } from 'ai';
import { coerceArgs, detectUnknownArgs, extractSchemaMetadata, parsePositionalConfig, parseStdinConfig, preprocessArgs } from './args.ts';
import {
  commandSymbol,
  findCommandByName,
  getCommandRuntime,
  hasInteractiveConfig,
  isAsyncBranded,
  makeThenable,
  mergeCommands,
  noop,
  outputValue,
  repathCommandTree,
  runPluginChain,
  suggestSimilar,
  thenMaybe,
  warnIfUnexpectedAsync,
  wrapWithLifecycle,
} from './command-utils.ts';
import type { ShellType } from './completion.ts';
import { ConfigError, RoutingError, ValidationError } from './errors.ts';
import { generateHelp } from './help.ts';
import { promptInteractiveFields } from './interactive.ts';
import { getNestedValue, parseCliInputToParts, setNestedValue } from './parse.ts';
import { createReplIterator } from './repl-loop.ts';
import { resolveStdin } from './runtime.ts';
import type {
  AnyPadroneCommand,
  AnyPadroneProgram,
  PadroneActionContext,
  PadroneAPI,
  PadroneCommand,
  PadroneEvalPreferences,
  PadronePlugin,
  PadroneProgram,
  PadroneReplPreferences,
  PluginExecuteContext,
  PluginExecuteResult,
  PluginParseContext,
  PluginParseResult,
  PluginValidateContext,
  PluginValidateResult,
} from './types.ts';
import { getVersion } from './utils.ts';
import { createWrapHandler } from './wrap.ts';

export { asyncSchema, buildReplCompleter } from './command-utils.ts';

export function createPadrone<TProgramName extends string>(name: TProgramName): PadroneProgram<TProgramName, '', ''> {
  return createPadroneBuilder({ name, path: '', commands: [] } as any) as unknown as PadroneProgram<TProgramName, '', ''>;
}

export function createPadroneBuilder<TBuilder extends PadroneProgram = PadroneProgram>(
  inputCommand: AnyPadroneCommand,
): TBuilder & { [commandSymbol]: AnyPadroneCommand } {
  // Re-parent direct subcommands so getCommandRuntime walks to the current root,
  // not a stale parent from before .runtime()/.configure()/etc.
  const existingCommand =
    inputCommand.commands?.length && inputCommand.commands.some((c) => c.parent && c.parent !== inputCommand)
      ? {
          ...inputCommand,
          commands: inputCommand.commands.map((c) => (c.parent && c.parent !== inputCommand ? { ...c, parent: inputCommand } : c)),
        }
      : inputCommand;

  /** Creates the action context passed to command handlers. References `builder` which is defined later but only called at runtime. */
  const createActionContext = (cmd: AnyPadroneCommand): PadroneActionContext => ({
    runtime: getCommandRuntime(cmd),
    command: cmd,
    program: builder as any,
  });

  const find: AnyPadroneProgram['find'] = (command) => {
    if (typeof command !== 'string') return findCommandByName(command.path, existingCommand.commands) as any;
    return findCommandByName(command, existingCommand.commands) as any;
  };

  /**
   * Parses CLI input to find the command and extract raw arguments without validation.
   */
  const parseCommand = (input: string | undefined) => {
    input ??= getCommandRuntime(existingCommand).argv().join(' ') || undefined;
    if (!input) {
      // No input: check for default '' command
      const defaultCommand = findCommandByName('', existingCommand.commands);
      if (defaultCommand) {
        return { command: defaultCommand, rawArgs: {} as Record<string, unknown>, args: [] as string[], unmatchedTerms: [] as string[] };
      }
      return { command: existingCommand, rawArgs: {} as Record<string, unknown>, args: [] as string[], unmatchedTerms: [] as string[] };
    }

    const parts = parseCliInputToParts(input);

    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'arg').map((p) => p.value);

    let curCommand: AnyPadroneCommand | undefined = existingCommand;
    let unmatchedTerms: string[] = [];

    // If the first term is the program name, skip it
    if (terms[0] === existingCommand.name) terms.shift();

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i] || '';
      const found = findCommandByName(term, curCommand.commands);

      if (found) {
        curCommand = found;
      } else {
        unmatchedTerms = terms.slice(i);
        args.unshift(...unmatchedTerms);
        break;
      }
    }

    // If no unmatched terms remain, check for a default '' subcommand.
    // This handles both the root level (no input) and nested commands (e.g., "advanced" with a '' subcommand).
    if (unmatchedTerms.length === 0 && curCommand.commands?.length) {
      const defaultCommand = findCommandByName('', curCommand.commands);
      if (defaultCommand) {
        curCommand = defaultCommand;
      }
    }

    if (!curCommand) return { command: existingCommand, rawArgs: {} as Record<string, unknown>, args, unmatchedTerms };

    // Extract argument metadata from the nested arguments object in meta
    const argsMeta = curCommand.meta?.fields;
    const schemaMetadata = curCommand.argsSchema
      ? extractSchemaMetadata(curCommand.argsSchema, argsMeta, curCommand.meta?.autoAlias)
      : { flags: {}, aliases: {} };
    const { flags, aliases } = schemaMetadata;

    // Get array arguments from schema (arrays are always variadic)
    const arrayArguments = new Set<string>();
    if (curCommand.argsSchema) {
      try {
        const jsonSchema = curCommand.argsSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
        if (jsonSchema.type === 'object' && jsonSchema.properties) {
          for (const [key, prop] of Object.entries(jsonSchema.properties as Record<string, any>)) {
            if (prop?.type === 'array') arrayArguments.add(key);
          }
        }
      } catch {
        // Ignore schema parsing errors
      }
    }

    const argParts = parts.filter((p) => p.type === 'named' || p.type === 'alias');
    const rawArgs: Record<string, unknown> = {};

    for (const arg of argParts) {
      // Resolve flags (single-char, from alias parts: -v) and aliases (multi-char, from named parts: --dry-run)
      let key: string[];
      if (arg.type === 'alias' && arg.key.length === 1 && flags[arg.key[0]!]) {
        key = [flags[arg.key[0]!]!];
      } else if (arg.type === 'named' && arg.key.length === 1 && aliases[arg.key[0]!]) {
        key = [aliases[arg.key[0]!]!];
      } else {
        key = arg.key;
      }

      const rootKey = key[0]!;

      // Handle negated boolean arguments (--no-verbose)
      if (arg.type === 'named' && arg.negated) {
        setNestedValue(rawArgs, key, false);
        continue;
      }

      const value = arg.value ?? true;

      // Handle array arguments - accumulate values into arrays (arrays are always variadic)
      if (arrayArguments.has(rootKey)) {
        const existing = getNestedValue(rawArgs, key);
        if (existing !== undefined) {
          if (Array.isArray(existing)) {
            if (Array.isArray(value)) {
              existing.push(...value);
            } else {
              existing.push(value);
            }
          } else {
            if (Array.isArray(value)) {
              setNestedValue(rawArgs, key, [existing, ...value]);
            } else {
              setNestedValue(rawArgs, key, [existing, value]);
            }
          }
        } else {
          setNestedValue(rawArgs, key, Array.isArray(value) ? value : [value]);
        }
      } else {
        setNestedValue(rawArgs, key, value);
      }
    }

    return { command: curCommand, rawArgs, args, unmatchedTerms };
  };

  /**
   * Preprocesses raw arguments: applies env/config values and maps positional arguments.
   * Also performs auto-coercion (string→number/boolean) and unknown arg detection.
   */
  const buildCommandArgs = (
    command: AnyPadroneCommand,
    rawArgs: Record<string, unknown>,
    args: string[],
    context?: { stdinData?: Record<string, unknown>; envData?: Record<string, unknown>; configData?: Record<string, unknown> },
  ): Record<string, unknown> => {
    // Apply preprocessing (stdin, env, and config bindings)
    let preprocessedArgs = preprocessArgs(rawArgs, {
      flags: {}, // Already resolved in parseCommand
      aliases: {}, // Already resolved in parseCommand
      stdinData: context?.stdinData,
      envData: context?.envData,
      configData: context?.configData,
    });

    // Parse positional configuration
    const positionalConfig = command.meta?.positional ? parsePositionalConfig(command.meta.positional) : [];

    // Map positional arguments to their named arguments
    if (positionalConfig.length > 0) {
      let argIndex = 0;
      for (let i = 0; i < positionalConfig.length; i++) {
        const { name, variadic } = positionalConfig[i]!;
        if (argIndex >= args.length) break;

        if (variadic) {
          // Collect remaining args (but leave room for non-variadic args after)
          const remainingPositionals = positionalConfig.slice(i + 1);
          const nonVariadicAfter = remainingPositionals.filter((p) => !p.variadic).length;
          const variadicEnd = args.length - nonVariadicAfter;
          preprocessedArgs[name] = args.slice(argIndex, variadicEnd);
          argIndex = variadicEnd;
        } else if (i === positionalConfig.length - 1 && args.length > argIndex + 1) {
          // Last non-variadic positional: join all remaining tokens (e.g. `-- Hello world` → "Hello world")
          preprocessedArgs[name] = args.slice(argIndex).join(' ');
          argIndex = args.length;
        } else {
          preprocessedArgs[name] = args[argIndex];
          argIndex++;
        }
      }
    }

    // Auto-coerce CLI string values to match schema types (string→number, string→boolean)
    if (command.argsSchema) {
      preprocessedArgs = coerceArgs(preprocessedArgs, command.argsSchema);
    }

    return preprocessedArgs;
  };

  /**
   * Detects unknown options in args that aren't defined in the schema.
   * Returns unknown key info with suggestions, or empty array if schema is loose.
   */
  const checkUnknownArgs = (
    command: AnyPadroneCommand,
    preprocessedArgs: Record<string, unknown>,
  ): { key: string; suggestion: string }[] => {
    if (!command.argsSchema) return [];

    const argsMeta = command.meta?.fields;
    const { flags, aliases } = extractSchemaMetadata(command.argsSchema, argsMeta, command.meta?.autoAlias);

    return detectUnknownArgs(preprocessedArgs, command.argsSchema, flags, aliases, suggestSimilar);
  };

  /**
   * Validates preprocessed arguments against the command's schema.
   * First checks for unknown args (strict by default), then runs schema validation.
   * Returns sync or async result depending on the schema's validate method.
   */
  const validateCommandArgs = (command: AnyPadroneCommand, preprocessedArgs: Record<string, unknown>) => {
    // Check for unknown args before schema validation (strict by default)
    const unknownArgs = checkUnknownArgs(command, preprocessedArgs);
    if (unknownArgs.length > 0) {
      const issues: StandardSchemaV1.Issue[] = unknownArgs.map(({ key, suggestion }) => ({
        path: [key],
        message: suggestion ? `Unknown option: "${key}". ${suggestion}` : `Unknown option: "${key}"`,
      }));
      return { args: undefined, argsResult: { issues } as any };
    }

    const argsParsed = command.argsSchema ? command.argsSchema['~standard'].validate(preprocessedArgs) : { value: preprocessedArgs };

    // Return undefined for args when there's no schema and no meaningful args
    const hasArgs = command.argsSchema || Object.keys(preprocessedArgs).length > 0;

    const buildResult = (parsed: StandardSchemaV1.Result<unknown>) => ({
      args: parsed.issues ? undefined : hasArgs ? (parsed.value as any) : undefined,
      argsResult: parsed as any,
    });

    return thenMaybe(argsParsed, buildResult);
  };

  /**
   * Preprocesses and validates raw arguments against the command's schema.
   * Returns sync or async result depending on the schema's validate method.
   */
  const validateArgs = (
    command: AnyPadroneCommand,
    rawArgs: Record<string, unknown>,
    args: string[],
    context?: { stdinData?: Record<string, unknown>; envData?: Record<string, unknown>; configData?: Record<string, unknown> },
  ) => {
    const preprocessedArgs = buildCommandArgs(command, rawArgs, args, context);
    return validateCommandArgs(command, preprocessedArgs);
  };

  const parse: AnyPadroneProgram['parse'] = (input) => {
    const state: Record<string, unknown> = {};

    // Parse phase (with plugins)
    const parseCtx: PluginParseContext = { input: input as string | undefined, command: existingCommand, state };
    const coreParse = (): PluginParseResult => {
      const { command, rawArgs, args } = parseCommand(parseCtx.input);
      return { command, rawArgs, positionalArgs: args };
    };

    // Parse phase: root plugins only
    const rootPlugins = existingCommand.plugins ?? [];
    const parsedOrPromise = runPluginChain('parse', rootPlugins, parseCtx, coreParse);

    const continueAfterParse = (parsed: PluginParseResult) => {
      const { command } = parsed;

      // Validate phase: collected from parent chain
      const commandPlugins = collectPlugins(command);
      const validateCtx: PluginValidateContext = {
        command,
        rawArgs: parsed.rawArgs,
        positionalArgs: parsed.positionalArgs,
        state,
      };

      const coreValidate = (): PluginValidateResult | Promise<PluginValidateResult> => {
        // Resolve env schema: command's own envSchema > inherited from parent/root
        const resolveEnvSchema = (cmd: AnyPadroneCommand): AnyPadroneCommand['envSchema'] => {
          if (cmd.envSchema !== undefined) return cmd.envSchema;
          if (cmd.parent) return resolveEnvSchema(cmd.parent);
          return undefined;
        };
        const envSchema = resolveEnvSchema(command);

        const readStdinForParse = (): Record<string, unknown> | Promise<Record<string, unknown>> => {
          const stdinConfig = command.meta?.stdin;
          if (!stdinConfig) return {};

          const { field, as } = parseStdinConfig(stdinConfig);

          // Skip if the field was already provided via CLI flags
          if (field in validateCtx.rawArgs && validateCtx.rawArgs[field] !== undefined) return {};

          const runtime = getCommandRuntime(existingCommand);
          const stdin = resolveStdin(runtime as any);
          if (!stdin) return {};

          if (as === 'lines') {
            return (async () => {
              const lines: string[] = [];
              for await (const line of stdin.lines()) {
                lines.push(line);
              }
              return { [field]: lines };
            })();
          }
          return stdin.text().then((text) => (text ? { [field]: text } : {}));
        };

        const finalize = (
          envData: Record<string, unknown> | undefined,
          stdinData: Record<string, unknown> | undefined,
        ): PluginValidateResult | Promise<PluginValidateResult> => {
          const validated = validateArgs(command, validateCtx.rawArgs, validateCtx.positionalArgs, { stdinData, envData });
          return thenMaybe(validated, (v) => v as PluginValidateResult);
        };

        let envData: Record<string, unknown> | undefined;
        const afterEnv = (envResult: Record<string, unknown> | undefined) => {
          const stdinDataOrPromise = readStdinForParse();
          return thenMaybe(stdinDataOrPromise, (stdinData) => {
            const hasStdinData = Object.keys(stdinData).length > 0;
            return finalize(envResult, hasStdinData ? stdinData : undefined);
          });
        };

        if (envSchema) {
          const runtime = getCommandRuntime(existingCommand);
          const rawEnv = runtime.env();
          const envValidated = envSchema['~standard'].validate(rawEnv);

          return thenMaybe(envValidated, (result) => {
            if (!result.issues) {
              envData = result.value as unknown as Record<string, unknown>;
            }
            return afterEnv(envData);
          });
        }

        return afterEnv(envData);
      };

      const validatedOrPromise = runPluginChain('validate', commandPlugins, validateCtx, coreValidate);

      return warnIfUnexpectedAsync(
        thenMaybe(validatedOrPromise, (v) => ({
          command: command as any,
          args: v.args,
          argsResult: v.argsResult,
        })),
        command,
      );
    };

    return makeThenable(thenMaybe(parsedOrPromise, continueAfterParse)) as any;
  };

  const stringify: AnyPadroneProgram['stringify'] = (command = '' as any, args) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new RoutingError(`Command "${command ?? ''}" not found`);

    const parts: string[] = [];

    if (commandObj.path) parts.push(commandObj.path);

    // Get positional config to determine which args are positional
    const positionalConfig = commandObj.meta?.positional ? parsePositionalConfig(commandObj.meta.positional) : [];
    const positionalNames = new Set(positionalConfig.map((p) => p.name));

    // Output positional arguments first in order
    if (args && typeof args === 'object') {
      for (const { name, variadic } of positionalConfig) {
        const value = (args as Record<string, unknown>)[name];
        if (value === undefined) continue;

        if (variadic && Array.isArray(value)) {
          for (const v of value) {
            const vStr = String(v);
            if (vStr.includes(' ')) parts.push(`"${vStr}"`);
            else parts.push(vStr);
          }
        } else {
          const argStr = String(value);
          if (argStr.includes(' ')) parts.push(`"${argStr}"`);
          else parts.push(argStr);
        }
      }

      // Helper to stringify a value with a given key prefix
      const stringifyValue = (key: string, value: unknown) => {
        if (value === undefined) return;

        if (typeof value === 'boolean') {
          if (value) parts.push(`--${key}`);
          else parts.push(`--no-${key}`);
        } else if (Array.isArray(value)) {
          // Handle variadic arguments - output each value separately
          for (const v of value) {
            const vStr = String(v);
            if (vStr.includes(' ')) parts.push(`--${key}="${vStr}"`);
            else parts.push(`--${key}=${vStr}`);
          }
        } else if (typeof value === 'object' && value !== null) {
          // Handle nested objects - convert to dot notation
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            stringifyValue(`${key}.${nestedKey}`, nestedValue);
          }
        } else if (typeof value === 'string') {
          if (value.includes(' ')) parts.push(`--${key}="${value}"`);
          else parts.push(`--${key}=${value}`);
        } else {
          parts.push(`--${key}=${value}`);
        }
      };

      // Output remaining arguments (non-positional)
      for (const [key, value] of Object.entries(args)) {
        if (value === undefined || positionalNames.has(key)) continue;
        stringifyValue(key, value);
      }
    }

    return parts.join(' ');
  };

  type DetailLevel = 'minimal' | 'standard' | 'full';
  type FormatLevel = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json' | 'auto';

  /**
   * Check if help, version, or completion flags/commands are present in the input.
   * Returns the appropriate action to take, or null if normal execution should proceed.
   */
  const checkBuiltinCommands = (
    input: string | undefined,
  ):
    | { type: 'help'; command?: AnyPadroneCommand; detail?: DetailLevel; format?: FormatLevel }
    | { type: 'version' }
    | { type: 'completion'; shell?: ShellType; setup?: boolean }
    | { type: 'repl'; scope?: string }
    | null => {
    if (!input) return null;

    const parts = parseCliInputToParts(input);
    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'named' || p.type === 'alias');

    // Helper to check if a key array matches a single key string
    const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

    // Check for --help, -h flags (these take precedence over commands)
    const hasHelpFlag = args.some((p) => (p.type === 'named' && keyIs(p.key, 'help')) || (p.type === 'alias' && keyIs(p.key, 'h')));

    // Extract detail level from --detail=<level> or -d <level>
    const getDetailLevel = (): DetailLevel | undefined => {
      for (const arg of args) {
        if (arg.type === 'named' && keyIs(arg.key, 'detail') && typeof arg.value === 'string') {
          if (arg.value === 'minimal' || arg.value === 'standard' || arg.value === 'full') {
            return arg.value;
          }
        }
        if (arg.type === 'alias' && keyIs(arg.key, 'd') && typeof arg.value === 'string') {
          if (arg.value === 'minimal' || arg.value === 'standard' || arg.value === 'full') {
            return arg.value;
          }
        }
      }
      return undefined;
    };
    const detail = getDetailLevel();

    // Extract format from --format=<value> or -f <value>
    const getFormat = (): FormatLevel | undefined => {
      const validFormats: FormatLevel[] = ['text', 'ansi', 'console', 'markdown', 'html', 'json', 'auto'];
      for (const arg of args) {
        if (arg.type === 'named' && keyIs(arg.key, 'format') && typeof arg.value === 'string') {
          if (validFormats.includes(arg.value as FormatLevel)) {
            return arg.value as FormatLevel;
          }
        }
        if (arg.type === 'alias' && keyIs(arg.key, 'f') && typeof arg.value === 'string') {
          if (validFormats.includes(arg.value as FormatLevel)) {
            return arg.value as FormatLevel;
          }
        }
      }
      return undefined;
    };
    const format = getFormat();

    // Check for --version, -v, -V flags
    const hasVersionFlag = args.some(
      (p) => (p.type === 'named' && keyIs(p.key, 'version')) || (p.type === 'alias' && (keyIs(p.key, 'v') || keyIs(p.key, 'V'))),
    );

    // If the first term is the program name, skip it
    const normalizedTerms = [...terms];
    if (normalizedTerms[0] === existingCommand.name) normalizedTerms.shift();

    // Check if user has defined 'help', 'version', or 'completion' commands (they take precedence)
    const userHelpCommand = findCommandByName('help', existingCommand.commands);
    const userVersionCommand = findCommandByName('version', existingCommand.commands);
    const userCompletionCommand = findCommandByName('completion', existingCommand.commands);

    // Check for 'help' command (only if user hasn't defined one)
    // Supports both 'help <command>' and '<command> help' forms
    if (!userHelpCommand && normalizedTerms[0] === 'help') {
      // help <command> - get help for specific command
      const commandName = normalizedTerms.slice(1).join(' ');
      const targetCommand = commandName ? findCommandByName(commandName, existingCommand.commands) : undefined;
      return { type: 'help', command: targetCommand, detail, format };
    }
    if (!userHelpCommand && normalizedTerms.length > 0 && normalizedTerms[normalizedTerms.length - 1] === 'help') {
      // <command> help - get help for specific command (trailing form)
      const commandTerms = normalizedTerms.slice(0, -1);
      // Walk the command tree to find the deepest matching command
      let targetCommand: AnyPadroneCommand | undefined;
      let current = existingCommand;
      for (const term of commandTerms) {
        const found = findCommandByName(term, current.commands);
        if (found) {
          targetCommand = found;
          current = found;
        } else {
          break;
        }
      }
      return { type: 'help', command: targetCommand, detail, format };
    }

    // Check for 'version' command (only if user hasn't defined one)
    if (!userVersionCommand && normalizedTerms[0] === 'version') {
      return { type: 'version' };
    }

    // Check for 'completion' command (only if user hasn't defined one)
    if (!userCompletionCommand && normalizedTerms[0] === 'completion') {
      const shellArg = normalizedTerms[1] as ShellType | undefined;
      const validShells: ShellType[] = ['bash', 'zsh', 'fish', 'powershell'];
      const shell = shellArg && validShells.includes(shellArg) ? shellArg : undefined;
      const setup = args.some((p) => p.type === 'named' && keyIs(p.key, 'setup'));
      return { type: 'completion', shell, setup };
    }

    // Handle help flag - find the command being requested
    if (hasHelpFlag) {
      // Filter out help-related terms and flags to find the target command
      const commandTerms = normalizedTerms.filter((t) => t !== 'help');
      const commandName = commandTerms.join(' ');
      const targetCommand = commandName ? findCommandByName(commandName, existingCommand.commands) : undefined;
      return { type: 'help', command: targetCommand, detail, format };
    }

    // Handle version flag (only for root command, i.e., no subcommand terms)
    if (hasVersionFlag && normalizedTerms.length === 0) {
      return { type: 'version' };
    }

    // Check for --repl flag
    const hasReplFlag = args.some((p) => p.type === 'named' && keyIs(p.key, 'repl'));
    if (hasReplFlag) {
      const scope = normalizedTerms.length > 0 ? normalizedTerms.join(' ') : undefined;
      return { type: 'repl', scope };
    }

    return null;
  };

  /**
   * Extract the config file path from --config=<path> or -c <path> flags.
   */
  const extractConfigPath = (input: string | undefined): string | undefined => {
    if (!input) return undefined;

    const parts = parseCliInputToParts(input);
    const args = parts.filter((p) => p.type === 'named' || p.type === 'alias');

    for (const arg of args) {
      if (arg.type === 'named' && arg.key.length === 1 && arg.key[0] === 'config' && typeof arg.value === 'string') {
        return arg.value;
      }
      if (arg.type === 'alias' && arg.key.length === 1 && arg.key[0] === 'c' && typeof arg.value === 'string') {
        return arg.value;
      }
    }
    return undefined;
  };

  /**
   * Core execution logic shared by eval() and cli().
   * errorMode controls validation error behavior:
   * - 'soft': return result with issues (eval behavior)
   * - 'hard': print error + help and throw (cli-without-input behavior)
   */
  const execCommand = (resolvedInput: string | undefined, evalOptions?: PadroneEvalPreferences, errorMode: 'soft' | 'hard' = 'soft') => {
    const baseRuntime = getCommandRuntime(existingCommand);
    const runtime = evalOptions?.runtime
      ? Object.assign({}, baseRuntime, Object.fromEntries(Object.entries(evalOptions.runtime).filter(([, v]) => v !== undefined)))
      : baseRuntime;

    // Check for built-in help/version/completion commands and flags (bypass plugins)
    const builtin = checkBuiltinCommands(resolvedInput);

    if (builtin) {
      if (builtin.type === 'help') {
        const helpText = generateHelp(existingCommand, builtin.command ?? existingCommand, {
          detail: builtin.detail,
          format: builtin.format ?? runtime.format,
        });
        runtime.output(helpText);
        return {
          command: existingCommand,
          args: undefined,
          result: helpText,
        } as any;
      }

      if (builtin.type === 'version') {
        const version = getVersion(existingCommand.version);
        runtime.output(version);
        return {
          command: existingCommand,
          args: undefined,
          result: version,
        } as any;
      }

      if (builtin.type === 'completion') {
        return import('./completion.ts').then(({ detectShell, generateCompletionOutput, setupCompletions }) => {
          if (builtin.setup) {
            const shell = builtin.shell ?? detectShell();
            if (!shell) {
              throw new Error('Could not detect shell. Specify one: completion bash --setup');
            }
            const result = setupCompletions(existingCommand.name, shell);
            const message = `${result.updated ? 'Updated' : 'Added'} ${existingCommand.name} completions in ${result.file}`;
            runtime.output(message);
            return {
              command: existingCommand,
              args: undefined,
              result: message,
            };
          }
          const completionScript = generateCompletionOutput(existingCommand, builtin.shell);
          runtime.output(completionScript);
          return {
            command: existingCommand,
            args: undefined,
            result: completionScript,
          };
        }) as any;
      }
    }

    // Shared plugin state for this execution
    const state: Record<string, unknown> = {};
    const rootPlugins = existingCommand.plugins ?? [];

    const runPipeline = () => {
      // ── Phase 1: Parse ──────────────────────────────────────────────────
      const parseCtx: PluginParseContext = { input: resolvedInput, command: existingCommand, state };

      const coreParse = (): PluginParseResult => {
        const { command, rawArgs, args, unmatchedTerms } = parseCommand(parseCtx.input);

        // Default help: command with no action → show its help when there's nothing to execute.
        const hasSubcommands = command.commands && command.commands.length > 0;
        const hasSchema = command.argsSchema != null;
        if (!command.action && (hasSubcommands || !hasSchema) && unmatchedTerms.length === 0) {
          const helpText = generateHelp(existingCommand, command, { format: runtime.format });
          runtime.output(helpText);
          return {
            command: command,
            rawArgs: { '~help': helpText } as Record<string, unknown>,
            positionalArgs: [],
          };
        }

        // Reject unmatched terms when the matched command doesn't accept positional args
        if (unmatchedTerms.length > 0) {
          const hasPositionalConfig = command.meta?.positional && command.meta.positional.length > 0;
          if (!hasPositionalConfig) {
            const isRootCommand = command === existingCommand;
            const commandDisplayName = command.name || command.aliases?.[0] || command.path || '(default)';

            // Collect candidate names for fuzzy suggestion
            const candidateNames: string[] = [];
            if (isRootCommand && existingCommand.commands) {
              for (const cmd of existingCommand.commands) {
                if (!cmd.hidden) {
                  candidateNames.push(cmd.name);
                  if (cmd.aliases) candidateNames.push(...cmd.aliases);
                }
              }
            } else if (command.commands) {
              for (const cmd of command.commands) {
                if (!cmd.hidden) {
                  candidateNames.push(cmd.name);
                  if (cmd.aliases) candidateNames.push(...cmd.aliases);
                }
              }
            }

            const suggestion = suggestSimilar(unmatchedTerms[0]!, candidateNames);
            const suggestions = suggestion ? [suggestion] : [];
            const baseMsg = isRootCommand
              ? `Unknown command: ${unmatchedTerms[0]}`
              : `Unexpected arguments for '${commandDisplayName}': ${unmatchedTerms.join(' ')}`;
            const errorMsg = suggestions.length ? `${baseMsg}\n\n  ${suggestions[0]}` : baseMsg;

            if (errorMode === 'hard') {
              runtime.error(errorMsg);
              // When we have a suggestion, show a compact single-line "Available commands" note
              // instead of the full help text to avoid overwhelming the user
              if (suggestions.length > 0) {
                const targetCmd = isRootCommand ? existingCommand : command;
                const visibleCommands = (targetCmd.commands ?? []).filter((c) => !c.hidden && c.name);
                if (visibleCommands.length > 0) {
                  const cmdList = visibleCommands.map((c) => c.name).join(', ');
                  runtime.output(`\nAvailable commands: ${cmdList}`);
                }
              } else {
                const helpText = generateHelp(existingCommand, isRootCommand ? existingCommand : command, { format: runtime.format });
                runtime.error(helpText);
              }
              throw new RoutingError(errorMsg, { suggestions, command: command.path || command.name });
            }

            // Soft mode: throw too — this is a routing error, not a validation issue
            throw new RoutingError(errorMsg, { suggestions, command: command.path || command.name });
          }
        }

        return { command, rawArgs, positionalArgs: args };
      };

      // Parse phase: root plugins only
      const parsedOrPromise = runPluginChain('parse', rootPlugins, parseCtx, coreParse);

      // ── Phases 2 & 3 chained after parse ────────────────────────────────
      const continueAfterParse = (parsed: PluginParseResult) => {
        const { command } = parsed;
        // Validate/execute: collected from parent chain
        const commandPlugins = collectPlugins(command);

        // Short-circuit: parse returned a help result
        if (parsed.rawArgs['~help']) {
          return {
            command: command,
            args: undefined,
            result: parsed.rawArgs['~help'],
          } as any;
        }

        // ── Phase 2: Validate ───────────────────────────────────────────
        const validateCtx: PluginValidateContext = {
          command,
          rawArgs: parsed.rawArgs,
          positionalArgs: parsed.positionalArgs,
          state,
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

          const runtimeDefault: boolean | undefined =
            runtime.interactive === 'forced' ? true : runtime.interactive === 'disabled' ? false : undefined;
          const effectiveInteractive: boolean | undefined = flagInteractive ?? evalOptions?.interactive ?? runtimeDefault;
          // Suppress interactive prompts when the command reads stdin — prompts share stdin which is already consumed/closed.
          const commandUsesStdin = !!command.meta?.stdin;
          const stdinIsPiped =
            commandUsesStdin && (runtime.stdin ? !runtime.stdin.isTTY : typeof process !== 'undefined' && process.stdin?.isTTY !== true);
          const interactivitySuppressed =
            runtime.interactive === 'unsupported' || effectiveInteractive === false || (stdinIsPiped && effectiveInteractive !== true);
          const forceInteractive = !interactivitySuppressed && effectiveInteractive === true;

          // Extract config file path from --config or -c flag
          const configPath = extractConfigPath(parseCtx.input);

          // Resolve config files: command's own configFiles > inherited from parent/root
          const resolveConfigFiles = (cmd: AnyPadroneCommand): string[] | undefined => {
            if (cmd.configFiles !== undefined) return cmd.configFiles;
            if (cmd.parent) return resolveConfigFiles(cmd.parent);
            return undefined;
          };
          const effectiveConfigFiles = resolveConfigFiles(command);

          // Resolve config schema: command's own configSchema > inherited from parent/root
          const resolveConfigSchema = (cmd: AnyPadroneCommand): AnyPadroneCommand['configSchema'] => {
            if (cmd.configSchema !== undefined) return cmd.configSchema;
            if (cmd.parent) return resolveConfigSchema(cmd.parent);
            return undefined;
          };
          const configSchema = resolveConfigSchema(command);

          // Resolve env schema: command's own envSchema > inherited from parent/root
          const resolveEnvSchema = (cmd: AnyPadroneCommand): AnyPadroneCommand['envSchema'] => {
            if (cmd.envSchema !== undefined) return cmd.envSchema;
            if (cmd.parent) return resolveEnvSchema(cmd.parent);
            return undefined;
          };
          const envSchema = resolveEnvSchema(command);

          // Determine config data: explicit --config flag > auto-discovered config
          let configData: Record<string, unknown> | undefined;
          if (configPath) {
            configData = runtime.loadConfigFile(configPath);
          } else if (effectiveConfigFiles?.length) {
            const foundConfigPath = runtime.findFile(effectiveConfigFiles);
            if (foundConfigPath) {
              configData = runtime.loadConfigFile(foundConfigPath) ?? configData;
            }
          }

          // Step 1: Validate config data against schema if provided
          const validateConfig = (): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> => {
            if (configData && configSchema) {
              const configValidated = configSchema['~standard'].validate(configData);
              return thenMaybe(configValidated, (result) => {
                if (result.issues) {
                  const issueMessages = result.issues
                    .map((i: StandardSchemaV1.Issue) => `  - ${i.path?.join('.') || 'root'}: ${i.message}`)
                    .join('\n');
                  throw new ConfigError(`Invalid config file:\n${issueMessages}`, {
                    command: command.path || command.name,
                  });
                }
                return result.value as unknown as Record<string, unknown>;
              });
            }
            return configData;
          };

          // Step 2: Validate env vars
          const validateEnv = (): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> => {
            let envData: Record<string, unknown> | undefined;
            if (envSchema) {
              const rawEnv = runtime.env();
              const envValidated = envSchema['~standard'].validate(rawEnv);
              return thenMaybe(envValidated, (result) => {
                if (!result.issues) {
                  envData = result.value as unknown as Record<string, unknown>;
                }
                return envData;
              });
            }
            return envData;
          };

          // Step 3: Read stdin if configured and not already provided via CLI
          const readStdin = (): Record<string, unknown> | Promise<Record<string, unknown>> => {
            const stdinConfig = command.meta?.stdin;
            if (!stdinConfig) return {};

            const { field, as } = parseStdinConfig(stdinConfig);

            // Skip if the field was already provided via CLI flags (highest precedence)
            if (field in validateCtx.rawArgs && validateCtx.rawArgs[field] !== undefined) return {};

            // Resolve stdin: use runtime's custom stdin, or default if piped.
            // Returns undefined when stdin is a TTY or unavailable.
            const stdin = resolveStdin(runtime as any);
            if (!stdin) return {};

            if (as === 'lines') {
              return (async () => {
                const lines: string[] = [];
                for await (const line of stdin.lines()) {
                  lines.push(line);
                }
                return { [field]: lines };
              })();
            }

            // Default: read all as text
            return stdin.text().then((text) => {
              // Don't inject empty stdin
              if (!text) return {};
              return { [field]: text };
            });
          };

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

            // Early validation: check provided args for errors before prompting.
            // This catches unknown options and invalid values on explicitly-provided fields
            // so the user isn't asked interactive questions for a doomed command.
            const willPrompt = !interactivitySuppressed && runtime.prompt && hasInteractiveConfig(command.meta);
            if (willPrompt) {
              const unknowns = checkUnknownArgs(command, preprocessedArgs);
              if (unknowns.length > 0) {
                const issues: StandardSchemaV1.Issue[] = unknowns.map(({ key, suggestion }) => ({
                  path: [key],
                  message: suggestion ? `Unknown option: "${key}". ${suggestion}` : `Unknown option: "${key}"`,
                }));
                return { args: undefined, argsResult: { issues } as any };
              }

              // Run schema validation on what we have so far (before prompting fills missing fields).
              // Only fail on issues for fields the user explicitly provided — skip issues for
              // missing/undefined fields since those will be filled by interactive prompts.
              if (command.argsSchema) {
                const providedKeys = new Set(Object.keys(preprocessedArgs).filter((k) => preprocessedArgs[k] !== undefined));
                const earlyCheck = command.argsSchema['~standard'].validate(preprocessedArgs);
                const checkForProvidedFieldErrors = (result: StandardSchemaV1.Result<unknown>): PluginValidateResult | undefined => {
                  if (!result.issues) return undefined;
                  // Only keep issues whose path starts with a key the user actually provided
                  const providedFieldIssues = result.issues.filter((issue) => {
                    const rootKey = issue.path?.[0];
                    return rootKey !== undefined && providedKeys.has(String(rootKey));
                  });
                  if (providedFieldIssues.length > 0) {
                    return { args: undefined, argsResult: { issues: providedFieldIssues } as any };
                  }
                  return undefined;
                };
                const earlyResult = thenMaybe(earlyCheck, (result) => {
                  const errors = checkForProvidedFieldErrors(result);
                  if (errors) return errors;
                  return undefined;
                });
                if (earlyResult instanceof Promise) {
                  return earlyResult.then((err) => {
                    if (err) return err;
                    return continueWithPrompt(preprocessedArgs);
                  });
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
          // Handle validation failures
          if (v.argsResult?.issues) {
            // Collect known option names for fuzzy suggestion on unknown keys
            let knownOptions: string[] | undefined;
            const getKnownOptions = () => {
              if (knownOptions) return knownOptions;
              knownOptions = [];
              if (command.argsSchema) {
                try {
                  const js = command.argsSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
                  if (js.type === 'object' && js.properties) knownOptions = Object.keys(js.properties);
                } catch {
                  /* ignore */
                }
              }
              return knownOptions;
            };

            const issueMessages = v.argsResult.issues
              .map((i: StandardSchemaV1.Issue) => {
                const base = `  - ${i.path?.join('.') || 'root'}: ${i.message}`;
                // Try to suggest for unrecognized key errors
                const issueAny = i as any;
                const unrecognizedKeys: string[] | undefined =
                  issueAny.keys ?? i.message?.match(/[Uu]nrecognized key(?:s)?[^"]*"([^"]+)"/)?.slice(1);
                if (unrecognizedKeys?.length) {
                  const hints = unrecognizedKeys.map((k: string) => suggestSimilar(k, getKnownOptions())).filter(Boolean);
                  if (hints.length) return `${base}\n    ${hints.join('\n    ')}`;
                }
                return base;
              })
              .join('\n');

            if (errorMode === 'hard') {
              const helpText = generateHelp(existingCommand, command, { format: runtime.format });
              runtime.error(`Validation error:\n${issueMessages}`);
              runtime.error(helpText);
              throw new ValidationError(`Validation error:\n${issueMessages}`, v.argsResult.issues as any, {
                suggestions: v.argsResult.issues.flatMap((i: any) => {
                  const keys: string[] | undefined = i.keys ?? i.message?.match(/[Uu]nrecognized key(?:s)?[^"]*"([^"]+)"/)?.slice(1);
                  if (!keys?.length) return [];
                  return keys.map((k: string) => suggestSimilar(k, getKnownOptions())).filter(Boolean);
                }),
                command: command.path || command.name,
              });
            }

            // Soft mode: return result with issues, skip the action
            return {
              command: command as any,
              args: undefined,
              argsResult: v.argsResult,
              result: undefined,
            };
          }

          const executeCtx: PluginExecuteContext = {
            command,
            args: v.args,
            state,
          };

          const coreExecute = (): PluginExecuteResult => {
            const handler = command.action ?? noop;
            const ctx = evalOptions?.runtime ? { ...createActionContext(command), runtime } : createActionContext(command);
            const result = handler(executeCtx.args as any, ctx);
            return { result };
          };

          const executedOrPromise = runPluginChain('execute', commandPlugins, executeCtx, coreExecute);

          return thenMaybe(executedOrPromise, (e) => {
            const commandResult = {
              command: command as any,
              args: v.args,
              argsResult: v.argsResult,
              result: e.result,
            };

            if (command.autoOutput ?? evalOptions?.autoOutput ?? true) {
              const outputOrPromise = outputValue(e.result, runtime.output);
              if (outputOrPromise instanceof Promise) {
                return outputOrPromise.then(() => commandResult);
              }
            }

            return commandResult;
          });
        };

        return thenMaybe(warnIfUnexpectedAsync(validatedOrPromise, command), continueAfterValidate) as any;
      };

      return thenMaybe(parsedOrPromise, continueAfterParse) as any;
    };

    return wrapWithLifecycle(rootPlugins, existingCommand, state, resolvedInput, runPipeline, (result) => ({
      command: existingCommand,
      args: undefined,
      argsResult: undefined,
      result,
    })) as any;
  };

  const evalCommand: AnyPadroneProgram['eval'] = (input, evalOptions) => {
    return makeThenable(execCommand(input as string, evalOptions, 'soft'));
  };

  /**
   * Collects plugins from the command's parent chain (root → ... → target).
   * Root/program plugins come first (outermost), target command's plugins last (innermost).
   *
   * The `programRoot` parameter provides the current program command, because
   * subcommands' `.parent` references may be stale (builders are immutable — each
   * method returns a new builder, so a subcommand's parent was captured before
   * `.use()` was called on the program). We substitute `programRoot` for the
   * top of the chain to ensure program-level plugins are always included.
   */
  const collectPlugins = (cmd: AnyPadroneCommand): PadronePlugin[] => {
    const chain: PadronePlugin[][] = [];
    let current: AnyPadroneCommand | undefined = cmd;
    while (current) {
      // If this is the root (no parent), use existingCommand's plugins instead
      // to pick up plugins added after subcommands were defined.
      if (!current.parent) {
        if (existingCommand.plugins?.length) chain.unshift(existingCommand.plugins);
      } else {
        if (current.plugins?.length) chain.unshift(current.plugins);
      }
      current = current.parent;
    }
    return chain.flat();
  };

  // Forward declaration — assigned by the repl method in the return object, used by cli() for --repl.
  let replFn: (options?: PadroneReplPreferences) => AsyncIterable<any>;
  const replActiveRef = { value: false };

  const cli: AnyPadroneProgram['cli'] = (cliOptions) => {
    const runtime = getCommandRuntime(existingCommand);
    const resolvedInput = (runtime.argv().join(' ') || undefined) as string | undefined;

    // Check for --repl flag before normal execution
    if (cliOptions?.repl !== false) {
      const builtin = checkBuiltinCommands(resolvedInput);
      if (builtin?.type === 'repl') {
        const replPrefs: PadroneReplPreferences = {
          ...(typeof cliOptions?.repl === 'object' ? cliOptions.repl : {}),
          scope: builtin.scope,
          autoOutput: (typeof cliOptions?.repl === 'object' ? cliOptions.repl.autoOutput : undefined) ?? cliOptions?.autoOutput,
        };
        const drainRepl = async () => {
          for await (const _ of replFn(replPrefs)) {
            // Results are handled by command actions
          }
          return { command: existingCommand, args: undefined, result: undefined } as any;
        };
        return drainRepl() as any;
      }
    }

    // Start background update check (non-blocking)
    let updateCheckPromise: Promise<(() => void) | undefined> | undefined;
    if (existingCommand.updateCheck) {
      // Respect --no-update-check flag
      const hasNoUpdateCheckFlag =
        resolvedInput &&
        parseCliInputToParts(resolvedInput).some((p) => p.type === 'named' && p.key.length === 1 && p.key[0] === 'no-update-check');
      if (!hasNoUpdateCheckFlag) {
        const currentVersion = getVersion(existingCommand.version);
        updateCheckPromise = import('./update-check.ts').then(({ createUpdateChecker }) =>
          createUpdateChecker(existingCommand.name, currentVersion, existingCommand.updateCheck!, runtime),
        );
      }
    }

    const result = execCommand(resolvedInput, cliOptions, 'hard');

    // Show update notification after command output
    if (updateCheckPromise) {
      if (result instanceof Promise) {
        return result.then(async (r) => {
          const showUpdateNotification = await updateCheckPromise;
          showUpdateNotification?.();
          return r;
        }) as any;
      }
      // For sync results, schedule notification for next tick (non-blocking)
      updateCheckPromise.then((show) => show?.());
    }

    return makeThenable(result);
  };

  const run: AnyPadroneProgram['run'] = (command, args) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new RoutingError(`Command "${command ?? ''}" not found`);
    if (!commandObj.action) throw new RoutingError(`Command "${commandObj.path}" has no action`, { command: commandObj.path });

    const state: Record<string, unknown> = {};
    const executeCtx: PluginExecuteContext = { command: commandObj, args, state };

    const coreExecute = (): PluginExecuteResult => {
      const result = commandObj.action!(executeCtx.args as any, createActionContext(commandObj));
      return { result };
    };

    const commandObjPlugins = collectPlugins(commandObj);
    const executedOrPromise = runPluginChain('execute', commandObjPlugins, executeCtx, coreExecute);

    const toResult = (e: PluginExecuteResult) => ({
      command: commandObj as any,
      args: args as any,
      result: e.result,
    });

    if (executedOrPromise instanceof Promise) {
      return executedOrPromise.then(toResult) as any;
    }
    return toResult(executedOrPromise);
  };

  const tool: AnyPadroneProgram['tool'] = () => {
    const helpText = generateHelp(existingCommand, undefined, { format: 'text' });

    const description = `Run a command. Pass the full command string including arguments. Use "help <command>" for detailed usage.\n\n${helpText}`;

    return {
      type: 'function',
      name: existingCommand.name,
      strict: true,
      title: existingCommand.description,
      description,
      inputExamples: [{ input: { command: '<command> [positionals...] [arguments...]' } }],
      inputSchema: {
        [Symbol.for('vercel.ai.schema') as keyof Schema & symbol]: true,
        jsonSchema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          additionalProperties: false,
        },
        _type: undefined as unknown as { command: string },
        validate: (value) => {
          const command = (value as any)?.command;
          if (typeof command === 'string') return { success: true, value: { command } };
          return { success: false, error: new Error('Expected an object with command property as string.') };
        },
      } satisfies Schema<{ command: string }> as Schema<{ command: string }>,
      needsApproval: async (input) => {
        const parsed = await parse(input.command);
        if (typeof parsed.command.needsApproval === 'function') return parsed.command.needsApproval(parsed.args);
        return !!parsed.command.needsApproval;
      },
      execute: async (input) => {
        const output: string[] = [];
        const errors: string[] = [];
        const result = await evalCommand(input.command, {
          autoOutput: false,
          runtime: {
            output: (...args) => output.push(args.map(String).join(' ')),
            error: (text) => errors.push(text),
            interactive: 'unsupported',
            format: 'text',
          },
        });
        return { result: result.result, logs: output.join('\n'), error: errors.join('\n') };
      },
    };
  };

  const builder = {
    configure(config) {
      return createPadroneBuilder({ ...existingCommand, ...config }) as any;
    },
    runtime(runtimeConfig) {
      return createPadroneBuilder({ ...existingCommand, runtime: { ...existingCommand.runtime, ...runtimeConfig } }) as any;
    },
    async() {
      return createPadroneBuilder({ ...existingCommand, isAsync: true }) as any;
    },
    arguments(schema, meta) {
      // If schema is a function, call it with parent's arguments as base
      const resolvedArgs = typeof schema === 'function' ? schema(existingCommand.argsSchema as any) : schema;
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedArgs) || hasInteractiveConfig(meta);
      return createPadroneBuilder({ ...existingCommand, argsSchema: resolvedArgs, meta, isAsync }) as any;
    },
    configFile(file, schema) {
      const configFiles = file === undefined ? undefined : Array.isArray(file) ? file : [file];
      const resolvedConfig = typeof schema === 'function' ? schema(existingCommand.argsSchema) : (schema ?? existingCommand.argsSchema);
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedConfig);
      return createPadroneBuilder({ ...existingCommand, configFiles, configSchema: resolvedConfig as any, isAsync }) as any;
    },
    env(schema) {
      const resolvedEnv = typeof schema === 'function' ? schema(existingCommand.argsSchema) : schema;
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedEnv);
      return createPadroneBuilder({ ...existingCommand, envSchema: resolvedEnv as any, isAsync }) as any;
    },
    action(handler = noop) {
      const baseHandler = existingCommand.action ?? noop;
      return createPadroneBuilder({
        ...existingCommand,
        action: (args: any, ctx: any) => (handler as any)(args, ctx, baseHandler),
      }) as any;
    },
    wrap(config) {
      const handler = createWrapHandler(config, existingCommand.argsSchema as any, existingCommand.meta?.positional);
      return createPadroneBuilder({ ...existingCommand, action: handler }) as any;
    },
    command(nameOrNames, builderFn) {
      // Extract name and aliases from the input
      const name = Array.isArray(nameOrNames) ? nameOrNames[0] : nameOrNames;
      const aliases = Array.isArray(nameOrNames) && nameOrNames.length > 1 ? (nameOrNames.slice(1) as string[]) : undefined;

      // Check if a command with this name already exists (override case)
      const existingSubcommand = existingCommand.commands?.find((c) => c.name === name) as AnyPadroneCommand | undefined;

      const initialCommand: AnyPadroneCommand = existingSubcommand
        ? { ...existingSubcommand, aliases: aliases ?? existingSubcommand.aliases, parent: existingCommand }
        : ({
            name,
            path: existingCommand.path ? `${existingCommand.path} ${name}` : name,
            aliases,
            parent: existingCommand,
            '~types': {} as any,
          } satisfies PadroneCommand);

      const builder = createPadroneBuilder(initialCommand);

      const commandObj =
        ((builderFn?.(builder as any) as unknown as typeof builder)?.[commandSymbol] as AnyPadroneCommand) ?? initialCommand;

      // Merge subcommands when overriding: existing subcommands that aren't replaced are kept
      const mergedCommandObj = existingSubcommand ? mergeCommands(existingSubcommand, commandObj) : commandObj;

      // Replace existing command or append new one
      const commands = existingCommand.commands || [];
      const existingIndex = commands.findIndex((c) => c.name === name);
      const updatedCommands =
        existingIndex >= 0
          ? [...commands.slice(0, existingIndex), mergedCommandObj, ...commands.slice(existingIndex + 1)]
          : [...commands, mergedCommandObj];

      return createPadroneBuilder({ ...existingCommand, commands: updatedCommands }) as any;
    },

    mount(nameOrNames, program) {
      const name = Array.isArray(nameOrNames) ? nameOrNames[0] : nameOrNames;
      const aliases = Array.isArray(nameOrNames) && nameOrNames.length > 1 ? (nameOrNames.slice(1) as string[]) : undefined;

      // Extract the underlying command from the program
      const programCommand = (program as any)[commandSymbol] as AnyPadroneCommand | undefined;
      if (!programCommand) throw new RoutingError('Cannot mount: not a valid Padrone program');

      // Re-path the command tree under the new name
      const remounted = repathCommandTree(programCommand, name, existingCommand.path || '', existingCommand);
      remounted.aliases = aliases;

      // Merge with existing command if one with the same name exists
      const existingSubcommand = existingCommand.commands?.find((c) => c.name === name) as AnyPadroneCommand | undefined;
      const mergedCommandObj = existingSubcommand ? mergeCommands(existingSubcommand, remounted) : remounted;

      const commands = existingCommand.commands || [];
      const existingIndex = commands.findIndex((c) => c.name === name);
      const updatedCommands =
        existingIndex >= 0
          ? [...commands.slice(0, existingIndex), mergedCommandObj, ...commands.slice(existingIndex + 1)]
          : [...commands, mergedCommandObj];

      return createPadroneBuilder({ ...existingCommand, commands: updatedCommands }) as any;
    },

    use(plugin: PadronePlugin) {
      return createPadroneBuilder({
        ...existingCommand,
        plugins: [...(existingCommand.plugins ?? []), plugin],
      }) as any;
    },

    updateCheck(config = {}) {
      return createPadroneBuilder({ ...existingCommand, updateCheck: config }) as any;
    },

    run,
    find,
    parse,
    stringify,
    eval: evalCommand,
    cli,
    tool,

    repl: (replFn = (options?: PadroneReplPreferences) => {
      return createReplIterator({ existingCommand, evalCommand, replActiveRef }, options);
    }),

    api() {
      function buildApi(command: AnyPadroneCommand) {
        const runCommand = ((args) => run(command, args).result) as PadroneAPI<AnyPadroneCommand>;
        if (!command.commands) return runCommand;
        for (const cmd of command.commands) runCommand[cmd.name] = buildApi(cmd);
        return runCommand;
      }

      return buildApi(existingCommand);
    },

    help(command, prefs) {
      const commandObj = !command
        ? existingCommand
        : typeof command === 'string'
          ? findCommandByName(command, existingCommand.commands)
          : (command as AnyPadroneCommand);
      if (!commandObj) throw new RoutingError(`Command "${command ?? ''}" not found`);
      const runtime = getCommandRuntime(existingCommand);
      return generateHelp(existingCommand, commandObj, { ...prefs, format: prefs?.format ?? runtime.format });
    },

    async completion(shell) {
      const { generateCompletionOutput } = await import('./completion.ts');
      return generateCompletionOutput(existingCommand, shell as ShellType | undefined);
    },

    '~types': {} as any,

    [commandSymbol]: existingCommand,
  } satisfies AnyPadroneProgram & { [commandSymbol]: AnyPadroneCommand } as any;
  return builder as TBuilder & { [commandSymbol]: AnyPadroneCommand };
}
