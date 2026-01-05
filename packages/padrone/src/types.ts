import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { Tool } from 'ai';
import type { HelpOptions } from './help';
import type { PadroneMeta } from './options';
import type {
  FlattenCommands,
  FullCommandName,
  GetCommandPaths,
  IsUnknown,
  PickCommandByName,
  PickCommandByPossibleCommands,
  PossibleCommands,
  SafeString,
} from './type-utils';

type UnknownRecord = Record<string, unknown>;
type EmptyRecord = Record<string, never>;
type DefaultOpts = UnknownRecord | void;

/**
 * A schema that supports both validation (StandardSchemaV1) and JSON schema generation (StandardJSONSchemaV1).
 * This is the type required for command arguments and options in Padrone.
 */
type PadroneSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> & StandardJSONSchemaV1<Input, Output>;

export type PadroneCommand<
  TName extends string = string,
  TParentName extends string = '',
  TOpts extends PadroneSchema = PadroneSchema<DefaultOpts>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
> = {
  name: TName;
  path: FullCommandName<TName, TParentName>;
  title?: string;
  description?: string;
  version?: string;
  /** Alternative names that can be used to invoke this command. Can be a single string or an array of strings. */
  aliases?: string | string[];
  deprecated?: boolean | string;
  hidden?: boolean;
  needsApproval?: boolean | ((options: TOpts) => Promise<boolean> | boolean);
  options?: PadroneSchema;
  meta?: GetMeta<TOpts>;
  handler?: (options: StandardSchemaV1.InferOutput<TOpts>) => TRes;
  /** List of possible config file names to search for. */
  configFiles?: string[];

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

/**
 * Configuration options for a command.
 */
export type PadroneCommandConfig = {
  /** A short title for the command, displayed in help. */
  title?: string;
  /** A longer description of what the command does. */
  description?: string;
  /** The version of the command. */
  version?: string;
  /** Alternative names that can be used to invoke this command. Can be a single string or an array of strings. */
  aliases?: string | string[];
  /** Whether the command is deprecated, or a message explaining the deprecation. */
  deprecated?: boolean | string;
  /** Whether the command should be hidden from help output. */
  hidden?: boolean;
  /**
   * List of possible config file names to search for.
   * When the CLI runs, it will search for these files in the current directory
   * and apply the first one found.
   *
   * - `undefined`: Inherit from parent command (default)
   * - `['file1', 'file2']`: Use these config files
   * - `[]`: Explicitly disable config file loading (no inheritance)
   *
   * @example ['myapp.config.json', 'myapp.config.yaml', '.myapprc']
   */
  configFiles?: string[];
};

export type PadroneCommandBuilder<
  TName extends string = string,
  TParentName extends string = '',
  TOpts extends PadroneSchema = PadroneSchema<DefaultOpts>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TParentOpts extends PadroneSchema = PadroneSchema<void>,
> = {
  /**
   * Configures command properties like title, description, version, deprecated, and hidden.
   * @example
   * ```ts
   * .configure({
   *   title: 'Build Project',
   *   description: 'Compiles the project',
   *   deprecated: 'Use "compile" instead',
   * })
   * ```
   */
  configure: (config: PadroneCommandConfig) => PadroneCommandBuilder<TName, TParentName, TOpts, TRes, TCommands, TParentOpts>;

  /**
   * Defines the options schema for the command, including positional arguments.
   * Can accept either a schema directly or a function that takes parent options as a base and returns a schema.
   * Use the `positional` array in meta to specify which options are positional args.
   * Use '...name' prefix for variadic (rest) arguments, matching JS/TS rest syntax.
   *
   * @example
   * ```ts
   * // Direct schema
   * .options(z.object({
   *   source: z.string(),
   *   files: z.string().array(),
   *   dest: z.string(),
   *   recursive: z.boolean().default(false),
   * }), {
   *   positional: ['source', '...files', 'dest'],
   * })
   * ```
   *
   * @example
   * ```ts
   * // Function-based schema extending parent options
   * .options((parentOpts) => {
   *   return z.object({
   *     ...parentOpts.shape,
   *     verbose: z.boolean().default(false),
   *   });
   * })
   * ```
   */
  options: <TOpts extends PadroneSchema = PadroneSchema<void>>(
    options?: TOpts | ((parentOptions: TParentOpts) => TOpts),
    meta?: GetMeta<TOpts>,
  ) => PadroneCommandBuilder<TName, TParentName, TOpts, TRes, TCommands, TParentOpts>;

  /**
   * Defines the handler function to be executed when the command is run.
   */
  action: <TRes>(
    handler?: (options: StandardSchemaV1.InferOutput<TOpts>) => TRes,
  ) => PadroneCommandBuilder<TName, TParentName, TOpts, TRes, TCommands, TParentOpts>;

  /**
   * Creates a nested command within the current command with the given name and builder function.
   */
  command: <
    TNameNested extends string,
    TBuilder extends PadroneCommandBuilder<TNameNested, FullCommandName<TName, TParentName>, any, any, AnyPadroneCommand[], TOpts>,
  >(
    name: TNameNested,
    builderFn?: (builder: PadroneCommandBuilder<TNameNested, FullCommandName<TName, TParentName>, any, any, [], TOpts>) => TBuilder,
  ) => PadroneCommandBuilder<
    TName,
    TParentName,
    TOpts,
    TRes,
    TCommands extends [] ? [TBuilder['~types']['command']] : [...TCommands, TBuilder['~types']['command']],
    TParentOpts
  >;

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
  TProgramName extends string = '',
  TOpts extends PadroneSchema = PadroneSchema<DefaultOpts>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
> = Omit<PadroneCommandBuilder<'', '', TOpts, TRes, TCommands, PadroneSchema<void>>, 'command' | 'configure'> & {
  /**
   * Configures program properties like title, description, version, deprecated, hidden, and configFiles.
   * @example
   * ```ts
   * .configure({
   *   description: 'My CLI application',
   *   version: '1.0.0',
   *   configFiles: ['myapp.config.json', '.myapprc'],
   * })
   * ```
   */
  configure: (config: Omit<PadroneCommandConfig, 'aliases'>) => PadroneProgram<'', TOpts, TRes, TCommands>;

  /**
   * Creates a command within the program with the given name and builder function.
   */
  command: <
    TNameNested extends string,
    TBuilder extends PadroneCommandBuilder<TNameNested, '', any, any, AnyPadroneCommand[], PadroneSchema<void>>,
  >(
    name: TNameNested,
    builderFn?: (builder: PadroneCommandBuilder<TNameNested, '', any, any, [], PadroneSchema<void>>) => TBuilder,
  ) => PadroneProgram<
    '',
    TOpts,
    TRes,
    TCommands extends [] ? [TBuilder['~types']['command']] : [...TCommands, TBuilder['~types']['command']]
  >;

  /**
   * Runs a command programmatically by name with provided options (including positional args).
   */
  run: <
    const TCommand extends
      | GetCommandPaths<[PadroneCommand<'', '', TOpts, TRes, TCommands>]>
      | FlattenCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>]>,
  >(
    name: TCommand | SafeString,
    options: NoInfer<GetOptions<'in', PickCommandByName<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>>,
  ) => PadroneCommandResult<PickCommandByName<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>;

  /**
   * Runs the program as a CLI application, parsing `process.argv` or provided input.
   */
  cli: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>]>>(
    input?: TCommand | SafeString,
    options?: PadroneParseOptions,
  ) => PadroneCommandResult<PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>;

  /**
   * Parses CLI input (or the provided input string) into command, args, and options without executing anything.
   */
  parse: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>]>>(
    input?: TCommand | SafeString,
    options?: PadroneParseOptions,
  ) => PadroneParseResult<PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>;

  /**
   * Converts command and options back into a CLI string.
   */
  stringify: <const TCommand extends GetCommandPaths<TCommands> = ''>(
    command?: TCommand,
    options?: GetOptions<'out', PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>,
  ) => string;

  /**
   * Finds a command by name, returning `undefined` if not found.
   */
  find: <const TFind extends GetCommandPaths<[PadroneCommand<'', '', TOpts, TRes, TCommands>]>>(
    command: TFind | SafeString,
  ) => IsUnknown<TFind> extends false
    ? TFind extends string
      ? PickCommandByName<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TFind>
      : FlattenCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>]> | undefined
    : FlattenCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>]> | undefined;

  /**
   * Generates a type-safe API for invoking commands programmatically.
   */
  api: () => PadroneAPI<PadroneCommand<'', '', TOpts, TRes, TCommands>>;

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
  help: <
    const TCommand extends
      | GetCommandPaths<[PadroneCommand<'', '', TOpts, TRes, TCommands>]>
      | FlattenCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>]>,
  >(
    command?: TCommand,
    options?: HelpOptions,
  ) => string;

  /**
   * Generates and returns a shell completion script.
   * If shell is not specified, automatically detects the current shell and provides instructions.
   * @param shell - The shell type (bash, zsh, fish, powershell). If not provided, auto-detects.
   * @returns The shell completion script as a string.
   * @example
   * ```ts
   * // Get bash completion script
   * const bashScript = program.completion('bash');
   *
   * // Auto-detect shell and get completion script with instructions
   * const script = program.completion();
   * ```
   */
  completion: (shell?: 'bash' | 'zsh' | 'fish' | 'powershell') => string;

  /** @deprecated Internal use only */
  '~types': {
    programName: TProgramName;
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

type PadroneAPICommand<TCommand extends AnyPadroneCommand> = (options: GetOptions<'in', TCommand>) => GetResults<TCommand>;

type NormalizeOptions<TOptions> = IsUnknown<TOptions> extends true ? void | EmptyRecord : TOptions;
type GetOptions<TDir extends 'in' | 'out', TCommand extends AnyPadroneCommand> = TDir extends 'in'
  ? NormalizeOptions<TCommand['~types']['optionsInput']>
  : NormalizeOptions<TCommand['~types']['optionsOutput']>;

type GetResults<TCommand extends AnyPadroneCommand> = ReturnType<NonNullable<TCommand['handler']>>;

type GetMeta<TOpts extends PadroneSchema> = PadroneMeta<NonNullable<StandardSchemaV1.InferInput<TOpts>>>;
