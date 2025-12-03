import { parseCliInputToParts } from './parse';
import type { AnyZodrunCommand, AnyZodrunProgram, ZodrunAPI, ZodrunCommand, ZodrunCommandBuilder, ZodrunProgram } from './types';

const commandSymbol = Symbol('zodrun_command');

const noop = <TRes>() => undefined as TRes;

export function createZodrunCommandBuilder<TBuilder extends ZodrunProgram = ZodrunProgram>(
  existingCommand: AnyZodrunCommand,
): TBuilder & { [commandSymbol]: AnyZodrunCommand } {
  function findCommandByName(name: string, commands?: AnyZodrunCommand[]): AnyZodrunCommand | undefined {
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

  const find: AnyZodrunProgram['find'] = (command) => {
    return findCommandByName(command, existingCommand.commands) as ReturnType<AnyZodrunProgram['find']>;
  };

  const parse: AnyZodrunProgram['parse'] = (input) => {
    input ??= typeof process !== 'undefined' ? (process.argv.slice(2).join(' ') as any) : undefined;
    if (!input) return { command: existingCommand as any };

    const parts = parseCliInputToParts(input);

    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'arg').map((p) => p.value);

    let curCommand: AnyZodrunCommand | undefined = existingCommand;

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
    const optionsRecord: Record<string, string | boolean> = {};

    for (const opt of opts) {
      if (opt.type === 'option' || opt.type === 'alias') {
        optionsRecord[opt.key] = opt.value ?? true;
      }
    }

    const argsParsed = curCommand.args ? curCommand.args.safeParse(args) : { success: true, data: args, error: undefined };
    const optionsParsed = curCommand.options
      ? curCommand.options.safeParse(optionsRecord)
      : { success: true, data: optionsRecord, error: undefined };

    return {
      command: curCommand as any,
      args: argsParsed.data,
      options: optionsParsed.data as any,
      argsResult: argsParsed as any,
      optionsResult: optionsParsed as any,
    };
  };

  const cli: AnyZodrunProgram['cli'] = (input) => {
    const { command, args, options, argsResult, optionsResult } = parse(input);
    const res = run(command, args, options) as any;
    return {
      ...res,
      argsResult,
      optionsResult,
    };
  };

  const run: AnyZodrunProgram['run'] = (command, args, options) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyZodrunCommand);
    if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);
    if (!commandObj.handler) throw new Error(`Command "${commandObj.fullName}" has no handler`);

    const result = commandObj.handler(args as any, options as any);

    return {
      command: commandObj as any,
      args: args as any,
      options: options as any,
      result,
    };
  };

  return {
    args(args) {
      return createZodrunCommandBuilder({ ...existingCommand, args }) as any;
    },
    options(options) {
      return createZodrunCommandBuilder({ ...existingCommand, options }) as any;
    },
    handle(handle = noop) {
      return createZodrunCommandBuilder({ ...existingCommand, handler: handle }) as any;
    },
    command: <TName extends string, TCommand extends ZodrunCommand<TName, string, any, any, any, any>>(
      name: TName,
      builderFn?: (builder: ZodrunCommandBuilder<TName>) => ZodrunCommandBuilder,
    ) => {
      const initialCommand = {
        name,
        fullName: existingCommand.fullName ? `${existingCommand.fullName} ${name}` : name,
        parent: existingCommand,
        '~types': {} as any,
      } satisfies ZodrunCommand<TName, any>;
      const builder = createZodrunCommandBuilder(initialCommand);

      const commandObj = ((builderFn?.(builder as any) as typeof builder)?.[commandSymbol] as TCommand) ?? initialCommand;
      return createZodrunCommandBuilder({ ...existingCommand, commands: [...(existingCommand.commands || []), commandObj] }) as any;
    },

    run,
    find,
    parse,
    cli,

    api() {
      function buildApi(command: AnyZodrunCommand) {
        const runCommand = ((args, options) => run(command, args, options).result) as ZodrunAPI<AnyZodrunCommand>;
        if (!command.commands) return runCommand;
        for (const cmd of command.commands) runCommand[cmd.name] = buildApi(cmd);
        return runCommand;
      }

      return buildApi(existingCommand);
    },

    interactive() {
      return Promise.resolve(undefined);
    },

    repl() {
      return Promise.resolve([]);
    },

    '~types': {} as any,

    [commandSymbol]: existingCommand,
  } satisfies AnyZodrunProgram & { [commandSymbol]: AnyZodrunCommand } as unknown as TBuilder & { [commandSymbol]: AnyZodrunCommand };
}
