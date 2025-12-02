import type { AnyZodrunCommand, ZodrunCommand, ZodrunCommandBuilder, ZodrunCommandResult, ZodrunProgram } from './types';

const commandSymbol = Symbol('zodrun_command');

export function createZodrunCommandBuilder<TBuilder extends ZodrunProgram = ZodrunProgram>(
  existingCommand: ZodrunCommand,
  commands: AnyZodrunCommand[] = [],
): TBuilder & { [commandSymbol]: ZodrunCommand } {
  return {
    args(args) {
      return createZodrunCommandBuilder(
        {
          ...existingCommand,
          args,
        },
        commands,
      ) as any;
    },
    options(options) {
      return createZodrunCommandBuilder(
        {
          ...existingCommand,
          options,
        },
        commands,
      ) as any;
    },
    handle(run) {
      return createZodrunCommandBuilder(
        {
          ...existingCommand,
          run,
        },
        commands,
      ) as any;
    },
    command: <TName extends string, TCommand extends ZodrunCommand<TName, any, any, any>>(
      name: TName,
      builderFn?: (builder: ZodrunCommandBuilder<TName>) => ZodrunCommandBuilder,
    ) => {
      const initialCommand = { name } as ZodrunCommand<TName>;
      const builder = createZodrunCommandBuilder(initialCommand, commands);

      const command = ((builderFn?.(builder as any) as typeof builder)?.[commandSymbol] as TCommand) ?? initialCommand;
      return createZodrunCommandBuilder(command, [...commands, command]) as any;
    },

    cli(input?: string) {
      return undefined as any;
    },
    run(name: string, args: unknown, options: unknown) {
      const command = commands.find((cmd) => cmd.name === name);
      if (!command) {
        throw new Error(`Command "${name}" not found`);
      }
      const result = command.run?.(args as any, options as any) as any;

      const ret: ZodrunCommandResult = {
        name: command.name,
        args: args as any,
        options: options as any,
        result,
      };

      return ret;
    },

    [commandSymbol]: existingCommand,
  } as TBuilder & { [commandSymbol]: ZodrunCommand };
}
