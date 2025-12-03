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
  name: TName;
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
  /**
   * Defines the positional arguments schema for the command.
   */
  args: <TArgs extends unknown[] | void>(args: z.ZodType<TArgs>) => ZodrunCommandBuilder<TName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Defines the options schema for the command.
   */
  options: <TOpts extends UnknownRecord | void>(options: z.ZodType<TOpts>) => ZodrunCommandBuilder<TName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Defines the handler function to be executed when the command is run.
   */
  handle: <TRes>(run: (args: TArgs, options: TOpts) => TRes) => ZodrunCommandBuilder<TName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Creates a nested command within the current command with the given name and builder function.
   */
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
  /**
   * Creates a command within the program with the given name and builder function.
   */
  command: <TNameNested extends string, TBuilder extends ZodrunCommandBuilder<TNameNested, any, any, any, any>>(
    name: TNameNested,
    builderFn?: (builder: ZodrunCommandBuilder<TNameNested>) => TBuilder,
  ) => ZodrunProgram<TName, TArgs, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  /**
   * Runs a command programmatically by name with provided args and options.
   */
  run: <const TName extends GetCommandNames<TCommands>, TCommand extends AnyZodrunCommand = PickCommandByName<TCommands, TName>>(
    name: TName,
    args: NoInfer<GetArgs<TCommand>>,
    options: NoInfer<GetOptions<TCommand>>,
  ) => ZodrunCommandResult<TCommand>;

  /**
   * Runs the program as a CLI application, parsing `process.argv` or provided input.
   */
  cli: (input?: string) => ZodrunCommandResult<TCommands[number]> | undefined;

  /**
   * Parses CLI input (or the provided input string) into command, args, and options without executing anything.
   */
  parse: (input?: string) => ZodrunParseResult<TCommands[number]>;

  /**
   * Finds a command by name, returning `undefined` if not found.
   */
  find: <const TName extends GetCommandNames<TCommands>>(
    command: TName | (string & {}),
  ) => IsUnknown<TName> extends false
    ? TName extends string
      ? PickCommandByName<TCommands, TName>
      : TCommands[number] | undefined
    : TCommands[number] | undefined;

  /**
   * Generates a type-safe API for invoking commands programmatically.
   */
  api: () => ZodrunAPI<TCommands>;

  // TODO:

  /**
   * Starts an interactive prompt to run commands.
   */
  interactive: () => Promise<ZodrunCommandResult<TCommands[number]> | undefined>;

  /**
   * Starts a REPL (Read-Eval-Print Loop) for running commands interactively.
   */
  repl: () => Promise<ZodrunCommandResult<TCommands[number]>[]>;

  /**
   * Returns a tool definition that can be passed to AI SDK.
   */
  // tool: () => AISdkTool;

  /**
   * Returns the help information for the program or a specific command.
   */
  // help: (command?: string) => string;

  /**
   * Reflection information about the program.
   * Avoid using this in application code, unless you know what you're doing.
   * @deprecated Internal use only
   */
  '~types': {
    commands: TCommands;
  };
};

export type ZodrunCommandResult<TCommand extends AnyZodrunCommand = ZodrunCommand> = {
  command: TCommand['name'];
  args: GetArgs<TCommand>;
  options: GetOptions<TCommand>;
  result: GetResults<TCommand>;
};

export type ZodrunParseResult<TCommand extends AnyZodrunCommand = ZodrunCommand> = {
  command: TCommand['name'];
  args?: GetArgs<TCommand>;
  options?: GetOptions<TCommand>;
};

export type ZodrunAPI<TCommands extends [...AnyZodrunCommand[]] = [...AnyZodrunCommand[]]> = {
  [K in TCommands[number]['name']]: ZodrunAPICommand<PickCommandByName<TCommands, K>> &
    ZodrunAPI<PickCommandByName<TCommands, K>['~types']['commands']>;
};

export type ZodrunAPICommand<TCommand extends AnyZodrunCommand> = (
  args: GetArgs<TCommand>,
  options: GetOptions<TCommand>,
) => GetResults<TCommand>;

type GetArgs<TCommand extends AnyZodrunCommand> =
  IsUnknown<TCommand['~types']['args']> extends true ? void | [] : TCommand['~types']['args'];
type GetOptions<TCommand extends AnyZodrunCommand> =
  IsUnknown<TCommand['~types']['options']> extends true ? void | EmptyRecord : TCommand['~types']['options'];
type GetResults<TCommand extends AnyZodrunCommand> = TCommand['handle'] extends (...args: any[]) => infer TRes ? TRes : undefined;
