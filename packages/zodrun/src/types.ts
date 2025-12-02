import { z } from 'zod';
import type { GetCommandNames, IsUnknown, PickCommandByName } from './type-utils';

type UnknownRecord = Record<string, unknown>;
type EmptyRecord = Record<string, never>;

export type ZodrunCommand<
  TName extends string = string,
  TArgs extends unknown[] | void = unknown[] | void,
  TOpts extends UnknownRecord | void = UnknownRecord | void,
  TRes = void,
  TCommands extends [...AnyZodrunCommand[]] = [],
> = {
  command: TName;
  args?: z.ZodType<TArgs>;
  options?: z.ZodType<TOpts>;
  handle?: (args: TArgs, options: TOpts) => TRes;

  commands?: TCommands;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    args: TArgs;
    options: TOpts;
    result: TRes;
    commands: TCommands;
  };
};

export type AnyZodrunCommand = ZodrunCommand<string, any, any, any, [...AnyZodrunCommand[]]>;

export type ZodrunCommandBuilder<
  TName extends string = string,
  TArgs extends unknown[] | void = unknown[] | void,
  TOpts extends UnknownRecord | void = UnknownRecord | void,
  TRes = void,
  TCommands extends [...AnyZodrunCommand[]] = [],
> = {
  args: <TArgs extends unknown[] | void>(args: z.ZodType<TArgs>) => ZodrunCommandBuilder<TName, TArgs, TOpts, TRes, TCommands>;
  options: <TOpts extends UnknownRecord | void>(options: z.ZodType<TOpts>) => ZodrunCommandBuilder<TName, TArgs, TOpts, TRes, TCommands>;
  handle: <TRes>(run: (args: TArgs, options: TOpts) => TRes) => ZodrunCommandBuilder<TName, TArgs, TOpts, TRes, TCommands>;

  command: <TNameNested extends string, TBuilder extends ZodrunCommandBuilder<TNameNested, any, any, any, any>>(
    name: TNameNested,
    builderFn?: (builder: ZodrunCommandBuilder<TNameNested>) => TBuilder,
  ) => ZodrunCommandBuilder<TName, TArgs, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    args: TArgs;
    options: TOpts;
    result: TRes;
    commands: TCommands;
    command: ZodrunCommand<TName, TArgs, TOpts, TRes, TCommands>;
  };
};

export type ZodrunProgram<
  TName extends string = string,
  TArgs extends unknown[] | void = unknown[] | void,
  TOpts extends UnknownRecord | void = UnknownRecord | void,
  TRes = void,
  TCommands extends [...AnyZodrunCommand[]] = [],
> = Omit<ZodrunCommandBuilder<TName, TArgs, TOpts, TRes, TCommands>, 'command'> & {
  command: <TNameNested extends string, TBuilder extends ZodrunCommandBuilder<TNameNested, any, any, any, any>>(
    name: TNameNested,
    builderFn?: (builder: ZodrunCommandBuilder<TNameNested>) => TBuilder,
  ) => ZodrunProgram<TName, TArgs, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  run: <const TName extends GetCommandNames<TCommands>, TCommand extends AnyZodrunCommand = PickCommandByName<TCommands, TName>>(
    name: TName,
    args: NoInfer<GetArgs<TCommand>>,
    options: NoInfer<GetOptions<TCommand>>,
  ) => ZodrunCommandResult<TCommand>;
  cli: (input?: string) => ZodrunCommandResult<TCommands[number]> | undefined;

  parse: (input: string) => ZodrunParseResult<TCommands[number]>;

  // TODO:
  // interactive: () => Promise<ZodrunCommandResult<TCommands[number]> | undefined>;
  // repl: () => Promise<ZodrunCommandResult<TCommands[number]>[]>;
  // tool: () => AISdkTool;
  // help: (command?: string) => void;

  /**
   * Reflection information about the program.
   * Avoid using this in application code, unless you know what you're doing.
   */
  '~types': {
    commands: TCommands;
  };
};

export type ZodrunCommandResult<TCommand extends AnyZodrunCommand = ZodrunCommand> = {
  command: TCommand['command'];
  args: GetArgs<TCommand>;
  options: GetOptions<TCommand>;
  result: GetResults<TCommand>;
};

export type ZodrunParseResult<TCommand extends AnyZodrunCommand = ZodrunCommand> =
  | {
      command: TCommand['command'];
      args?: GetArgs<TCommand>;
      options?: GetOptions<TCommand>;
    }
  | undefined;

type GetArgs<TCommand extends AnyZodrunCommand> =
  IsUnknown<TCommand['~types']['args']> extends true ? void | [] : TCommand['~types']['args'];
type GetOptions<TCommand extends AnyZodrunCommand> =
  IsUnknown<TCommand['~types']['options']> extends true ? void | EmptyRecord : TCommand['~types']['options'];
type GetResults<TCommand extends AnyZodrunCommand> = TCommand['handle'] extends (...args: any[]) => infer TRes ? TRes : undefined;
