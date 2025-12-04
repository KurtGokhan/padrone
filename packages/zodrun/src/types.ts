import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { HelpOptions } from './help';
import type { ZodrunOptionsMeta } from './options';
import type {
  FlattenCommands,
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
type ZArgs = StandardSchemaV1;
type ZOpts = StandardSchemaV1;
type ZDefaultArgs = StandardSchemaV1<DefaultArgs>;
type ZDefaultOpts = StandardSchemaV1<DefaultOpts>;

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
  meta?: GetOptionsMeta<TOpts>;
  handler?: (args: TArgs, options: TOpts) => TRes;

  parent?: AnyZodrunCommand;
  commands?: TCommands;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    fullName: FullCommandName<TName, TParentName>;
    argsInput: StandardSchemaV1.InferInput<TArgs>;
    argsOutput: StandardSchemaV1.InferOutput<TArgs>;
    optionsInput: StandardSchemaV1.InferInput<TOpts>;
    optionsOutput: StandardSchemaV1.InferOutput<TOpts>;
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
  args: <TArgs extends ZArgs = StandardSchemaV1<void>>(
    args?: TArgs,
  ) => ZodrunCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Defines the options schema for the command.
   */
  options: <TOpts extends ZOpts = StandardSchemaV1<void>>(
    options?: TOpts,
    meta?: GetOptionsMeta<TOpts>,
  ) => ZodrunCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Defines the handler function to be executed when the command is run.
   */
  handle: <TRes>(
    handler?: (args: StandardSchemaV1.InferOutput<TArgs>, options: StandardSchemaV1.InferOutput<TOpts>) => TRes,
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
  TCmd extends ZodrunCommand<'', '', TArgs, TOpts, TRes, TCommands> = ZodrunCommand<'', '', TArgs, TOpts, TRes, TCommands>,
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
  run: <const TCommand extends GetCommandNames<[TCmd]> | FlattenCommands<[TCmd]>>(
    name: TCommand,
    args: NoInfer<GetArgs<'in', PickCommandByName<[TCmd], TCommand>>>,
    options: NoInfer<GetOptions<'in', PickCommandByName<[TCmd], TCommand>>>,
  ) => ZodrunCommandResult<PickCommandByName<[TCmd], TCommand>>;

  /**
   * Runs the program as a CLI application, parsing `process.argv` or provided input.
   */
  cli: <const TCommand extends PossibleCommands<[TCmd]>>(
    input?: TCommand,
  ) => Promise<ZodrunCommandResult<PickCommandByPossibleCommands<[TCmd], TCommand>>>;

  /**
   * Parses CLI input (or the provided input string) into command, args, and options without executing anything.
   */
  parse: <const TCommand extends PossibleCommands<[TCmd]>>(
    input?: TCommand,
  ) => Promise<ZodrunParseResult<PickCommandByPossibleCommands<[TCmd], TCommand>>>;

  /**
   * Finds a command by name, returning `undefined` if not found.
   */
  find: <const TName extends GetCommandNames<[TCmd]>>(
    command: TName | (string & {}),
  ) => IsUnknown<TName> extends false
    ? TName extends string
      ? PickCommandByName<[TCmd], TName>
      : FlattenCommands<[TCmd]> | undefined
    : FlattenCommands<[TCmd]> | undefined;

  /**
   * Generates a type-safe API for invoking commands programmatically.
   */
  api: () => ZodrunAPI<TCmd>;

  // TODO:

  /**
   * Starts an interactive prompt to run commands.
   */
  interactive: () => Promise<ZodrunCommandResult<FlattenCommands<[TCmd]>> | undefined>;

  /**
   * Starts a REPL (Read-Eval-Print Loop) for running commands interactively.
   */
  repl: () => Promise<ZodrunCommandResult<FlattenCommands<[TCmd]>>[]>;

  /**
   * Returns a tool definition that can be passed to AI SDK.
   */
  // tool: () => AISdkTool;

  /**
   * Returns the help information for the program or a specific command.
   */
  help: <const TCommand extends GetCommandNames<[TCmd]> | FlattenCommands<[TCmd]>>(
    command?: TCommand,
    options?: HelpOptions,
  ) => Promise<string>;

  /**
   * Reflection information about the program.
   * Avoid using this in application code, unless you know what you're doing.
   * @deprecated Internal use only
   */
  '~types': {
    command: TCmd;
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
  argsResult?: StandardSchemaV1.Result<GetArgs<'out', TCommand>>;
  optionsResult?: StandardSchemaV1.Result<GetOptions<'out', TCommand>>;
};

export type ZodrunAPI<TCommand extends AnyZodrunCommand> = ZodrunAPICommand<TCommand> & {
  [K in TCommand['~types']['commands'][number] as K['name']]: ZodrunAPI<K>;
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

type GetOptionsMeta<TOpts extends ZOpts> =
  NonNullable<StandardSchemaV1.InferInput<TOpts>> extends infer T extends object
    ? {
        [K in keyof T]?: ZodrunOptionsMeta;
      }
    : never;
