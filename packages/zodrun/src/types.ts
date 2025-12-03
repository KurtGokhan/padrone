import { z } from 'zod';
import type {
  FullCommandName,
  GetCommandNames,
  IsUnknown,
  PickCommandByName,
  PickCommandByPossibleCommands,
  PossibleCommands,
} from './type-utils';

type UnknownRecord = Record<string, unknown>;
type EmptyRecord = Record<string, never>;

type DefaultArgs = unknown[] | void;
type DefaultOpts = UnknownRecord | void;
type ZArgs = z.ZodType<any>;
type ZOpts = z.ZodType<any>;
type ZDefaultArgs = z.ZodType<DefaultArgs>;
type ZDefaultOpts = z.ZodType<DefaultOpts>;

export type ZodrunCommand<
  TName extends string = string,
  TParentName extends string = '',
  TArgs extends ZArgs = ZDefaultArgs,
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyZodrunCommand[]] = [],
> = {
  name: TName;
  fullName: FullCommandName<TName, TParentName>;
  args?: ZArgs;
  options?: ZOpts;
  handler?: (args: TArgs, options: TOpts) => TRes;

  parent?: AnyZodrunCommand;
  commands?: TCommands;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    fullName: FullCommandName<TName, TParentName>;
    argsInput: z.input<TArgs>;
    argsOutput: z.output<TArgs>;
    optionsInput: z.input<TOpts>;
    optionsOutput: z.output<TOpts>;
    result: TRes;
    commands: TCommands;
  };
};

export type AnyZodrunCommand = ZodrunCommand<string, any, any, any, any, [...AnyZodrunCommand[]]>;

export type ZodrunCommandBuilder<
  TName extends string = string,
  TParentName extends string = '',
  TArgs extends ZArgs = ZDefaultArgs,
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyZodrunCommand[]] = [],
> = {
  /**
   * Defines the positional arguments schema for the command.
   */
  args: <TArgs extends ZArgs = z.ZodVoid>(args?: TArgs) => ZodrunCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Defines the options schema for the command.
   */
  options: <TOpts extends ZOpts = z.ZodVoid>(options?: TOpts) => ZodrunCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Defines the handler function to be executed when the command is run.
   */
  handle: <TRes>(
    handler?: (args: z.output<TArgs>, options: z.output<TOpts>) => TRes,
  ) => ZodrunCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Creates a nested command within the current command with the given name and builder function.
   */
  command: <
    TNameNested extends string,
    TBuilder extends ZodrunCommandBuilder<TNameNested, FullCommandName<TName, TParentName>, any, any, any, any>,
  >(
    name: TNameNested,
    builderFn?: (builder: ZodrunCommandBuilder<TNameNested, FullCommandName<TName, TParentName>>) => TBuilder,
  ) => ZodrunCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    fullName: FullCommandName<TName, TParentName>;
    args: TArgs;
    options: TOpts;
    result: TRes;
    commands: TCommands;
    command: ZodrunCommand<TName, TParentName, TArgs, TOpts, TRes, TCommands>;
  };
};

export type ZodrunProgram<
  TName extends string = string,
  TArgs extends ZArgs = ZDefaultArgs,
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyZodrunCommand[]] = [],
> = Omit<ZodrunCommandBuilder<TName, '', TArgs, TOpts, TRes, TCommands>, 'command'> & {
  /**
   * Creates a command within the program with the given name and builder function.
   */
  command: <TNameNested extends string, TBuilder extends ZodrunCommandBuilder<TNameNested, '', any, any, any, any>>(
    name: TNameNested,
    builderFn?: (builder: ZodrunCommandBuilder<TNameNested, ''>) => TBuilder,
  ) => ZodrunProgram<TName, TArgs, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  /**
   * Runs a command programmatically by name with provided args and options.
   */
  run: <const TCommand extends GetCommandNames<TCommands> | TCommands[number]>(
    name: TCommand,
    args: NoInfer<GetArgs<'in', PickCommandByName<TCommands, TCommand>>>,
    options: NoInfer<GetOptions<'in', PickCommandByName<TCommands, TCommand>>>,
  ) => ZodrunCommandResult<PickCommandByName<TCommands, TCommand>>;

  /**
   * Runs the program as a CLI application, parsing `process.argv` or provided input.
   */
  cli: <const TCommand extends PossibleCommands<TCommands>>(
    input?: TCommand,
  ) => ZodrunCommandResult<PickCommandByPossibleCommands<TCommands, TCommand>>;

  /**
   * Parses CLI input (or the provided input string) into command, args, and options without executing anything.
   */
  parse: <const TCommand extends PossibleCommands<TCommands>>(
    input?: TCommand,
  ) => ZodrunParseResult<PickCommandByPossibleCommands<TCommands, TCommand>>;

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
  api: () => ZodrunAPI<ZodrunCommand<'', '', TArgs, TOpts, TRes, TCommands>>;

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

export type AnyZodrunProgram = ZodrunProgram<string, any, any, any, [...AnyZodrunCommand[]]>;

export type ZodrunCommandResult<TCommand extends AnyZodrunCommand = AnyZodrunCommand> = ZodrunParseResult<TCommand> & {
  result: GetResults<TCommand>;
};

export type ZodrunParseResult<TCommand extends AnyZodrunCommand = AnyZodrunCommand> = {
  command: TCommand;
  args?: GetArgs<'out', TCommand>;
  options?: GetOptions<'out', TCommand>;
  argsResult?: z.ZodSafeParseResult<GetArgs<'out', TCommand>>;
  optionsResult?: z.ZodSafeParseResult<GetOptions<'out', TCommand>>;
};

export type ZodrunAPI<TCommand extends AnyZodrunCommand> = ZodrunAPICommand<TCommand> & {
  [K in TCommand['~types']['commands'][number]['name']]: ZodrunAPI<PickCommandByName<TCommand['~types']['commands'], K>>;
};

export type ZodrunAPICommand<TCommand extends AnyZodrunCommand> = (
  args: GetArgs<'in', TCommand>,
  options: GetOptions<'in', TCommand>,
) => GetResults<TCommand>;

type NormalizeArgs<TArgs> = IsUnknown<TArgs> extends true ? void | [] : TArgs;
type GetArgs<TDir extends 'in' | 'out', TCommand extends AnyZodrunCommand> = TDir extends 'in'
  ? NormalizeArgs<TCommand['~types']['argsInput']>
  : NormalizeArgs<TCommand['~types']['argsOutput']>;

type NormalizeOptions<TOptions> = IsUnknown<TOptions> extends true ? void | EmptyRecord : TOptions;
type GetOptions<TDir extends 'in' | 'out', TCommand extends AnyZodrunCommand> = TDir extends 'in'
  ? NormalizeOptions<TCommand['~types']['optionsInput']>
  : NormalizeOptions<TCommand['~types']['optionsOutput']>;

type GetResults<TCommand extends AnyZodrunCommand> = ReturnType<NonNullable<TCommand['handler']>>;
