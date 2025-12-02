import { z } from 'zod';

type UnknownRecord = Record<string, unknown>;
type EmptyRecord = Record<string, never>;

export type ZodrunCommand<
  TName extends string = string,
  TArgs extends unknown[] | void = unknown[] | void,
  TOpts extends UnknownRecord | void = UnknownRecord | void,
  TRes = void,
  TCommands extends [...AnyZodrunCommand[]] = [],
> = {
  name: TName;
  args?: z.ZodType<TArgs>;
  options?: z.ZodType<TOpts>;
  run?: (args: TArgs, options: TOpts) => TRes;

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

export type AnyZodrunCommand = ZodrunCommand<any, any, any, any, any>;

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
    args: NoInfer<GetCommandTypes<TCommand>['args']>,
    options: NoInfer<GetCommandTypes<TCommand>['options']>,
  ) => ZodrunCommandResult<TCommand>;
  cli: (input?: string) => ZodrunCommandResult<TCommands[number]> | undefined;

  parse: (input: string) => ZodrunParseResult<TCommands[number]>;

  /**
   * Reflection information about the program.
   * Avoid using this in application code, unless you know what you're doing.
   */
  '~types': {
    commands: TCommands;
  };
};

export type ZodrunCommandResult<TCommand extends AnyZodrunCommand = ZodrunCommand> = GetCommandTypes<TCommand>;
export type ZodrunParseResult<TCommand extends AnyZodrunCommand = ZodrunCommand> =
  | {
      name: TCommand['name'];
      args?: GetCommandTypes<TCommand>['args'];
      options?: GetCommandTypes<TCommand>['options'];
    }
  | undefined;

type GetCommandTypes<TCommand extends AnyZodrunCommand> = {
  name: TCommand['name'];
  args: IsUnknown<TCommand['~types']['args']> extends true ? void | [] : TCommand['~types']['args'];
  options: IsUnknown<TCommand['~types']['options']> extends true ? void | EmptyRecord : TCommand['~types']['options'];
  result: TCommand['run'] extends (...args: any[]) => infer TRes ? TRes : undefined;
};

type IsUnknown<T> = unknown extends T ? true : false;

type PickCommandByName<TCommands extends AnyZodrunCommand[], TName extends string> = TCommands extends [
  infer FirstCommand,
  ...infer RestCommands,
]
  ? FirstCommand extends AnyZodrunCommand
    ? FirstCommand['name'] extends TName
      ? FirstCommand
      : RestCommands extends AnyZodrunCommand[]
        ? PickCommandByName<RestCommands, TName>
        : never
    : never
  : never;

type GetCommandNames<TCommands extends AnyZodrunCommand[]> = TCommands extends [infer FirstCommand, ...infer RestCommands]
  ? FirstCommand extends AnyZodrunCommand
    ?
        | FirstCommand['name']
        | (FirstCommand['~types']['commands'] extends AnyZodrunCommand[]
            ? `${FirstCommand['name']} ${GetCommandNames<FirstCommand['~types']['commands']>}`
            : never)
        | (RestCommands extends AnyZodrunCommand[] ? GetCommandNames<RestCommands> : never)
    : never
  : never;
