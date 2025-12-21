import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { Tool } from 'ai';
import type { HelpOptions } from './help';
import type { PadroneMeta } from './options';
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

type DefaultOpts = UnknownRecord | void;

/**
 * A schema that supports both validation (StandardSchemaV1) and JSON schema generation (StandardJSONSchemaV1).
 * This is the type required for command arguments and options in Padrone.
 */
export type PadroneSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> & StandardJSONSchemaV1<Input, Output>;

type ZOpts = PadroneSchema;
type ZDefaultOpts = PadroneSchema<DefaultOpts>;

export type PadroneCommand<
  TName extends string = string,
  TParentName extends string = '',
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
> = {
  name: TName;
  path: FullCommandName<TName, TParentName>;
  description?: string;
  version?: string;
  needsApproval?: boolean | ((options: TOpts) => Promise<boolean> | boolean);
  options?: ZOpts;
  meta?: GetMeta<TOpts>;
  handler?: (options: StandardSchemaV1.InferOutput<TOpts>) => TRes;

  parent?: AnyPadroneCommand;
  commands?: TCommands;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    path: FullCommandName<TName, TParentName>;
    optionsInput: StandardSchemaV1.InferInput<TOpts>;
    optionsOutput: StandardSchemaV1.InferOutput<TOpts>;
    result: TRes;
    commands: TCommands;
  };
};

export type AnyPadroneCommand = PadroneCommand<string, any, any, any, [...AnyPadroneCommand[]]>;

export type PadroneCommandBuilder<
  TName extends string = string,
  TParentName extends string = '',
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
> = {
  /**
   * Defines the options schema for the command, including positional arguments.
   * Use the `positional` array in meta to specify which options are positional args.
   * Use '...name' prefix for variadic (rest) arguments, matching JS/TS rest syntax.
   *
   * @example
   * ```ts
   * .options(z.object({
   *   source: z.string(),
   *   files: z.string().array(),
   *   dest: z.string(),
   *   recursive: z.boolean().default(false),
   * }), {
   *   positional: ['source', '...files', 'dest'],
   * })
   * ```
   */
  options: <TOpts extends ZOpts = PadroneSchema<void>>(
    options?: TOpts,
    meta?: GetMeta<TOpts>,
  ) => PadroneCommandBuilder<TName, TParentName, TOpts, TRes, TCommands>;

  /**
   * Defines the handler function to be executed when the command is run.
   */
  action: <TRes>(
    handler?: (options: StandardSchemaV1.InferOutput<TOpts>) => TRes,
  ) => PadroneCommandBuilder<TName, TParentName, TOpts, TRes, TCommands>;

  /**
   * Creates a nested command within the current command with the given name and builder function.
   */
  command: <
    TNameNested extends string,
    TBuilder extends PadroneCommandBuilder<TNameNested, FullCommandName<TName, TParentName>, any, any, any>,
  >(
    name: TNameNested,
    builderFn?: (builder: PadroneCommandBuilder<TNameNested, FullCommandName<TName, TParentName>>) => TBuilder,
  ) => PadroneCommandBuilder<TName, TParentName, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    path: FullCommandName<TName, TParentName>;
    options: TOpts;
    result: TRes;
    commands: TCommands;
    command: PadroneCommand<TName, TParentName, TOpts, TRes, TCommands>;
  };
};

export type PadroneProgram<
  TName extends string = string,
  TOpts extends ZOpts = ZDefaultOpts,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TCmd extends PadroneCommand<'', '', TOpts, TRes, TCommands> = PadroneCommand<'', '', TOpts, TRes, TCommands>,
> = Omit<PadroneCommandBuilder<TName, '', TOpts, TRes, TCommands>, 'command'> & {
  /**
   * Sets the description for the program.
   */
  description: (description: string) => PadroneProgram<TName, TOpts, TRes, TCommands>;

  /**
   * Sets the version for the program.
   */
  version: (version: string) => PadroneProgram<TName, TOpts, TRes, TCommands>;
  /**
   * Creates a command within the program with the given name and builder function.
   */
  command: <TNameNested extends string, TBuilder extends PadroneCommandBuilder<TNameNested, '', any, any, any>>(
    name: TNameNested,
    builderFn?: (builder: PadroneCommandBuilder<TNameNested, ''>) => TBuilder,
  ) => PadroneProgram<TName, TOpts, TRes, [...TCommands, TBuilder['~types']['command']]>;

  /**
   * Runs a command programmatically by name with provided options (including positional args).
   */
  run: <const TCommand extends GetCommandNames<[TCmd]> | FlattenCommands<[TCmd]>>(
    name: TCommand,
    options: NoInfer<GetOptions<'in', PickCommandByName<[TCmd], TCommand>>>,
  ) => PadroneCommandResult<PickCommandByName<[TCmd], TCommand>>;

  /**
   * Runs the program as a CLI application, parsing `process.argv` or provided input.
   */
  cli: <const TCommand extends PossibleCommands<[TCmd]>>(
    input?: TCommand,
    options?: PadroneParseOptions,
  ) => PadroneCommandResult<PickCommandByPossibleCommands<[TCmd], TCommand>>;

  /**
   * Parses CLI input (or the provided input string) into command, args, and options without executing anything.
   */
  parse: <const TCommand extends PossibleCommands<[TCmd]>>(
    input?: TCommand,
    options?: PadroneParseOptions,
  ) => PadroneParseResult<PickCommandByPossibleCommands<[TCmd], TCommand>>;

  /**
   * Converts command and options back into a CLI string.
   */
  stringify: <const TCommand extends GetCommandNames<TCommands> = ''>(
    command?: TCommand,
    options?: GetOptions<'out', PickCommandByPossibleCommands<[TCmd], TCommand>>,
  ) => string;

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
  tool: () => Tool<{ command: string }>;

  /**
   * Returns the help information for the program or a specific command.
   */
  help: <const TCommand extends GetCommandNames<[TCmd]> | FlattenCommands<[TCmd]>>(command?: TCommand, options?: HelpOptions) => string;

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

export type AnyPadroneProgram = PadroneProgram<string, any, any, [...AnyPadroneCommand[]]>;

export type PadroneCommandResult<TCommand extends AnyPadroneCommand = AnyPadroneCommand> = PadroneParseResult<TCommand> & {
  result: GetResults<TCommand>;
};

/**
 * Options for parsing CLI input.
 */
export type PadroneParseOptions = {
  /**
   * Custom environment variables to use for env binding.
   * If not provided, process.env will be used.
   */
  env?: Record<string, string | undefined>;
  /**
   * Config file data to use for config binding.
   * This should be the parsed content of a config file (JSON, YAML, etc.).
   */
  configData?: Record<string, unknown>;
};

export type PadroneParseResult<TCommand extends AnyPadroneCommand = AnyPadroneCommand> = {
  command: TCommand;
  options?: GetOptions<'out', TCommand>;
  optionsResult?: StandardSchemaV1.Result<GetOptions<'out', TCommand>>;
};

export type PadroneAPI<TCommand extends AnyPadroneCommand> = PadroneAPICommand<TCommand> & {
  [K in TCommand['~types']['commands'][number] as K['name']]: PadroneAPI<K>;
};

export type PadroneAPICommand<TCommand extends AnyPadroneCommand> = (options: GetOptions<'in', TCommand>) => GetResults<TCommand>;

type NormalizeOptions<TOptions> = IsUnknown<TOptions> extends true ? void | EmptyRecord : TOptions;
type GetOptions<TDir extends 'in' | 'out', TCommand extends AnyPadroneCommand> = TDir extends 'in'
  ? NormalizeOptions<TCommand['~types']['optionsInput']>
  : NormalizeOptions<TCommand['~types']['optionsOutput']>;

type GetResults<TCommand extends AnyPadroneCommand> = ReturnType<NonNullable<TCommand['handler']>>;

type GetMeta<TOpts extends ZOpts> = PadroneMeta<NonNullable<StandardSchemaV1.InferInput<TOpts>>>;
