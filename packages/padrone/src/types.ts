import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { Tool } from 'ai';
import type { HelpOptions } from './help.ts';
import type { PadroneMeta } from './options.ts';
import type { PadroneRuntime } from './runtime.ts';
import type {
  FullCommandName,
  IsGeneric,
  MaybePromise,
  OrAsync,
  PickCommandByName,
  PickCommandByPossibleCommands,
  PossibleCommands,
  SafeString,
} from './type-utils.ts';
import type { WrapConfig, WrapResult } from './wrap.ts';

type UnknownRecord = Record<string, unknown>;
type EmptyRecord = Record<string, never>;
type DefaultOpts = UnknownRecord | void;

/**
 * A schema that supports both validation (StandardSchemaV1) and JSON schema generation (StandardJSONSchemaV1).
 * This is the type required for command arguments and options in Padrone.
 */
export type PadroneSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> & StandardJSONSchemaV1<Input, Output>;

/**
 * A schema branded as async. When passed to `.arguments()`, `.configFile()`, or `.env()`,
 * the command is automatically marked as async, causing `parse()` and `cli()` to return Promises.
 *
 * Use the `asyncSchema()` helper to brand an existing schema:
 * ```ts
 * import { asyncSchema } from 'padrone';
 * const schema = asyncSchema(z.object({ name: z.string() }).check(async (v) => { ... }));
 * ```
 */
export type AsyncPadroneSchema<Input = unknown, Output = Input> = PadroneSchema<Input, Output> & { '~async': true };

/**
 * Helper type to set aliases on a command type.
 * Uses intersection to override just the aliases while preserving all other type information.
 */
type WithAliases<TCommand extends AnyPadroneCommand, TAliases extends string[]> = Omit<TCommand, 'aliases' | '~types'> & {
  aliases?: TAliases;
  '~types': Omit<TCommand['~types'], 'aliases'> & { aliases: TAliases };
};

export type PadroneCommand<
  TName extends string = string,
  TParentName extends string = '',
  TOpts extends PadroneSchema = PadroneSchema<DefaultOpts>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TAliases extends string[] = string[],
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>> = PadroneSchema<void>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>> = PadroneSchema<void>,
  TAsync extends boolean = false,
> = {
  name: TName;
  path: FullCommandName<TName, TParentName>;
  title?: string;
  description?: string;
  version?: string;
  /** Alternative names that can be used to invoke this command. Derived from the names passed to command(). */
  aliases?: TAliases;
  deprecated?: boolean | string;
  hidden?: boolean;
  needsApproval?: boolean | ((options: TOpts) => Promise<boolean> | boolean);
  options?: TOpts;
  config?: TConfig;
  envSchema?: TEnv;
  meta?: GetMeta<TOpts>;
  handler?: (options: StandardSchemaV1.InferOutput<TOpts>) => TRes;
  /** List of possible config file names to search for. */
  configFiles?: string[];
  /** Runtime flag indicating this command uses async validation. Set by `.async()` or `asyncSchema()`. */
  isAsync?: boolean;
  /** Runtime configuration for I/O abstraction. */
  runtime?: PadroneRuntime;

  parent?: AnyPadroneCommand;
  commands?: TCommands;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    path: FullCommandName<TName, TParentName>;
    aliases: TAliases;
    optionsInput: StandardSchemaV1.InferInput<TOpts>;
    optionsOutput: StandardSchemaV1.InferOutput<TOpts>;
    result: TRes;
    commands: TCommands;
    async: TAsync;
  };
};

export type AnyPadroneCommand = PadroneCommand<string, any, any, any, [...AnyPadroneCommand[]], string[], any, any, any>;

/**
 * Base type for extracting command information from builder or program.
 * Both PadroneBuilder and PadroneProgram share this structure.
 */
type CommandTypesBase = {
  '~types': {
    command: AnyPadroneCommand;
  };
};

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
  /** Whether the command is deprecated, or a message explaining the deprecation. */
  deprecated?: boolean | string;
  /** Whether the command should be hidden from help output. */
  hidden?: boolean;
};

/**
 * Conditional type that returns either PadroneBuilder or PadroneProgram based on TReturn.
 * Used to avoid repetition in PadroneBuilderMethods return types.
 */
type BuilderOrProgram<
  TReturn extends 'builder' | 'program',
  TProgramName extends string,
  TName extends string,
  TParentName extends string,
  TOpts extends PadroneSchema,
  TRes,
  TCommands extends [...AnyPadroneCommand[]],
  TParentOpts extends PadroneSchema,
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>>,
  TAsync extends boolean,
> = TReturn extends 'builder'
  ? PadroneBuilder<TProgramName, TName, TParentName, TOpts, TRes, TCommands, TParentOpts, TConfig, TEnv, TAsync>
  : PadroneProgram<TProgramName, TName, TParentName, TOpts, TRes, TCommands, TParentOpts, TConfig, TEnv, TAsync>;

/**
 * Base builder methods shared between PadroneBuilder and PadroneProgram.
 * These methods are used for defining command structure (options, config, env, action, subcommands).
 */
export type PadroneBuilderMethods<
  TProgramName extends string,
  TName extends string,
  TParentName extends string,
  TOpts extends PadroneSchema,
  TRes,
  TCommands extends [...AnyPadroneCommand[]],
  TParentOpts extends PadroneSchema,
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>>,
  TAsync extends boolean,
  /** The return type for builder methods - either PadroneBuilder or PadroneProgram */
  TReturn extends 'builder' | 'program',
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
  configure: (
    config: PadroneCommandConfig,
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TOpts, TRes, TCommands, TParentOpts, TConfig, TEnv, TAsync>;

  /**
   * Configures the runtime adapter for I/O abstraction.
   * Allows the CLI framework to work outside of a terminal (e.g., web UIs, chat interfaces, testing).
   * Unspecified fields fall back to the Node.js/Bun defaults.
   *
   * @example
   * ```ts
   * .runtime({
   *   output: (text) => panel.append(text),
   *   error: (text) => panel.appendError(text),
   *   format: 'html',
   * })
   * ```
   */
  runtime: (
    runtime: PadroneRuntime,
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TOpts, TRes, TCommands, TParentOpts, TConfig, TEnv, TAsync>;

  /**
   * Explicitly marks this command as using async validation.
   * When a command is async, `parse()` and `cli()` return Promises.
   *
   * This is an alternative to using `asyncSchema()` on individual schemas.
   * Use this when your schema has async refinements but you don't want to
   * (or can't) brand the schema itself.
   *
   * @example
   * ```ts
   * .arguments(z.object({ name: z.string() }).check(async (v) => { ... }))
   * .async()
   * .action((opts) => { ... })
   * ```
   */
  async: () => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TOpts, TRes, TCommands, TParentOpts, TConfig, TEnv, true>;

  /**
   * Defines the options schema for the command, including positional arguments.
   * Can accept either a schema directly or a function that takes parent options as a base and returns a schema.
   * Use the `positional` array in meta to specify which options are positional args.
   * Use '...name' prefix for variadic (rest) arguments, matching JS/TS rest syntax.
   *
   * @example
   * ```ts
   * // Direct schema
   * .arguments(z.object({
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
   * .arguments((parentOpts) => {
   *   return z.object({
   *     ...parentOpts.shape,
   *     verbose: z.boolean().default(false),
   *   });
   * })
   * ```
   */
  arguments: <TNewOpts extends PadroneSchema = PadroneSchema<void>>(
    options?: TNewOpts | ((parentOptions: TParentOpts) => TNewOpts),
    meta?: GetMeta<TNewOpts>,
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TNewOpts,
    TRes,
    TCommands,
    TParentOpts,
    TConfig,
    TEnv,
    OrAsync<TAsync, TNewOpts>
  >;

  /**
   * Configures config file path(s) and schema for parsing config files.
   * @example
   * ```ts
   * .configFile('config.json', z.object({ port: z.number() }))
   * ```
   */
  configFile: <TNewConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>> = TOpts>(
    file: string | string[] | undefined,
    schema?: TNewConfig | ((optionsSchema: TOpts) => TNewConfig),
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TOpts,
    TRes,
    TCommands,
    TParentOpts,
    TNewConfig,
    TEnv,
    OrAsync<TAsync, TNewConfig>
  >;

  /**
   * Configures environment variable schema for parsing env vars into options.
   * The schema should transform environment variables (typically SCREAMING_SNAKE_CASE)
   * into the option names used by the command.
   * @example
   * ```ts
   * .env(z.object({ MY_APP_PORT: z.coerce.number() }).transform(e => ({ port: e.MY_APP_PORT })))
   * ```
   */
  env: <TNewEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>> = TOpts>(
    schema: TNewEnv | ((optionsSchema: TOpts) => TNewEnv),
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TOpts,
    TRes,
    TCommands,
    TParentOpts,
    TConfig,
    TNewEnv,
    OrAsync<TAsync, TNewEnv>
  >;

  /**
   * Defines the handler function to be executed when the command is run.
   */
  action: <TNewRes>(
    handler?: (options: StandardSchemaV1.InferOutput<TOpts>) => TNewRes,
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TOpts, TNewRes, TCommands, TParentOpts, TConfig, TEnv, TAsync>;

  /**
   * Wraps an external CLI tool with optional schema transformation.
   * The config can include a schema that transforms command options to external CLI arguments.
   *
   * @example
   * ```ts
   * // No transformation - pass options as-is
   * .arguments(z.object({
   *   message: z.string(),
   * }))
   * .wrap({
   *   command: 'echo',
   * })
   * ```
   *
   * @example
   * ```ts
   * // With transformation schema
   * .arguments(z.object({
   *   message: z.string(),
   *   all: z.boolean().optional(),
   * }), {
   *   positional: ['message'],
   * })
   * .wrap({
   *   command: 'git',
   *   args: ['commit'],
   *   positional: ['m'],
   *   schema: z.object({
   *     message: z.string(),
   *     all: z.boolean().optional(),
   *   }).transform(opts => ({
   *     m: opts.message,
   *     a: opts.all,
   *   })),
   * })
   * ```
   *
   * @example
   * ```ts
   * // Using function-based schema for type inference
   * .arguments(z.object({
   *   image: z.string(),
   *   detach: z.boolean().optional(),
   * }))
   * .wrap({
   *   command: 'docker',
   *   args: ['run'],
   *   positional: ['image'],
   *   schema: (cmdOpts) => cmdOpts.transform(opts => ({
   *     d: opts.detach,
   *     image: opts.image,
   *   })),
   * })
   * ```
   */
  wrap: <TWrapOpts extends PadroneSchema = TOpts>(
    config: WrapConfig<TOpts, TWrapOpts>,
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TOpts,
    Promise<WrapResult>,
    TCommands,
    TParentOpts,
    TConfig,
    TEnv,
    TAsync
  >;

  /**
   * Creates a nested command within the current command with the given name and builder function.
   * The name can be a single string or a tuple of [name, ...aliases] where additional strings are aliases.
   * @example
   * ```ts
   * // Single name
   * .command('list', (c) => c.action(() => 'list'))
   *
   * // Name with aliases
   * .command(['list', 'ls', 'l'], (c) => c.action(() => 'list'))
   * ```
   */
  command: <
    TNameNested extends string,
    TAliases extends string[] = [],
    TBuilder extends CommandTypesBase = PadroneBuilder<
      TProgramName,
      TNameNested,
      FullCommandName<TName, TParentName>,
      any,
      void,
      [],
      TOpts,
      any,
      any,
      false
    >,
  >(
    name: TNameNested | readonly [TNameNested, ...TAliases],
    builderFn?: (
      builder: PadroneBuilder<
        TProgramName,
        TNameNested,
        FullCommandName<TName, TParentName>,
        PadroneSchema<void>,
        void,
        [],
        TOpts,
        PadroneSchema<void>,
        PadroneSchema<void>,
        false
      >,
    ) => TBuilder,
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TOpts,
    TRes,
    TCommands extends []
      ? [WithAliases<TBuilder['~types']['command'], TAliases>]
      : AnyPadroneCommand[] extends TCommands
        ? [WithAliases<TBuilder['~types']['command'], TAliases>]
        : [...TCommands, WithAliases<TBuilder['~types']['command'], TAliases>],
    TParentOpts,
    TConfig,
    TEnv,
    TAsync
  >;

  /** @deprecated Internal use only */
  '~types': {
    programName: TProgramName;
    name: TName;
    parentName: TParentName;
    path: FullCommandName<TName, TParentName>;
    aliases: [];
    options: TOpts;
    result: TRes;
    commands: TCommands;
    async: TAsync;
    command: PadroneCommand<TName, TParentName, TOpts, TRes, TCommands, [], TConfig, TEnv, TAsync>;
  };
};

export type PadroneBuilder<
  TProgramName extends string = '',
  TName extends string = string,
  TParentName extends string = '',
  TOpts extends PadroneSchema = PadroneSchema<DefaultOpts>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TParentOpts extends PadroneSchema = PadroneSchema<void>,
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>> = PadroneSchema<void>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>> = PadroneSchema<void>,
  TAsync extends boolean = false,
> = PadroneBuilderMethods<TProgramName, TName, TParentName, TOpts, TRes, TCommands, TParentOpts, TConfig, TEnv, TAsync, 'builder'>;

export type PadroneProgram<
  TProgramName extends string = '',
  TName extends string = string,
  TParentName extends string = '',
  TOpts extends PadroneSchema = PadroneSchema<DefaultOpts>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TParentOpts extends PadroneSchema = PadroneSchema<void>,
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>> = PadroneSchema<void>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TOpts>> = PadroneSchema<void>,
  TAsync extends boolean = false,
> = PadroneBuilderMethods<TProgramName, TName, TParentName, TOpts, TRes, TCommands, TParentOpts, TConfig, TEnv, TAsync, 'program'> & {
  /**
   * Runs a command programmatically by name with provided options (including positional args).
   */
  run: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], true, true>>(
    name: TCommand | SafeString,
    options: NoInfer<GetOptions<'in', PickCommandByName<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>>,
  ) => PadroneCommandResult<PickCommandByName<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>;

  /**
   * Runs the program as a CLI application, parsing `process.argv` or provided input.
   */
  cli: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], true, true>>(
    input?: TCommand | SafeString,
    options?: PadroneParseOptions,
  ) => MaybePromise<
    PadroneCommandResult<PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>,
    PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>['~types']['async']
  >;

  /**
   * Parses CLI input (or the provided input string) into command, args, and options without executing anything.
   */
  parse: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], true, false>>(
    input?: TCommand | SafeString,
    options?: PadroneParseOptions,
  ) => MaybePromise<
    PadroneParseResult<PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>,
    PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>['~types']['async']
  >;

  /**
   * Converts command and options back into a CLI string.
   */
  stringify: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], false, true>>(
    command?: TCommand | SafeString,
    options?: GetOptions<'out', PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TCommand>>,
  ) => string;

  /**
   * Finds a command by name, returning `undefined` if not found.
   */
  find: <const TFind extends PossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], false, true>>(
    command: TFind | SafeString,
  ) => PickCommandByPossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], TFind> | undefined;

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
  help: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TOpts, TRes, TCommands>], false, true>>(
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
};

export type AnyPadroneProgram = PadroneProgram<string, string, string, any, any, [...AnyPadroneCommand[]]>;

export type PadroneCommandResult<TCommand extends AnyPadroneCommand = AnyPadroneCommand> = PadroneParseResult<TCommand> & {
  result: GetResults<TCommand>;
};

/**
 * Options for parsing CLI input.
 */
export type PadroneParseOptions = {
  /**
   * Raw environment variables to use for env schema validation.
   * If not provided, process.env will be used.
   */
  env?: Record<string, string | undefined>;
  /**
   * Pre-parsed environment data to use directly (bypasses env schema validation).
   * Keys should match option names.
   */
  envData?: Record<string, unknown>;
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

type NormalizeOptions<TOptions> = IsGeneric<TOptions> extends true ? void | EmptyRecord : TOptions;
type GetOptions<TDir extends 'in' | 'out', TCommand extends AnyPadroneCommand> = TDir extends 'in'
  ? NormalizeOptions<TCommand['~types']['optionsInput']>
  : NormalizeOptions<TCommand['~types']['optionsOutput']>;

type GetResults<TCommand extends AnyPadroneCommand> = ReturnType<NonNullable<TCommand['handler']>>;

type GetMeta<TOpts extends PadroneSchema> = PadroneMeta<NonNullable<StandardSchemaV1.InferInput<TOpts>>>;
