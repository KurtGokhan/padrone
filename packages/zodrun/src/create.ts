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

    cli(input?: string) {
      return undefined as any;
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

    [commandSymbol]: existingCommand,
  } as TBuilder & { [commandSymbol]: ZodrunCommand };
}
