import type { Schema } from 'ai';
import { generateHelp } from './help';
import { extractAliasesFromSchema, preprocessAliases } from './options';
import { parseCliInputToParts } from './parse';
import type { AnyPadroneCommand, AnyPadroneProgram, PadroneAPI, PadroneCommand, PadroneCommandBuilder, PadroneProgram } from './types';

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

  const parse: AnyPadroneProgram['parse'] = async (input) => {
    input ??= typeof process !== 'undefined' ? (process.argv.slice(2).join(' ') as any) : undefined;
    if (!input) return { command: existingCommand as any };

    const parts = parseCliInputToParts(input);

    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'arg').map((p) => p.value);

    let curCommand: AnyPadroneCommand | undefined = existingCommand;

    const commandTerms: string[] = [];

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

    const opts = parts.filter((p) => p.type === 'option' || p.type === 'alias');
    const optionsRecord: Record<string, unknown> = {};

    for (const opt of opts) {
      if (opt.type === 'option') optionsRecord[opt.key] = opt.value ?? true;
      else if (opt.type === 'alias') optionsRecord[opt.key] = opt.value ?? true;
    }

    let preprocessedOptions = optionsRecord;
    if (curCommand.options) {
      const aliases = await extractAliasesFromSchema(curCommand.options, curCommand.meta);
      if (Object.keys(aliases).length > 0) preprocessedOptions = preprocessAliases(optionsRecord, aliases);
    }

    let optionsParsed = curCommand.options ? curCommand.options['~standard'].validate(preprocessedOptions) : { value: preprocessedOptions };
    if (optionsParsed instanceof Promise) optionsParsed = await optionsParsed;

    let argsParsed = curCommand.args ? curCommand.args['~standard'].validate(args) : { value: args };
    if (argsParsed instanceof Promise) argsParsed = await argsParsed;

    return {
      command: curCommand as any,
      args: argsParsed.issues ? undefined : (argsParsed.value as any),
      options: optionsParsed.issues ? undefined : (optionsParsed.value as any),
      argsResult: argsParsed as any,
      optionsResult: optionsParsed as any,
    };
  };

  const cli: AnyPadroneProgram['cli'] = async (input) => {
    const { command, args, options, argsResult, optionsResult } = await parse(input);
    const res = run(command, args, options) as any;
    return {
      ...res,
      argsResult,
      optionsResult,
    };
  };

  const run: AnyPadroneProgram['run'] = (command, args, options) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);
    if (!commandObj.handler) throw new Error(`Command "${commandObj.path}" has no handler`);

    const result = commandObj.handler(args as any, options as any);

    return {
      command: commandObj as any,
      args: args as any,
      options: options as any,
      result,
    };
  };

  const tool: AnyPadroneProgram['tool'] = async () => {
    return {
      type: 'function',
      name: existingCommand.name,
      description: await generateHelp(existingCommand, undefined, { format: 'text' }),
      inputSchema: {
        [Symbol.for('vercel.ai.schema') as keyof Schema & symbol]: true,
        jsonSchema: { type: 'string' },
        _type: undefined as unknown,
        validate: (value) => {
          if (typeof value === 'string') return { success: true, value };
          return { success: false, error: new Error('Expected a string') };
        },
      } satisfies Schema as Schema,
      title: existingCommand.description,
      needsApproval: async (input) => {
        const { command, options, args } = await parse(input);
        if (typeof command.needsApproval === 'function') return command.needsApproval(args, options);
        return !!command.needsApproval;
      },
      execute: async (input) => {
        return (await cli(input)).result;
      },
    };
  };

  return {
    args(args) {
      return createPadroneCommandBuilder({ ...existingCommand, args }) as any;
    },
    options(options, meta) {
      return createPadroneCommandBuilder({ ...existingCommand, options, meta }) as any;
    },
    handle(handle = noop) {
      return createPadroneCommandBuilder({ ...existingCommand, handler: handle }) as any;
    },
    command: <TName extends string, TCommand extends PadroneCommand<TName, string, any, any, any, any>>(
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
    cli,
    tool,

    api() {
      function buildApi(command: AnyPadroneCommand) {
        const runCommand = ((args, options) => run(command, args, options).result) as PadroneAPI<AnyPadroneCommand>;
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
