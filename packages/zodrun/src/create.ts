import { parseCliInputToParts } from './parse';
import type { AnyZodrunCommand, ZodrunCommand, ZodrunCommandBuilder, ZodrunCommandResult, ZodrunProgram } from './types';

const commandSymbol = Symbol('zodrun_command');

export function createZodrunCommandBuilder<TBuilder extends ZodrunProgram = ZodrunProgram>(
  existingCommand: AnyZodrunCommand,
): TBuilder & { [commandSymbol]: ZodrunCommand } {
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

  return {
    args(args) {
      return createZodrunCommandBuilder({ ...existingCommand, args }) as any;
    },
    options(options) {
      return createZodrunCommandBuilder({ ...existingCommand, options }) as any;
    },
    handle(handle) {
      return createZodrunCommandBuilder({ ...existingCommand, handle }) as any;
    },
    command: <TName extends string, TCommand extends ZodrunCommand<TName, any, any, any>>(
      name: TName,
      builderFn?: (builder: ZodrunCommandBuilder<TName>) => ZodrunCommandBuilder,
    ) => {
      const initialCommand = { name } as ZodrunCommand<TName>;
      const builder = createZodrunCommandBuilder(initialCommand);

      const commandObj = ((builderFn?.(builder as any) as typeof builder)?.[commandSymbol] as TCommand) ?? initialCommand;
      return createZodrunCommandBuilder({ ...existingCommand, commands: [...(existingCommand.commands || []), commandObj] }) as any;
    },

    parse: (input?: string) => {
      input ??= typeof process !== 'undefined' ? process.argv.slice(2).join(' ') : undefined;
      if (!input) return { command: '' };

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

      if (!curCommand) return { command: '' };

      const opts = parts.filter((p) => p.type === 'option' || p.type === 'alias');
      const optionsRecord: Record<string, string | boolean> = {};

      for (const opt of opts) {
        if (opt.type === 'option' || opt.type === 'alias') {
          optionsRecord[opt.key] = opt.value ?? true;
        }
      }

      return {
        command: commandTerms.join(' '),
        args,
        options: optionsRecord,
      };
    },

    cli(input?: string) {
      const { command, args, options } = this.parse(input);
      if (!command) return undefined;
      return this.run(command, args!, options!);
    },

    api() {
      const apiObj: Record<string, any> = {};

      const run = this.run.bind(this) as any;

      function buildApi(command: AnyZodrunCommand, obj: Record<string, any>, namePrefix = '') {
        if (!command.commands) return obj;

        for (const cmd of command.commands) {
          function runCommand(args: any, options: any) {
            return run(fullName, args, options);
          }

          const fullName = namePrefix ? `${namePrefix} ${cmd.name}` : cmd.name;
          buildApi(cmd, runCommand, fullName);
          obj[cmd.name] = runCommand;
        }
      }
      buildApi(existingCommand, apiObj);
      return apiObj;
    },

    run(command: string, args: unknown, options: unknown) {
      const commandObj = findCommandByName(command, existingCommand.commands);
      if (!commandObj) throw new Error(`Command "${command}" not found`);

      const result = commandObj.handle?.(args as any, options as any) as any;

      const ret: ZodrunCommandResult = {
        command,
        args: args as any,
        options: options as any,
        result,
      };

      return ret;
    },
    find(command: string) {
      return findCommandByName(command, existingCommand.commands);
    },

    [commandSymbol]: existingCommand,
  } as TBuilder & { [commandSymbol]: ZodrunCommand };
}
