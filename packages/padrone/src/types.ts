import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Tool } from 'ai';
import type { HelpOptions } from './help';
import type { PadroneOptionsMeta } from './options';
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

export type PadroneCommand<
  TName extends string = string,
  TParentName extends string = '',
  TArgs extends ZArgs = ZDefaultArgs,
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
> = {
  name: TName;
  path: FullCommandName<TName, TParentName>;
  description?: string;
  needsApproval?: boolean | ((args: TArgs, options: TOpts) => Promise<boolean> | boolean);
  args?: ZArgs;
  options?: ZOpts;
  meta?: GetOptionsMeta<TOpts>;
  handler?: (args: TArgs, options: TOpts) => TRes;

  parent?: AnyPadroneCommand;
  commands?: TCommands;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    path: FullCommandName<TName, TParentName>;
    argsInput: StandardSchemaV1.InferInput<TArgs>;
    argsOutput: StandardSchemaV1.InferOutput<TArgs>;
    optionsInput: StandardSchemaV1.InferInput<TOpts>;
    optionsOutput: StandardSchemaV1.InferOutput<TOpts>;
    result: TRes;
    commands: TCommands;
  };
};

export type AnyPadroneCommand = PadroneCommand<string, any, any, any, any, [...AnyPadroneCommand[]]>;

export type PadroneCommandBuilder<
  TName extends string = string,
  TParentName extends string = '',
  TArgs extends ZArgs = ZDefaultArgs,
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
> = {
  /**
   * Defines the positional arguments schema for the command.
   */
  args: <TArgs extends ZArgs = StandardSchemaV1<void>>(
    args?: TArgs,
  ) => PadroneCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Defines the options schema for the command.
   */
  options: <TOpts extends ZOpts = StandardSchemaV1<void>>(
    options?: TOpts,
    meta?: GetOptionsMeta<TOpts>,
  ) => PadroneCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Defines the handler function to be executed when the command is run.
   */
  handle: <TRes>(
    handler?: (args: StandardSchemaV1.InferOutput<TArgs>, options: StandardSchemaV1.InferOutput<TOpts>) => TRes,
  ) => PadroneCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, TCommands>;

  /**
   * Creates a nested command within the current command with the given name and builder function.
   */
  command: <
    TNameNested extends string,
    TBuilder extends PadroneCommandBuilder<TNameNested, FullCommandName<TName, TParentName>, any, any, any, any>,
  >(
    name: TNameNested,
    builderFn?: (builder: PadroneCommandBuilder<TNameNested, FullCommandName<TName, TParentName>>) => TBuilder,
  ) => PadroneCommandBuilder<TName, TParentName, TArgs, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    path: FullCommandName<TName, TParentName>;
    args: TArgs;
    options: TOpts;
    result: TRes;
    commands: TCommands;
    command: PadroneCommand<TName, TParentName, TArgs, TOpts, TRes, TCommands>;
  };
};

export type PadroneProgram<
  TName extends string = string,
  TArgs extends ZArgs = ZDefaultArgs,
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TCmd extends PadroneCommand<'', '', TArgs, TOpts, TRes, TCommands> = PadroneCommand<'', '', TArgs, TOpts, TRes, TCommands>,
> = Omit<PadroneCommandBuilder<TName, '', TArgs, TOpts, TRes, TCommands>, 'command'> & {
  /**
   * Creates a command within the program with the given name and builder function.
   */
  command: <TNameNested extends string, TBuilder extends PadroneCommandBuilder<TNameNested, '', any, any, any, any>>(
    name: TNameNested,
    builderFn?: (builder: PadroneCommandBuilder<TNameNested, ''>) => TBuilder,
  ) => PadroneProgram<TName, TArgs, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  /**
   * Runs a command programmatically by name with provided args and options.
   */
  run: <const TCommand extends GetCommandNames<[TCmd]> | FlattenCommands<[TCmd]>>(
    name: TCommand,
    args: NoInfer<GetArgs<'in', PickCommandByName<[TCmd], TCommand>>>,
    options: NoInfer<GetOptions<'in', PickCommandByName<[TCmd], TCommand>>>,
  ) => PadroneCommandResult<PickCommandByName<[TCmd], TCommand>>;

  /**
   * Runs the program as a CLI application, parsing `process.argv` or provided input.
   */
  cli: <const TCommand extends PossibleCommands<[TCmd]>>(
    input?: TCommand,
  ) => Promise<PadroneCommandResult<PickCommandByPossibleCommands<[TCmd], TCommand>>>;

  /**
   * Parses CLI input (or the provided input string) into command, args, and options without executing anything.
   */
  parse: <const TCommand extends PossibleCommands<[TCmd]>>(
    input?: TCommand,
  ) => Promise<PadroneParseResult<PickCommandByPossibleCommands<[TCmd], TCommand>>>;

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
  api: () => PadroneAPI<TCmd>;

  // TODO: implement interactive and repl methods

  /**
   * Starts an interactive prompt to run commands.
   */
  // interactive: () => Promise<PadroneCommandResult<FlattenCommands<[TCmd]>> | undefined>;

  /**
   * Starts a REPL (Read-Eval-Print Loop) for running commands interactively.
   */
  // repl: () => Promise<PadroneCommandResult<FlattenCommands<[TCmd]>>[]>;

  /**
   * Returns a tool definition that can be passed to AI SDK.
   */
  tool: () => Promise<Tool>;

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

export type AnyPadroneProgram = PadroneProgram<string, any, any, any, [...AnyPadroneCommand[]]>;

export type PadroneCommandResult<TCommand extends AnyPadroneCommand = AnyPadroneCommand> = PadroneParseResult<TCommand> & {
  result: GetResults<TCommand>;
};

export type PadroneParseResult<TCommand extends AnyPadroneCommand = AnyPadroneCommand> = {
  command: TCommand;
  args?: GetArgs<'out', TCommand>;
  options?: GetOptions<'out', TCommand>;
  argsResult?: StandardSchemaV1.Result<GetArgs<'out', TCommand>>;
  optionsResult?: StandardSchemaV1.Result<GetOptions<'out', TCommand>>;
};

export type PadroneAPI<TCommand extends AnyPadroneCommand> = PadroneAPICommand<TCommand> & {
  [K in TCommand['~types']['commands'][number] as K['name']]: PadroneAPI<K>;
};

export type PadroneAPICommand<TCommand extends AnyPadroneCommand> = (
  args: GetArgs<'in', TCommand>,
  options: GetOptions<'in', TCommand>,
) => GetResults<TCommand>;

type NormalizeArgs<TArgs> = IsUnknown<TArgs> extends true ? void | [] : TArgs;
type GetArgs<TDir extends 'in' | 'out', TCommand extends AnyPadroneCommand> = TDir extends 'in'
  ? NormalizeArgs<TCommand['~types']['argsInput']>
  : NormalizeArgs<TCommand['~types']['argsOutput']>;

type NormalizeOptions<TOptions> = IsUnknown<TOptions> extends true ? void | EmptyRecord : TOptions;
type GetOptions<TDir extends 'in' | 'out', TCommand extends AnyPadroneCommand> = TDir extends 'in'
  ? NormalizeOptions<TCommand['~types']['optionsInput']>
  : NormalizeOptions<TCommand['~types']['optionsOutput']>;

type GetResults<TCommand extends AnyPadroneCommand> = ReturnType<NonNullable<TCommand['handler']>>;

type GetOptionsMeta<TOpts extends ZOpts> =
  NonNullable<StandardSchemaV1.InferInput<TOpts>> extends infer T extends object
    ? {
        [K in keyof T]?: PadroneOptionsMeta;
      }
    : never;
