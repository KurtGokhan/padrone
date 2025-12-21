import type { Schema } from 'ai';
import { generateHelp } from './help';
import { extractSchemaMetadata, parsePositionalConfig, preprocessOptions } from './options';
import { parseCliInputToParts } from './parse';
import type { AnyPadroneCommand, AnyPadroneProgram, PadroneAPI, PadroneCommand, PadroneCommandBuilder, PadroneProgram } from './types';
import { getVersion, loadConfigFile } from './utils';

const commandSymbol = Symbol('padrone_command');

const noop = <TRes>() => undefined as TRes;

export function createPadroneCommandBuilder<TBuilder extends PadroneProgram = PadroneProgram>(
  existingCommand: AnyPadroneCommand,
): TBuilder & { [commandSymbol]: AnyPadroneCommand } {
  function findCommandByName(name: string, commands?: AnyPadroneCommand[]): AnyPadroneCommand | undefined {
    if (!commands) return undefined;

    const foundByName = commands.find((cmd) => cmd.name === name);
    if (foundByName) return foundByName;

    for (const cmd of commands) {
      if (cmd.commands && name.startsWith(`${cmd.name} `)) {
        const subCommandName = name.slice(cmd.name.length + 1);
        const subCommand = findCommandByName(subCommandName, cmd.commands);
        if (subCommand) return subCommand;
      }
    }
    return undefined;
  }

  const find: AnyPadroneProgram['find'] = (command) => {
    return findCommandByName(command, existingCommand.commands) as ReturnType<AnyPadroneProgram['find']>;
  };

  const parse: AnyPadroneProgram['parse'] = (input, parseOptions) => {
    input ??= typeof process !== 'undefined' ? (process.argv.slice(2).join(' ') as any) : undefined;
    if (!input) return { command: existingCommand as any };

    const parts = parseCliInputToParts(input);

    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'arg').map((p) => p.value);

    let curCommand: AnyPadroneCommand | undefined = existingCommand;

    const commandTerms: string[] = [];

    // If the first term is the program name, skip it
    if (terms[0] === existingCommand.name) terms.shift();

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i] || '';
      const found = findCommandByName(term, curCommand.commands);

      if (found) {
        curCommand = found;
        commandTerms.push(term);
      } else {
        args.unshift(...terms.slice(i));
        break;
      }
    }

    if (!curCommand) return { command: existingCommand as any };

    // Extract option metadata from the nested options object in meta
    const optionsMeta = curCommand.meta?.options;
    const schemaMetadata = curCommand.options
      ? extractSchemaMetadata(curCommand.options, optionsMeta)
      : { aliases: {}, envBindings: {}, configKeys: {} };
    const { aliases, envBindings, configKeys } = schemaMetadata;

    // Get array options from schema (arrays are always variadic)
    const arrayOptions = new Set<string>();
    if (curCommand.options) {
      try {
        const jsonSchema = curCommand.options['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
        if (jsonSchema.type === 'object' && jsonSchema.properties) {
          for (const [key, prop] of Object.entries(jsonSchema.properties as Record<string, any>)) {
            if (prop?.type === 'array') arrayOptions.add(key);
          }
        }
      } catch {
        // Ignore schema parsing errors
      }
    }

    // Parse positional configuration
    const positionalConfig = curCommand.meta?.positional ? parsePositionalConfig(curCommand.meta.positional) : [];

    const opts = parts.filter((p) => p.type === 'option' || p.type === 'alias');
    const optionsRecord: Record<string, unknown> = {};

    for (const opt of opts) {
      const key = opt.type === 'alias' ? aliases[opt.key] || opt.key : opt.key;

      // Handle negated boolean options (--no-verbose)
      if (opt.type === 'option' && opt.negated) {
        optionsRecord[key] = false;
        continue;
      }

      const value = opt.value ?? true;

      // Handle array options - accumulate values into arrays (arrays are always variadic)
      if (arrayOptions.has(key)) {
        if (key in optionsRecord) {
          const existing = optionsRecord[key];
          if (Array.isArray(existing)) {
            if (Array.isArray(value)) {
              existing.push(...value);
            } else {
              existing.push(value);
            }
          } else {
            if (Array.isArray(value)) {
              optionsRecord[key] = [existing, ...value];
            } else {
              optionsRecord[key] = [existing, value];
            }
          }
        } else {
          optionsRecord[key] = Array.isArray(value) ? value : [value];
        }
      } else {
        optionsRecord[key] = value;
      }
    }

    // Apply preprocessing (aliases already handled above, apply env and config)
    const preprocessedOptions = preprocessOptions(optionsRecord, {
      aliases: {}, // Already resolved aliases above
      envBindings,
      configKeys,
      configData: parseOptions?.configData,
      env: parseOptions?.env,
    });

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
          preprocessedOptions[name] = args.slice(argIndex, variadicEnd);
          argIndex = variadicEnd;
        } else {
          preprocessedOptions[name] = args[argIndex];
          argIndex++;
        }
      }
    }

    const optionsParsed = curCommand.options
      ? curCommand.options['~standard'].validate(preprocessedOptions)
      : { value: preprocessedOptions };

    if (optionsParsed instanceof Promise) {
      throw new Error('Async validation is not supported. Schema validate() must return a synchronous result.');
    }

    return {
      command: curCommand as any,
      options: optionsParsed.issues ? undefined : (optionsParsed.value as any),
      optionsResult: optionsParsed as any,
    };
  };

  const stringify: AnyPadroneProgram['stringify'] = (command = '' as any, options) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);

    const parts: string[] = [];

    if (commandObj.path) parts.push(commandObj.path);

    // Get positional config to determine which options are positional
    const positionalConfig = commandObj.meta?.positional ? parsePositionalConfig(commandObj.meta.positional) : [];
    const positionalNames = new Set(positionalConfig.map((p) => p.name));

    // Output positional arguments first in order
    if (options && typeof options === 'object') {
      for (const { name, variadic } of positionalConfig) {
        const value = (options as Record<string, unknown>)[name];
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

      // Output remaining options (non-positional)
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined || positionalNames.has(key)) continue;

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
        } else if (typeof value === 'string') {
          if (value.includes(' ')) parts.push(`--${key}="${value}"`);
          else parts.push(`--${key}=${value}`);
        } else {
          parts.push(`--${key}=${value}`);
        }
      }
    }

    return parts.join(' ');
  };

  type DetailLevel = 'minimal' | 'standard' | 'full';
  type FormatLevel = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json' | 'auto';

  /**
   * Check if help or version flags/commands are present in the input.
   * Returns the appropriate action to take, or null if normal execution should proceed.
   */
  const checkBuiltinCommands = (
    input: string | undefined,
  ): { type: 'help'; command?: AnyPadroneCommand; detail?: DetailLevel; format?: FormatLevel } | { type: 'version' } | null => {
    if (!input) return null;

    const parts = parseCliInputToParts(input);
    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const opts = parts.filter((p) => p.type === 'option' || p.type === 'alias');

    // Check for --help, -h flags (these take precedence over commands)
    const hasHelpFlag = opts.some((p) => (p.type === 'option' && p.key === 'help') || (p.type === 'alias' && p.key === 'h'));

    // Extract detail level from --detail=<level> or -d <level>
    const getDetailLevel = (): DetailLevel | undefined => {
      for (const opt of opts) {
        if (opt.type === 'option' && opt.key === 'detail' && typeof opt.value === 'string') {
          if (opt.value === 'minimal' || opt.value === 'standard' || opt.value === 'full') {
            return opt.value;
          }
        }
        if (opt.type === 'alias' && opt.key === 'd' && typeof opt.value === 'string') {
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
      for (const opt of opts) {
        if (opt.type === 'option' && opt.key === 'format' && typeof opt.value === 'string') {
          if (validFormats.includes(opt.value as FormatLevel)) {
            return opt.value as FormatLevel;
          }
        }
        if (opt.type === 'alias' && opt.key === 'f' && typeof opt.value === 'string') {
          if (validFormats.includes(opt.value as FormatLevel)) {
            return opt.value as FormatLevel;
          }
        }
      }
      return undefined;
    };
    const format = getFormat();

    // Check for --version, -v, -V flags
    const hasVersionFlag = opts.some(
      (p) => (p.type === 'option' && p.key === 'version') || (p.type === 'alias' && (p.key === 'v' || p.key === 'V')),
    );

    // If the first term is the program name, skip it
    const normalizedTerms = [...terms];
    if (normalizedTerms[0] === existingCommand.name) normalizedTerms.shift();

    // Check if user has defined 'help' or 'version' commands (they take precedence)
    const userHelpCommand = findCommandByName('help', existingCommand.commands);
    const userVersionCommand = findCommandByName('version', existingCommand.commands);

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
    const opts = parts.filter((p) => p.type === 'option' || p.type === 'alias');

    for (const opt of opts) {
      if (opt.type === 'option' && opt.key === 'config' && typeof opt.value === 'string') {
        return opt.value;
      }
      if (opt.type === 'alias' && opt.key === 'c' && typeof opt.value === 'string') {
        return opt.value;
      }
    }
    return undefined;
  };

  const cli: AnyPadroneProgram['cli'] = (input, cliOptions) => {
    // Resolve input from process.argv if not provided
    const resolvedInput = input ?? (typeof process !== 'undefined' ? (process.argv.slice(2).join(' ') as any) : undefined);

    // Check for built-in help/version commands and flags
    const builtin = checkBuiltinCommands(resolvedInput);

    if (builtin) {
      if (builtin.type === 'help') {
        const helpText = generateHelp(existingCommand, builtin.command ?? existingCommand, {
          detail: builtin.detail,
          format: builtin.format,
        });
        console.log(helpText);
        return {
          command: existingCommand,
          args: undefined,
          options: undefined,
          result: helpText,
        } as any;
      }

      if (builtin.type === 'version') {
        const version = getVersion(existingCommand.version);
        console.log(version);
        return {
          command: existingCommand,
          options: undefined,
          result: version,
        } as any;
      }
    }

    // Extract config file path from --config or -c flag
    const configPath = extractConfigPath(resolvedInput);
    const configData = configPath ? loadConfigFile(configPath) : cliOptions?.configData;

    const { command, options, optionsResult } = parse(resolvedInput, {
      ...cliOptions,
      configData: configData ?? cliOptions?.configData,
    });
    const res = run(command, options) as any;
    return {
      ...res,
      optionsResult,
    };
  };

  const run: AnyPadroneProgram['run'] = (command, options) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);
    if (!commandObj.handler) throw new Error(`Command "${commandObj.path}" has no handler`);

    const result = commandObj.handler(options as any);

    return {
      command: commandObj as any,
      options: options as any,
      result,
    };
  };

  const tool: AnyPadroneProgram['tool'] = () => {
    return {
      type: 'function',
      name: existingCommand.name,
      description: generateHelp(existingCommand, undefined, { format: 'text', detail: 'full' }),
      strict: true,
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
      title: existingCommand.description,
      needsApproval: (input) => {
        const { command, options } = parse(input.command);
        if (typeof command.needsApproval === 'function') return command.needsApproval(options);
        return !!command.needsApproval;
      },
      execute: (input) => {
        return cli(input.command).result;
      },
    };
  };

  return {
    description(description: string) {
      return createPadroneCommandBuilder({ ...existingCommand, description }) as any;
    },
    version(version: string) {
      return createPadroneCommandBuilder({ ...existingCommand, version }) as any;
    },
    options(options, meta) {
      return createPadroneCommandBuilder({ ...existingCommand, options, meta }) as any;
    },
    action(handler = noop) {
      return createPadroneCommandBuilder({ ...existingCommand, handler }) as any;
    },
    command: <TName extends string, TCommand extends PadroneCommand<TName, string, any, any, any>>(
      name: TName,
      builderFn?: (builder: PadroneCommandBuilder<TName>) => PadroneCommandBuilder,
    ) => {
      const initialCommand = {
        name,
        path: existingCommand.path ? `${existingCommand.path} ${name}` : name,
        parent: existingCommand,
        '~types': {} as any,
      } satisfies PadroneCommand<TName, any>;
      const builder = createPadroneCommandBuilder(initialCommand);

      const commandObj = ((builderFn?.(builder as any) as typeof builder)?.[commandSymbol] as TCommand) ?? initialCommand;
      return createPadroneCommandBuilder({ ...existingCommand, commands: [...(existingCommand.commands || []), commandObj] }) as any;
    },

    run,
    find,
    parse,
    stringify,
    cli,
    tool,

    api() {
      function buildApi(command: AnyPadroneCommand) {
        const runCommand = ((options) => run(command, options).result) as PadroneAPI<AnyPadroneCommand>;
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
      return generateHelp(existingCommand, commandObj, options);
    },

    '~types': {} as any,

    [commandSymbol]: existingCommand,
  } satisfies AnyPadroneProgram & { [commandSymbol]: AnyPadroneCommand } as unknown as TBuilder & { [commandSymbol]: AnyPadroneCommand };
}
