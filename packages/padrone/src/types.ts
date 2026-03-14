import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { Tool } from 'ai';
import type { PadroneArgsSchemaMeta } from './args.ts';
import type { HelpPreferences } from './help.ts';
import type { PadroneRuntime, ResolvedPadroneRuntime } from './runtime.ts';
import type {
  FullCommandName,
  IsGeneric,
  MaybePromise,
  OrAsync,
  OrAsyncMeta,
  PickCommandByName,
  PickCommandByPossibleCommands,
  PossibleCommands,
  SafeString,
} from './type-utils.ts';
import type { WrapConfig, WrapResult } from './wrap.ts';

type UnknownRecord = Record<string, unknown>;
type EmptyRecord = Record<string, never>;
type DefaultArgs = UnknownRecord | void;

/**
 * A schema that supports both validation (StandardSchemaV1) and JSON schema generation (StandardJSONSchemaV1).
 * This is the type required for command arguments in Padrone.
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
  TArgs extends PadroneSchema = PadroneSchema<DefaultArgs>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TAliases extends string[] = string[],
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>> = PadroneSchema<void>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>> = PadroneSchema<void>,
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
  needsApproval?: boolean | ((args: TArgs) => Promise<boolean> | boolean);
  arguments?: TArgs;
  config?: TConfig;
  envSchema?: TEnv;
  meta?: GetArgsMeta<TArgs>;
  handler?: (args: StandardSchemaV1.InferOutput<TArgs>, runtime: ResolvedPadroneRuntime) => TRes;
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
    argumentsInput: StandardSchemaV1.InferInput<TArgs>;
    argumentsOutput: StandardSchemaV1.InferOutput<TArgs>;
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
 * Configuration for a command.
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
  TArgs extends PadroneSchema,
  TRes,
  TCommands extends [...AnyPadroneCommand[]],
  TParentArgs extends PadroneSchema,
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>>,
  TAsync extends boolean,
> = TReturn extends 'builder'
  ? PadroneBuilder<TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TConfig, TEnv, TAsync>
  : PadroneProgram<TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TConfig, TEnv, TAsync>;

/**
 * Base builder methods shared between PadroneBuilder and PadroneProgram.
 * These methods are used for defining command structure (arguments, config, env, action, subcommands).
 */
export type PadroneBuilderMethods<
  TProgramName extends string,
  TName extends string,
  TParentName extends string,
  TArgs extends PadroneSchema,
  TRes,
  TCommands extends [...AnyPadroneCommand[]],
  TParentArgs extends PadroneSchema,
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>>,
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
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TConfig, TEnv, TAsync>;

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
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TConfig, TEnv, TAsync>;

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
   * .action((args) => { ... })
   * ```
   */
  async: () => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TConfig, TEnv, true>;

  /**
   * Defines the arguments schema for the command, including positional arguments.
   * Can accept either a schema directly or a function that takes parent args schema as a base and returns a schema.
   * Use the `positional` array in meta to specify which arguments are positional args.
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
   * // Function-based schema extending parent arguments
   * .arguments((parentArgs) => {
   *   return z.object({
   *     ...parentArgs.shape,
   *     verbose: z.boolean().default(false),
   *   });
   * })
   * ```
   */
  arguments: <TNewArgs extends PadroneSchema = PadroneSchema<void>, TMeta extends GetArgsMeta<TNewArgs> = GetArgsMeta<TNewArgs>>(
    schema?: TNewArgs | ((parentSchema: TParentArgs) => TNewArgs),
    meta?: TMeta,
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TNewArgs,
    TRes,
    TCommands,
    TParentArgs,
    TConfig,
    TEnv,
    OrAsyncMeta<OrAsync<TAsync, TNewArgs>, TMeta>
  >;

  /**
   * Configures config file path(s) and schema for parsing config files.
   * @example
   * ```ts
   * .configFile('config.json', z.object({ port: z.number() }))
   * ```
   */
  configFile: <TNewConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>> = TArgs>(
    file: string | string[] | undefined,
    schema?: TNewConfig | ((argsSchema: TArgs) => TNewConfig),
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TArgs,
    TRes,
    TCommands,
    TParentArgs,
    TNewConfig,
    TEnv,
    OrAsync<TAsync, TNewConfig>
  >;

  /**
   * Configures environment variable schema for parsing env vars into arguments.
   * The schema should transform environment variables (typically SCREAMING_SNAKE_CASE)
   * into the argument names used by the command.
   * @example
   * ```ts
   * .env(z.object({ MY_APP_PORT: z.coerce.number() }).transform(e => ({ port: e.MY_APP_PORT })))
   * ```
   */
  env: <TNewEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>> = TArgs>(
    schema: TNewEnv | ((argsSchema: TArgs) => TNewEnv),
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TArgs,
    TRes,
    TCommands,
    TParentArgs,
    TConfig,
    TNewEnv,
    OrAsync<TAsync, TNewEnv>
  >;

  /**
   * Defines the handler function to be executed when the command is run.
   */
  action: <TNewRes>(
    handler?: (args: StandardSchemaV1.InferOutput<TArgs>, runtime: ResolvedPadroneRuntime) => TNewRes,
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TNewRes, TCommands, TParentArgs, TConfig, TEnv, TAsync>;

  /**
   * Wraps an external CLI tool with optional schema transformation.
   * The config can include a schema that transforms command arguments to external CLI arguments.
   *
   * @example
   * ```ts
   * // No transformation - pass arguments as-is
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
   *   }).transform(args => ({
   *     m: args.message,
   *     a: args.all,
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
   *   schema: (schema) => schema.transform(args => ({
   *     d: args.detach,
   *     image: args.image,
   *   })),
   * })
   * ```
   */
  wrap: <TWrapArgs extends PadroneSchema = TArgs>(
    config: WrapConfig<TArgs, TWrapArgs>,
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TArgs,
    Promise<WrapResult>,
    TCommands,
    TParentArgs,
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
      TArgs,
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
        TArgs,
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
    TArgs,
    TRes,
    TCommands extends []
      ? [WithAliases<TBuilder['~types']['command'], TAliases>]
      : AnyPadroneCommand[] extends TCommands
        ? [WithAliases<TBuilder['~types']['command'], TAliases>]
        : [...TCommands, WithAliases<TBuilder['~types']['command'], TAliases>],
    TParentArgs,
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
    arguments: TArgs;
    result: TRes;
    commands: TCommands;
    async: TAsync;
    command: PadroneCommand<TName, TParentName, TArgs, TRes, TCommands, [], TConfig, TEnv, TAsync>;
  };
};

export type PadroneBuilder<
  TProgramName extends string = '',
  TName extends string = string,
  TParentName extends string = '',
  TArgs extends PadroneSchema = PadroneSchema<DefaultArgs>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TParentArgs extends PadroneSchema = PadroneSchema<void>,
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>> = PadroneSchema<void>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>> = PadroneSchema<void>,
  TAsync extends boolean = false,
> = PadroneBuilderMethods<TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TConfig, TEnv, TAsync, 'builder'>;

export type PadroneProgram<
  TProgramName extends string = '',
  TName extends string = string,
  TParentName extends string = '',
  TArgs extends PadroneSchema = PadroneSchema<DefaultArgs>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TParentArgs extends PadroneSchema = PadroneSchema<void>,
  TConfig extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>> = PadroneSchema<void>,
  TEnv extends PadroneSchema<unknown, StandardSchemaV1.InferInput<TArgs>> = PadroneSchema<void>,
  TAsync extends boolean = false,
> = PadroneBuilderMethods<TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TConfig, TEnv, TAsync, 'program'> & {
  /**
   * Runs a command programmatically by name with provided arguments (including positional args).
   */
  run: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], true, true>>(
    name: TCommand | SafeString,
    args: NoInfer<GetArguments<'in', PickCommandByName<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>>,
  ) => PadroneCommandResult<PickCommandByName<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>;

  /**
   * Runs the program as a CLI application, parsing `process.argv` or provided input.
   */
  cli: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], true, true>>(
    input?: TCommand | SafeString,
    prefs?: PadroneCliPreferences,
  ) => MaybePromise<
    PadroneCommandResult<PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>,
    PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>['~types']['async']
  >;

  /**
   * Parses CLI input (or the provided input string) into command and arguments without executing anything.
   */
  parse: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], true, false>>(
    input?: TCommand | SafeString,
  ) => MaybePromise<
    PadroneParseResult<PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>,
    PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>['~types']['async']
  >;

  /**
   * Converts command and arguments back into a CLI string.
   */
  stringify: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], false, true>>(
    command?: TCommand | SafeString,
    args?: GetArguments<'out', PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>,
  ) => string;

  /**
   * Finds a command by name, returning `undefined` if not found.
   */
  find: <const TFind extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], false, true>>(
    command: TFind | SafeString,
  ) => PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TFind> | undefined;

  /**
   * Generates a type-safe API for invoking commands programmatically.
   */
  api: () => PadroneAPI<PadroneCommand<'', '', TArgs, TRes, TCommands>>;

  /**
   * Starts a REPL (Read-Eval-Print Loop) for running commands interactively.
   * Returns an AsyncIterable that yields a `PadroneCommandResult` for each successfully executed command.
   * Errors are printed via `runtime.error()` and the loop continues.
   * The loop ends when the user sends EOF (Ctrl+D), or types `exit`/`quit`
   * (unless a user-defined command with that name exists).
   *
   * @example
   * ```ts
   * for await (const result of program.repl()) {
   *   console.log(result.command.name, result.result);
   * }
   * ```
   *
   * TODO: REPL future enhancements:
   * - Ctrl+C handling: cancel current line / interrupt running command instead of killing the process
   * - Command history: persist across sessions, up-arrow navigation
   * - Tab completion: wire the existing completion() system into the REPL's readline
   * - Nested/contextual REPLs: `use <subcommand>` to scope the session to a command subtree
   * - Middleware/hooks: onBeforeCommand, onAfterCommand, error interceptors (design alongside general middleware system)
   * - stdin fragility: Node's readline + stdin is a shared mutable resource; any feature touching stdin
   *   (confirmations, multi-line input, password prompts) needs careful coordination with Enquirer/interactive prompts
   */
  repl: (options?: PadroneReplPreferences) => AsyncIterable<PadroneCommandResult<PadroneCommand<'', '', TArgs, TRes, TCommands>>>;

  /**
   * Returns a tool definition that can be passed to AI SDK.
   */
  tool: () => Tool<{ command: string }>;

  /**
   * Returns the help information for the program or a specific command.
   */
  help: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], false, true>>(
    command?: TCommand,
    prefs?: HelpPreferences,
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

/**
 * Options for `repl()` to customize the REPL session.
 */
export type PadroneReplPreferences = {
  /** The prompt string displayed before each input, or a function returning it. Defaults to `"<programName>> "`. */
  prompt?: string | (() => string);
  /** A greeting message displayed when the REPL starts. */
  greeting?: string;
};

/**
 * Options that can be passed to `cli()` to control execution behavior.
 */
export type PadroneCliPreferences = {
  /**
   * Controls interactive prompting for this execution.
   * Overrides the runtime's `interactive` setting, but is itself overridden by `--interactive` / `-i` flags.
   *
   * - `undefined`: inherit from runtime (default).
   * - `true`: force prompting for all configured interactive fields, even if values are already provided.
   * - `false`: suppress all interactive prompts.
   */
  interactive?: boolean;
};

export type PadroneCommandResult<TCommand extends AnyPadroneCommand = AnyPadroneCommand> = PadroneParseResult<TCommand> & {
  result: GetResults<TCommand>;
};

export type PadroneParseResult<TCommand extends AnyPadroneCommand = AnyPadroneCommand> = {
  command: TCommand;
  args?: GetArguments<'out', TCommand>;
  argsResult?: StandardSchemaV1.Result<GetArguments<'out', TCommand>>;
};

export type PadroneAPI<TCommand extends AnyPadroneCommand> = PadroneAPICommand<TCommand> & {
  [K in TCommand['~types']['commands'][number] as K['name']]: PadroneAPI<K>;
};

type PadroneAPICommand<TCommand extends AnyPadroneCommand> = (args: GetArguments<'in', TCommand>) => GetResults<TCommand>;

type NormalizeArguments<TArgs> = IsGeneric<TArgs> extends true ? void | EmptyRecord : TArgs;
type GetArguments<TDir extends 'in' | 'out', TCommand extends AnyPadroneCommand> = TDir extends 'in'
  ? NormalizeArguments<TCommand['~types']['argumentsInput']>
  : NormalizeArguments<TCommand['~types']['argumentsOutput']>;

type GetResults<TCommand extends AnyPadroneCommand> = ReturnType<NonNullable<TCommand['handler']>>;

type GetArgsMeta<TArgs extends PadroneSchema> = PadroneArgsSchemaMeta<NonNullable<StandardSchemaV1.InferInput<TArgs>>>;
