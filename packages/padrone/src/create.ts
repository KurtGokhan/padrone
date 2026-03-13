import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Schema } from 'ai';
import { generateCompletionOutput, type ShellType } from './completion.ts';
import { generateHelp } from './help.ts';
import { extractSchemaMetadata, parsePositionalConfig, preprocessOptions } from './options.ts';
import { getNestedValue, parseCliInputToParts, setNestedValue } from './parse.ts';
import { type ResolvedPadroneRuntime, resolveRuntime } from './runtime.ts';
import type { AnyPadroneCommand, AnyPadroneProgram, PadroneAPI, PadroneCommand, PadroneProgram, PadroneSchema } from './types.ts';
import { getVersion } from './utils.ts';
import { createWrapHandler } from './wrap.ts';

const commandSymbol = Symbol('padrone_command');

const noop = <TRes>() => undefined as TRes;

/**
 * Maps over a value that may or may not be a Promise.
 * If the value is a Promise, chains with `.then()`. Otherwise, calls the function synchronously.
 * This preserves sync behavior for sync schemas and async behavior for async schemas.
 */
function thenMaybe<T, U>(value: T | Promise<T>, fn: (v: T) => U | Promise<U>): U | Promise<U> {
  if (value instanceof Promise) return value.then(fn);
  return fn(value);
}

/**
 * Brands a schema as async, signaling that its `validate()` may return a Promise.
 * When an async-branded schema is passed to `.arguments()`, `.configFile()`, or `.env()`,
 * the command's `parse()` and `cli()` will return Promises.
 *
 * @example
 * ```ts
 * const schema = asyncSchema(z.object({
 *   name: z.string(),
 * }).check(async (data) => {
 *   // async validation logic
 * }));
 *
 * const program = createPadrone('app')
 *   .command('greet', (c) => c.arguments(schema).action((args) => args.name));
 *
 * // parse() now returns Promise<PadroneParseResult>
 * const result = await program.parse('greet --name world');
 * ```
 */
export function asyncSchema<T extends PadroneSchema>(schema: T): T & { '~async': true } {
  return Object.assign(schema, { '~async': true as const });
}

/**
 * Resolves the runtime for a command by walking up the parent chain.
 * Returns a fully resolved runtime with all defaults filled in.
 */
function getCommandRuntime(cmd: AnyPadroneCommand): ResolvedPadroneRuntime {
  let current: AnyPadroneCommand | undefined = cmd;
  while (current) {
    if (current.runtime) return resolveRuntime(current.runtime);
    current = current.parent;
  }
  return resolveRuntime();
}

function isAsyncBranded(schema: unknown): boolean {
  return !!schema && typeof schema === 'object' && '~async' in schema && (schema as any)['~async'] === true;
}

function warnIfUnexpectedAsync<T>(value: T, command: AnyPadroneCommand): T {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return value;
  if (value instanceof Promise && !command.isAsync) {
    const runtime = getCommandRuntime(command);
    runtime.error(
      `[padrone] Command "${command.path || command.name}" returned a Promise from validation, ` +
        `but was not marked as async. Use \`.async()\` on the builder or \`asyncSchema()\` to brand your schema. ` +
        `Without this, TypeScript will infer a sync return type and the result will be a Promise at runtime.`,
    );
  }
  return value;
}

export function createPadrone<TProgramName extends string>(name: TProgramName): PadroneProgram<TProgramName, '', ''> {
  return createPadroneBuilder({ name, path: '', commands: [] } as any) as unknown as PadroneProgram<TProgramName, '', ''>;
}

export function createPadroneBuilder<TBuilder extends PadroneProgram = PadroneProgram>(
  existingCommand: AnyPadroneCommand,
): TBuilder & { [commandSymbol]: AnyPadroneCommand } {
  function findCommandByName(name: string, commands?: AnyPadroneCommand[]): AnyPadroneCommand | undefined {
    if (!commands) return undefined;

    const foundByName = commands.find((cmd) => cmd.name === name);
    if (foundByName) return foundByName;

    // Check for aliases
    const foundByAlias = commands.find((cmd) => cmd.aliases?.includes(name));
    if (foundByAlias) return foundByAlias;

    for (const cmd of commands) {
      if (cmd.commands && name.startsWith(`${cmd.name} `)) {
        const subCommandName = name.slice(cmd.name.length + 1);
        const subCommand = findCommandByName(subCommandName, cmd.commands);
        if (subCommand) return subCommand;
      }
      // Check aliases for nested commands
      if (cmd.commands && cmd.aliases) {
        for (const alias of cmd.aliases) {
          if (name.startsWith(`${alias} `)) {
            const subCommandName = name.slice(alias.length + 1);
            const subCommand = findCommandByName(subCommandName, cmd.commands);
            if (subCommand) return subCommand;
          }
        }
      }
    }
    return undefined;
  }

  const find: AnyPadroneProgram['find'] = (command) => {
    if (typeof command !== 'string') return findCommandByName(command.path, existingCommand.commands) as any;
    return findCommandByName(command, existingCommand.commands) as any;
  };

  /**
   * Parses CLI input to find the command and extract raw options without validation.
   */
  const parseCommand = (input: string | undefined) => {
    input ??= getCommandRuntime(existingCommand).argv().join(' ') || undefined;
    if (!input) return { command: existingCommand, rawArgs: {} as Record<string, unknown>, args: [] as string[] };

    const parts = parseCliInputToParts(input);

    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'arg').map((p) => p.value);

    let curCommand: AnyPadroneCommand | undefined = existingCommand;

    // If the first term is the program name, skip it
    if (terms[0] === existingCommand.name) terms.shift();

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i] || '';
      const found = findCommandByName(term, curCommand.commands);

      if (found) {
        curCommand = found;
      } else {
        args.unshift(...terms.slice(i));
        break;
      }
    }

    if (!curCommand) return { command: existingCommand, rawArgs: {} as Record<string, unknown>, args };

    // Extract option metadata from the nested options object in meta
    const argsMeta = curCommand.meta?.fields;
    const schemaMetadata = curCommand.arguments ? extractSchemaMetadata(curCommand.arguments, argsMeta) : { aliases: {} };
    const { aliases } = schemaMetadata;

    // Get array options from schema (arrays are always variadic)
    const arrayOptions = new Set<string>();
    if (curCommand.arguments) {
      try {
        const jsonSchema = curCommand.arguments['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
        if (jsonSchema.type === 'object' && jsonSchema.properties) {
          for (const [key, prop] of Object.entries(jsonSchema.properties as Record<string, any>)) {
            if (prop?.type === 'array') arrayOptions.add(key);
          }
        }
      } catch {
        // Ignore schema parsing errors
      }
    }

    const opts = parts.filter((p) => p.type === 'option' || p.type === 'alias');
    const rawArgs: Record<string, unknown> = {};

    for (const opt of opts) {
      // For aliases, resolve to the full key name (aliases map single char to full key name)
      // opt.key is now a string[] - for aliases it's always single element like ['v']
      const key: string[] = opt.type === 'alias' && opt.key.length === 1 && aliases[opt.key[0]!] ? [aliases[opt.key[0]!]!] : opt.key;

      const rootKey = key[0]!;

      // Handle negated boolean options (--no-verbose)
      if (opt.type === 'option' && opt.negated) {
        setNestedValue(rawArgs, key, false);
        continue;
      }

      const value = opt.value ?? true;

      // Handle array options - accumulate values into arrays (arrays are always variadic)
      if (arrayOptions.has(rootKey)) {
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

    return { command: curCommand, rawArgs, args };
  };

  /**
   * Validates raw options against the command's schema and applies preprocessing.
   * Returns sync or async result depending on the schema's validate method.
   */
  const validateArgs = (
    command: AnyPadroneCommand,
    rawArgs: Record<string, unknown>,
    args: string[],
    parseOptions?: { envData?: Record<string, unknown>; configData?: Record<string, unknown> },
  ) => {
    // Apply preprocessing (env and config bindings)
    const preprocessedArgs = preprocessOptions(rawArgs, {
      aliases: {}, // Already resolved aliases in parseCommand
      envData: parseOptions?.envData,
      configData: parseOptions?.configData,
    });

    // Parse positional configuration
    const positionalConfig = command.meta?.positional ? parsePositionalConfig(command.meta.positional) : [];

    // Map positional arguments to their named options
    if (positionalConfig.length > 0) {
      let argIndex = 0;
      for (const { name, variadic } of positionalConfig) {
        if (argIndex >= args.length) break;

        if (variadic) {
          // Collect remaining args (but leave room for non-variadic args after)
          const remainingPositionals = positionalConfig.slice(positionalConfig.indexOf({ name, variadic }) + 1);
          const nonVariadicAfter = remainingPositionals.filter((p) => !p.variadic).length;
          const variadicEnd = args.length - nonVariadicAfter;
          preprocessedArgs[name] = args.slice(argIndex, variadicEnd);
          argIndex = variadicEnd;
        } else {
          preprocessedArgs[name] = args[argIndex];
          argIndex++;
        }
      }
    }

    const argsParsed = command.arguments ? command.arguments['~standard'].validate(preprocessedArgs) : { value: preprocessedArgs };

    // Return undefined for args when there's no schema and no meaningful args
    const hasArgs = command.arguments || Object.keys(preprocessedArgs).length > 0;

    const buildResult = (parsed: StandardSchemaV1.Result<unknown>) => ({
      args: parsed.issues ? undefined : hasArgs ? (parsed.value as any) : undefined,
      argsResult: parsed as any,
    });

    return thenMaybe(argsParsed, buildResult);
  };

  const parse: AnyPadroneProgram['parse'] = (input, parseOptions) => {
    const { command, rawArgs, args } = parseCommand(input);

    // Resolve env schema: command's own envSchema > inherited from parent/root
    const resolveEnvSchema = (cmd: AnyPadroneCommand): AnyPadroneCommand['envSchema'] => {
      if (cmd.envSchema !== undefined) return cmd.envSchema;
      if (cmd.parent) return resolveEnvSchema(cmd.parent);
      return undefined;
    };
    const envSchema = resolveEnvSchema(command);

    const finalize = (envData: Record<string, unknown> | undefined) => {
      const validated = validateArgs(command, rawArgs, args, {
        envData,
        configData: parseOptions?.configData,
      });

      const toParseResult = (v: { args: any; argsResult: any }) => ({
        command: command as any,
        args: v.args,
        argsResult: v.argsResult,
      });

      return thenMaybe(validated, toParseResult);
    };

    // Validate env vars against schema if provided
    let envData: Record<string, unknown> | undefined = parseOptions?.envData;
    if (envSchema && !envData) {
      const runtime = getCommandRuntime(command);
      const rawEnv = parseOptions?.env ?? runtime.env();
      const envValidated = envSchema['~standard'].validate(rawEnv);

      return warnIfUnexpectedAsync(
        thenMaybe(envValidated, (result) => {
          // For env vars, we don't throw on validation errors - just use the transformed value if valid
          if (!result.issues) {
            envData = result.value as unknown as Record<string, unknown>;
          }
          return finalize(envData);
        }),
        command,
      ) as any;
    }

    return warnIfUnexpectedAsync(finalize(envData), command) as any;
  };

  const stringify: AnyPadroneProgram['stringify'] = (command = '' as any, args) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);

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
          // Handle variadic options - output each value separately
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

      // Output remaining options (non-positional)
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
    | { type: 'completion'; shell?: ShellType }
    | null => {
    if (!input) return null;

    const parts = parseCliInputToParts(input);
    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'option' || p.type === 'alias');

    // Helper to check if a key array matches a single key string
    const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

    // Check for --help, -h flags (these take precedence over commands)
    const hasHelpFlag = args.some((p) => (p.type === 'option' && keyIs(p.key, 'help')) || (p.type === 'alias' && keyIs(p.key, 'h')));

    // Extract detail level from --detail=<level> or -d <level>
    const getDetailLevel = (): DetailLevel | undefined => {
      for (const opt of args) {
        if (opt.type === 'option' && keyIs(opt.key, 'detail') && typeof opt.value === 'string') {
          if (opt.value === 'minimal' || opt.value === 'standard' || opt.value === 'full') {
            return opt.value;
          }
        }
        if (opt.type === 'alias' && keyIs(opt.key, 'd') && typeof opt.value === 'string') {
          if (opt.value === 'minimal' || opt.value === 'standard' || opt.value === 'full') {
            return opt.value;
          }
        }
      }
      return undefined;
    };
    const detail = getDetailLevel();

    // Extract format from --format=<value> or -f <value>
    const getFormat = (): FormatLevel | undefined => {
      const validFormats: FormatLevel[] = ['text', 'ansi', 'console', 'markdown', 'html', 'json', 'auto'];
      for (const opt of args) {
        if (opt.type === 'option' && keyIs(opt.key, 'format') && typeof opt.value === 'string') {
          if (validFormats.includes(opt.value as FormatLevel)) {
            return opt.value as FormatLevel;
          }
        }
        if (opt.type === 'alias' && keyIs(opt.key, 'f') && typeof opt.value === 'string') {
          if (validFormats.includes(opt.value as FormatLevel)) {
            return opt.value as FormatLevel;
          }
        }
      }
      return undefined;
    };
    const format = getFormat();

    // Check for --version, -v, -V flags
    const hasVersionFlag = args.some(
      (p) => (p.type === 'option' && keyIs(p.key, 'version')) || (p.type === 'alias' && (keyIs(p.key, 'v') || keyIs(p.key, 'V'))),
    );

    // If the first term is the program name, skip it
    const normalizedTerms = [...terms];
    if (normalizedTerms[0] === existingCommand.name) normalizedTerms.shift();

    // Check if user has defined 'help', 'version', or 'completion' commands (they take precedence)
    const userHelpCommand = findCommandByName('help', existingCommand.commands);
    const userVersionCommand = findCommandByName('version', existingCommand.commands);
    const userCompletionCommand = findCommandByName('completion', existingCommand.commands);

    // Check for 'help' command (only if user hasn't defined one)
    if (!userHelpCommand && normalizedTerms[0] === 'help') {
      // help <command> - get help for specific command
      const commandName = normalizedTerms.slice(1).join(' ');
      const targetCommand = commandName ? findCommandByName(commandName, existingCommand.commands) : undefined;
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
      return { type: 'completion', shell };
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

    return null;
  };

  /**
   * Extract the config file path from --config=<path> or -c <path> flags.
   */
  const extractConfigPath = (input: string | undefined): string | undefined => {
    if (!input) return undefined;

    const parts = parseCliInputToParts(input);
    const args = parts.filter((p) => p.type === 'option' || p.type === 'alias');

    for (const opt of args) {
      if (opt.type === 'option' && opt.key.length === 1 && opt.key[0] === 'config' && typeof opt.value === 'string') {
        return opt.value;
      }
      if (opt.type === 'alias' && opt.key.length === 1 && opt.key[0] === 'c' && typeof opt.value === 'string') {
        return opt.value;
      }
    }
    return undefined;
  };

  const cli: AnyPadroneProgram['cli'] = (input, cliOptions) => {
    const runtime = getCommandRuntime(existingCommand);

    // Resolve input from runtime.argv if not provided
    const resolvedInput = (input ?? (runtime.argv().join(' ') || undefined)) as string | undefined;

    // Check for built-in help/version/completion commands and flags
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
        const completionScript = generateCompletionOutput(existingCommand, builtin.shell);
        runtime.output(completionScript);
        return {
          command: existingCommand,
          args: undefined,
          result: completionScript,
        } as any;
      }
    }

    // Parse the command first (without validating options)
    const { command, rawArgs, args } = parseCommand(resolvedInput);

    // Extract config file path from --config or -c flag
    const configPath = extractConfigPath(resolvedInput);

    // Resolve config files: command's own configFiles > inherited from parent/root
    // undefined = inherit, empty array = no config files (explicit opt-out)
    const resolveConfigFiles = (cmd: AnyPadroneCommand): string[] | undefined => {
      if (cmd.configFiles !== undefined) return cmd.configFiles;
      if (cmd.parent) return resolveConfigFiles(cmd.parent);
      return undefined;
    };
    const effectiveConfigFiles = resolveConfigFiles(command);

    // Resolve config schema: command's own config > inherited from parent/root
    const resolveConfigSchema = (cmd: AnyPadroneCommand): AnyPadroneCommand['config'] => {
      if (cmd.config !== undefined) return cmd.config;
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

    // Determine config data: explicit --config flag > auto-discovered config > provided configData
    let configData = cliOptions?.configData;
    if (configPath) {
      // Explicit config path takes precedence
      configData = runtime.loadConfigFile(configPath);
    } else if (effectiveConfigFiles?.length) {
      // Search for config files if configFiles is configured (inherited or own)
      const foundConfigPath = runtime.findFile(effectiveConfigFiles);
      if (foundConfigPath) {
        configData = runtime.loadConfigFile(foundConfigPath) ?? configData;
      }
    }

    /**
     * Chains config → env → options validation, then runs the handler.
     * Each validation step preserves sync/async behavior based on the schema.
     */
    const processValidation = () => {
      // Step 1: Validate config data against schema if provided
      const validateConfig = (): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> => {
        if (configData && configSchema) {
          const configValidated = configSchema['~standard'].validate(configData);
          return thenMaybe(configValidated, (result) => {
            if (result.issues) {
              const issueMessages = result.issues
                .map((i: StandardSchemaV1.Issue) => `  - ${i.path?.join('.') || 'root'}: ${i.message}`)
                .join('\n');
              throw new Error(`Invalid config file:\n${issueMessages}`);
            }
            return result.value as unknown as Record<string, unknown>;
          });
        }
        return configData;
      };

      // Step 2: Validate env vars
      const validateEnv = (): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> => {
        let envData: Record<string, unknown> | undefined = cliOptions?.envData;
        if (envSchema) {
          const rawEnv = cliOptions?.env ?? runtime.env();
          const envValidated = envSchema['~standard'].validate(rawEnv);
          return thenMaybe(envValidated, (result) => {
            // For env vars, we don't throw on validation errors - just use the transformed value if valid
            // This is because the schema may use .optional() or .default() for missing env vars
            if (!result.issues) {
              envData = result.value as unknown as Record<string, unknown>;
            }
            return envData;
          });
        }
        return envData;
      };

      // Step 3: Validate options and run handler
      const finalizeAndRun = (validatedConfigData: Record<string, unknown> | undefined, envData: Record<string, unknown> | undefined) => {
        const validated = validateArgs(command, rawArgs, args, {
          envData,
          configData: validatedConfigData,
        });

        const handleValidated = (v: { args: any; argsResult: any }) => {
          // Handle validation failures
          if (v.argsResult?.issues) {
            const issueMessages = v.argsResult.issues
              .map((i: StandardSchemaV1.Issue) => `  - ${i.path?.join('.') || 'root'}: ${i.message}`)
              .join('\n');

            if (input === undefined) {
              // Called without explicit input (using runtime.argv): print error + help and throw
              const helpText = generateHelp(existingCommand, command, { format: runtime.format });
              runtime.error(`Validation error:\n${issueMessages}`);
              runtime.error(helpText);
              throw new Error(`Validation error:\n${issueMessages}`);
            }

            // Called with explicit input: return result with issues, skip the action
            return {
              command: command as any,
              args: undefined,
              argsResult: v.argsResult,
              result: undefined,
            };
          }

          const res = run(command, v.args) as any;
          return {
            ...res,
            argsResult: v.argsResult,
          };
        };

        return thenMaybe(validated, handleValidated);
      };

      // Chain: config validation → env validation → options validation → run
      const validatedConfig = validateConfig();
      return thenMaybe(validatedConfig, (cfgData) => {
        const validatedEnv = validateEnv();
        return thenMaybe(validatedEnv, (envData) => {
          return finalizeAndRun(cfgData, envData);
        });
      });
    };

    return warnIfUnexpectedAsync(processValidation(), command) as any;
  };

  const run: AnyPadroneProgram['run'] = (command, args) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);
    if (!commandObj.handler) throw new Error(`Command "${commandObj.path}" has no handler`);

    const result = commandObj.handler(args as any, getCommandRuntime(commandObj));

    return {
      command: commandObj as any,
      args: args as any,
      result,
    };
  };

  const tool: AnyPadroneProgram['tool'] = () => {
    const helpText = generateHelp(existingCommand, undefined, { format: 'text', detail: 'full' });

    const description = `\n
This is a CLI tool created with Padrone. You can run any of the defined commands described in the help text below. If you need assistance, refer to the documentation or use the help command.

<help_output>
${helpText}
</help_output>
`;

    return {
      type: 'function',
      name: existingCommand.name,
      strict: true,
      title: existingCommand.description,
      description,
      inputExamples: [{ input: { command: '<command> [args...] [options...]' } }],
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
        const result = await cli(input.command);
        return result.result;
      },
    };
  };

  return {
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
      const resolvedArgs = typeof schema === 'function' ? schema(existingCommand.arguments as any) : schema;
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedArgs);
      return createPadroneBuilder({ ...existingCommand, arguments: resolvedArgs, meta, isAsync }) as any;
    },
    configFile(file, schema) {
      const configFiles = file === undefined ? undefined : Array.isArray(file) ? file : [file];
      const resolvedConfig = typeof schema === 'function' ? schema(existingCommand.arguments) : (schema ?? existingCommand.arguments);
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedConfig);
      return createPadroneBuilder({ ...existingCommand, configFiles, config: resolvedConfig as any, isAsync }) as any;
    },
    env(schema) {
      const resolvedEnv = typeof schema === 'function' ? schema(existingCommand.arguments) : schema;
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedEnv);
      return createPadroneBuilder({ ...existingCommand, envSchema: resolvedEnv as any, isAsync }) as any;
    },
    action(handler = noop) {
      return createPadroneBuilder({ ...existingCommand, handler }) as any;
    },
    wrap(config) {
      const handler = createWrapHandler(config, existingCommand.arguments as any, existingCommand.meta?.positional);
      return createPadroneBuilder({ ...existingCommand, handler }) as any;
    },
    command(nameOrNames, builderFn) {
      // Extract name and aliases from the input
      const name = Array.isArray(nameOrNames) ? nameOrNames[0] : nameOrNames;
      const aliases = Array.isArray(nameOrNames) && nameOrNames.length > 1 ? (nameOrNames.slice(1) as string[]) : undefined;

      const initialCommand = {
        name,
        path: existingCommand.path ? `${existingCommand.path} ${name}` : name,
        aliases,
        parent: existingCommand,
        '~types': {} as any,
      } satisfies PadroneCommand;
      const builder = createPadroneBuilder(initialCommand);

      const commandObj =
        ((builderFn?.(builder as any) as unknown as typeof builder)?.[commandSymbol] as AnyPadroneCommand) ?? initialCommand;
      return createPadroneBuilder({ ...existingCommand, commands: [...(existingCommand.commands || []), commandObj] }) as any;
    },

    run,
    find,
    parse,
    stringify,
    cli,
    tool,

    api() {
      function buildApi(command: AnyPadroneCommand) {
        const runCommand = ((args) => run(command, args).result) as PadroneAPI<AnyPadroneCommand>;
        if (!command.commands) return runCommand;
        for (const cmd of command.commands) runCommand[cmd.name] = buildApi(cmd);
        return runCommand;
      }

      return buildApi(existingCommand);
    },

    help(command, options) {
      const commandObj = !command
        ? existingCommand
        : typeof command === 'string'
          ? findCommandByName(command, existingCommand.commands)
          : (command as AnyPadroneCommand);
      if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);
      const runtime = getCommandRuntime(existingCommand);
      return generateHelp(existingCommand, commandObj, { format: runtime.format, ...options });
    },

    completion(shell) {
      return generateCompletionOutput(existingCommand, shell as ShellType | undefined);
    },

    '~types': {} as any,

    [commandSymbol]: existingCommand,
  } satisfies AnyPadroneProgram & { [commandSymbol]: AnyPadroneCommand } as any;
}
