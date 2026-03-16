import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { Tool } from 'ai';
import type { PadroneArgsSchemaMeta } from './args.ts';
import type { HelpPreferences } from './help.ts';
import type { PadroneRuntime, ResolvedPadroneRuntime } from './runtime.ts';
import type {
  FindDirectChild,
  FlattenCommands,
  FullCommandName,
  IsGeneric,
  MaybePromise,
  OrAsync,
  OrAsyncMeta,
  PickCommandByName,
  PickCommandByPossibleCommands,
  PossibleCommands,
  RepathCommands,
  ReplaceOrAppendCommand,
  SafeString,
} from './type-utils.ts';
import type { WrapConfig, WrapResult } from './wrap.ts';

type UnknownRecord = Record<string, unknown>;
type EmptyRecord = Record<string, never>;
type DefaultArgs = UnknownRecord | void;

/**
 * Context object passed as the second argument to command action handlers.
 * Contains the resolved runtime, the executing command, and the program instance.
 */
export type PadroneActionContext = {
  /** The resolved runtime for this command (I/O, env, config, etc.). */
  runtime: ResolvedPadroneRuntime;
  /** The command being executed. */
  command: AnyPadroneCommand;
  /** The root program instance. */
  program: AnyPadroneProgram;
};

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

/**
 * Resolves aliases for a command override: if new aliases are provided (non-empty), use them;
 * otherwise, preserve the existing command's aliases.
 */
type ResolvedAliases<
  TCommands extends [...AnyPadroneCommand[]],
  TNameNested extends string,
  TAliases extends string[],
> = TAliases extends []
  ? FindDirectChild<TCommands, TNameNested> extends infer E extends AnyPadroneCommand
    ? E['~types']['aliases']
    : []
  : TAliases;

/**
 * Resolves the initial builder type for a `.command()` call.
 * If TNameNested already exists in TCommands, the builder starts pre-populated with that command's types.
 * Otherwise, a fresh builder with default types is used.
 */
type InitialCommandBuilder<
  TProgramName extends string,
  TNameNested extends string,
  TParentPath extends string,
  TParentArgs extends PadroneSchema,
  TCommands extends [...AnyPadroneCommand[]],
> = [FindDirectChild<TCommands, TNameNested>] extends [never]
  ? PadroneBuilder<
      TProgramName,
      TNameNested,
      TParentPath,
      PadroneSchema<void>,
      void,
      [],
      TParentArgs,
      PadroneSchema<void>,
      PadroneSchema<void>,
      false
    >
  : FindDirectChild<TCommands, TNameNested> extends infer E extends AnyPadroneCommand
    ? PadroneBuilder<
        TProgramName,
        TNameNested,
        TParentPath,
        E['~types']['argsSchema'],
        E['~types']['result'],
        E['~types']['commands'],
        TParentArgs,
        E['~types']['configSchema'],
        E['~types']['envSchema'],
        E['~types']['async']
      >
    : PadroneBuilder<
        TProgramName,
        TNameNested,
        TParentPath,
        PadroneSchema<void>,
        void,
        [],
        TParentArgs,
        PadroneSchema<void>,
        PadroneSchema<void>,
        false
      >;

/**
 * Like InitialCommandBuilder but uses `any` for args/config/env in the fresh case.
 * Used as the default for TBuilder when no builderFn is provided.
 */
type DefaultCommandBuilder<
  TProgramName extends string,
  TNameNested extends string,
  TParentPath extends string,
  TParentArgs extends PadroneSchema,
  TCommands extends [...AnyPadroneCommand[]],
> = [FindDirectChild<TCommands, TNameNested>] extends [never]
  ? PadroneBuilder<TProgramName, TNameNested, TParentPath, any, void, [], TParentArgs, any, any, false>
  : FindDirectChild<TCommands, TNameNested> extends infer E extends AnyPadroneCommand
    ? PadroneBuilder<
        TProgramName,
        TNameNested,
        TParentPath,
        E['~types']['argsSchema'],
        E['~types']['result'],
        E['~types']['commands'],
        TParentArgs,
        E['~types']['configSchema'],
        E['~types']['envSchema'],
        E['~types']['async']
      >
    : PadroneBuilder<TProgramName, TNameNested, TParentPath, any, void, [], TParentArgs, any, any, false>;

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
  autoOutput?: boolean;
  argsSchema?: TArgs;
  configSchema?: TConfig;
  envSchema?: TEnv;
  meta?: GetArgsMeta<TArgs>;
  action?: (args: StandardSchemaV1.InferOutput<TArgs>, ctx: PadroneActionContext) => TRes;
  /** List of possible config file names to search for. */
  configFiles?: string[];
  /** Runtime flag indicating this command uses async validation. Set by `.async()` or `asyncSchema()`. */
  isAsync?: boolean;
  /** Runtime configuration for I/O abstraction. */
  runtime?: PadroneRuntime;

  /** Plugins registered on this command. Collected from the parent chain at execution time. */
  plugins?: PadronePlugin[];

  parent?: AnyPadroneCommand;
  commands?: TCommands;

  /** @deprecated Internal use only */
  '~types': {
    name: TName;
    parentName: TParentName;
    path: FullCommandName<TName, TParentName>;
    aliases: TAliases;
    argsSchema: TArgs;
    argsInput: StandardSchemaV1.InferInput<TArgs>;
    argsOutput: StandardSchemaV1.InferOutput<TArgs>;
    result: TRes;
    commands: TCommands;
    configSchema: TConfig;
    envSchema: TEnv;
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
  /**
   * Automatically write this command's return value to output in CLI/eval/REPL mode.
   * Overrides the `autoOutput` setting in eval/cli preferences for this command.
   * See `PadroneEvalPreferences.autoOutput` for serialization details.
   */
  autoOutput?: boolean;
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
  /**
   * Registers a plugin that intercepts command execution phases (parse, validate, execute).
   * Plugins are applied in order: first registered = outermost wrapper (runs first before `next()`).
   * Use `plugin.order` for explicit ordering (lower = outermost).
   *
   * On the program, parse/validate/execute plugins all apply.
   * On subcommands, only validate and execute plugins apply (parse is handled by the root program).
   */
  use: (
    plugin: PadronePlugin,
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TConfig, TEnv, TAsync>;

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
   * When overriding an existing command, the previous handler is passed as the third `base` parameter.
   */
  action: <TNewRes>(
    handler?: (
      args: StandardSchemaV1.InferOutput<TArgs>,
      ctx: PadroneActionContext,
      base: (args: StandardSchemaV1.InferOutput<TArgs>, ctx: PadroneActionContext) => TRes,
    ) => TNewRes,
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
   * Creates or extends a nested command within the current command.
   * If a command with the same name already exists, it is extended:
   * - Configuration is merged (new values override old).
   * - The builder callback receives a builder pre-populated with the existing command's state.
   * - `.action()` receives the previous handler as the third `base` parameter.
   * - `.arguments()` callback receives the existing schema as its parameter.
   * - Subcommands are recursively merged by name.
   *
   * @example
   * ```ts
   * // Fresh command
   * .command('list', (c) => c.action(() => 'list'))
   *
   * // Override — extend an existing command
   * .command('list', (c) => c.action((args, ctx, base) => {
   *   const original = base(args, ctx);
   *   return `modified: ${original}`;
   * }))
   *
   * // Name with aliases
   * .command(['list', 'ls', 'l'], (c) => c.action(() => 'list'))
   * ```
   */
  command: <
    TNameNested extends string,
    TAliases extends string[] = [],
    TBuilder extends CommandTypesBase = DefaultCommandBuilder<
      TProgramName,
      TNameNested,
      FullCommandName<TName, TParentName>,
      TArgs,
      TCommands
    >,
  >(
    name: TNameNested | readonly [TNameNested, ...TAliases],
    builderFn?: (
      builder: InitialCommandBuilder<TProgramName, TNameNested, FullCommandName<TName, TParentName>, TArgs, TCommands>,
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
        : ReplaceOrAppendCommand<
            TCommands,
            TNameNested,
            WithAliases<TBuilder['~types']['command'], ResolvedAliases<TCommands, TNameNested, TAliases>>
          >,
    TParentArgs,
    TConfig,
    TEnv,
    TAsync
  >;

  /**
   * Mounts an existing Padrone program as a subcommand.
   * The program's root-level properties (name, path, parent) are replaced to fit the mount point.
   * All subcommands are recursively re-pathed. Root-level `version` is dropped.
   *
   * @example
   * ```ts
   * const admin = createPadrone('admin')
   *   .command('users', (c) => c.action(() => 'users'))
   *   .command('roles', (c) => c.action(() => 'roles'));
   *
   * const app = createPadrone('app')
   *   .mount('admin', admin)
   *   // Now: app admin users, app admin roles
   *
   * // With aliases
   * const app2 = createPadrone('app')
   *   .mount(['admin', 'adm'], admin)
   * ```
   */
  mount: <TNameNested extends string, TAliases extends string[] = [], TProgram extends CommandTypesBase = CommandTypesBase>(
    name: TNameNested | readonly [TNameNested, ...TAliases],
    program: TProgram,
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TArgs,
    TRes,
    TCommands extends []
      ? [
          WithAliases<
            PadroneCommand<
              TNameNested,
              FullCommandName<TName, TParentName>,
              TProgram['~types']['command']['~types']['argsSchema'],
              TProgram['~types']['command']['~types']['result'],
              RepathCommands<
                TProgram['~types']['command']['~types']['commands'],
                FullCommandName<TNameNested, FullCommandName<TName, TParentName>>
              >,
              [],
              TProgram['~types']['command']['~types']['configSchema'],
              TProgram['~types']['command']['~types']['envSchema'],
              TProgram['~types']['command']['~types']['async']
            >,
            TAliases
          >,
        ]
      : AnyPadroneCommand[] extends TCommands
        ? [
            WithAliases<
              PadroneCommand<
                TNameNested,
                FullCommandName<TName, TParentName>,
                TProgram['~types']['command']['~types']['argsSchema'],
                TProgram['~types']['command']['~types']['result'],
                RepathCommands<
                  TProgram['~types']['command']['~types']['commands'],
                  FullCommandName<TNameNested, FullCommandName<TName, TParentName>>
                >,
                [],
                TProgram['~types']['command']['~types']['configSchema'],
                TProgram['~types']['command']['~types']['envSchema'],
                TProgram['~types']['command']['~types']['async']
              >,
              TAliases
            >,
          ]
        : ReplaceOrAppendCommand<
            TCommands,
            TNameNested,
            WithAliases<
              PadroneCommand<
                TNameNested,
                FullCommandName<TName, TParentName>,
                TProgram['~types']['command']['~types']['argsSchema'],
                TProgram['~types']['command']['~types']['result'],
                RepathCommands<
                  TProgram['~types']['command']['~types']['commands'],
                  FullCommandName<TNameNested, FullCommandName<TName, TParentName>>
                >,
                [],
                TProgram['~types']['command']['~types']['configSchema'],
                TProgram['~types']['command']['~types']['envSchema'],
                TProgram['~types']['command']['~types']['async']
              >,
              ResolvedAliases<TCommands, TNameNested, TAliases>
            >
          >,
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
    argsSchema: TArgs;
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
   * Evaluates a command string: parses, validates, and executes.
   * On validation errors, returns a result with issues instead of throwing.
   * This is the method used by `repl()` internally, and the right choice for
   * programmatic invocation, testing, chat interfaces, or any context where
   * you have a command string and want a result — not a process exit.
   *
   * @example
   * ```ts
   * const result = await program.eval('greet --name Alice');
   * if (result.argsResult?.issues) { /* handle validation errors *\/ }
   * ```
   */
  eval: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], true, true>>(
    input: TCommand | SafeString,
    prefs?: PadroneEvalPreferences,
  ) => MaybePromise<
    PadroneCommandResult<PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>,
    PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>['~types']['async']
  >;

  /**
   * Runs the program as a CLI entry point, parsing `process.argv`.
   * On validation errors, throws and prints help.
   * For programmatic invocation with a command string, use `eval()` instead.
   */
  cli: (
    prefs?: PadroneCliPreferences<PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>]>>,
  ) => MaybePromise<PadroneCommandResult<FlattenCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>]>>, TAsync>;

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
   * The loop ends when the user sends EOF (Ctrl+D), types `.exit`/`.quit`,
   * or presses Ctrl+C twice within 2 seconds.
   *
   * @example
   * ```ts
   * for await (const result of program.repl()) {
   *   console.log(result.command.name, result.result);
   * }
   * ```
   *
   * TODO: REPL future enhancements:
   * - History persistence: save/load history across sessions (currently in-memory only)
   * - Middleware/hooks: onBeforeCommand, onAfterCommand, error interceptors (design alongside general middleware system)
   */
  repl: (
    options?: PadroneReplPreferences<PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>]>>,
  ) => AsyncIterable<PadroneCommandResult<FlattenCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>]>>>;

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
/** A single spacing value: blank line (`true`), separator string, or an array of these for multiple lines. */
export type PadroneReplSpacing = boolean | string | (boolean | string)[];

export type PadroneReplPreferences<TScope extends string = string> = {
  /** The prompt string displayed before each input, or a function returning it. Defaults to `"<programName>> "`. */
  prompt?: string | (() => string);
  /**
   * A greeting message displayed when the REPL starts.
   * When not provided, defaults to `"Welcome to <name> v<version>"` (or just `"Welcome to <name>"` if no version).
   * Set to `false` to suppress the default greeting entirely.
   */
  greeting?: string | false;
  /**
   * A hint message displayed below the greeting in dimmed text.
   * When not provided, defaults to `'Type ".help" for more information, ".exit" to quit.'`.
   * Set to `false` to suppress the hint.
   */
  hint?: string | false;
  /** Initial history entries (most recent last). Arrow keys navigate history in the terminal. */
  history?: string[];
  /** Set to `false` to disable tab completion. Defaults to `true`. */
  completion?: boolean;
  /**
   * Add spacing/separators around each command's output.
   * A spacing value can be:
   * - `true` — blank line
   * - A string — separator line (single char like `'─'` repeats to terminal width, multi-char prints as-is)
   * - An array of the above — multiple lines in order (e.g. `[true, '─']` for blank line then separator)
   *
   * Shorthand applies to both before and after. Use `{ before?, after? }` for independent control.
   */
  spacing?: PadroneReplSpacing | { before?: PadroneReplSpacing; after?: PadroneReplSpacing };
  /** Prefix each line of command output/error with this string (e.g. `'│ '`, `'  '`, `'▎ '`). */
  outputPrefix?: string;
  /**
   * Start the REPL scoped to a command subtree. The scope path is a space-separated command path
   * (e.g. `'db'` or `'db migrate'`). Commands are resolved relative to the scoped command.
   * Users can change scope at runtime with `.scope <subcommand>` and `.scope ..`/`..`.
   */
  scope?: TScope;

  /**
   * Automatically write each command's return value to output.
   * See `PadroneEvalPreferences.autoOutput` for details on how values are serialized.
   * Defaults to `true`.
   */
  autoOutput?: boolean;
};

/**
 * Options that can be passed to `eval()` to control execution behavior.
 */
export type PadroneEvalPreferences = {
  /**
   * Controls interactive prompting for this execution.
   * Overrides the runtime's `interactive` setting, but is itself overridden by `--interactive` / `-i` flags.
   *
   * - `undefined`: inherit from runtime (default).
   * - `true`: force prompting for all configured interactive fields, even if values are already provided.
   * - `false`: suppress all interactive prompts.
   */
  interactive?: boolean;

  /**
   * Automatically write the command's return value to output.
   *
   * - Values are passed directly to the runtime's `output` function (no stringification).
   * - Promises are awaited before output.
   * - Iterators and async iterators are consumed, outputting each yielded value as it arrives.
   * - `undefined` and `null` results produce no output.
   *
   * Defaults to `true`. Set to `false` to disable.
   */
  autoOutput?: boolean;
};

/**
 * Options that can be passed to `cli()` to control execution behavior.
 */
export type PadroneCliPreferences<TScope extends string = string> = PadroneEvalPreferences & {
  /** REPL preferences used when `--repl` flag is passed. Set to `false` to disable the `--repl` flag. */
  repl?: PadroneReplPreferences<TScope> | false;
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
  ? NormalizeArguments<TCommand['~types']['argsInput']>
  : NormalizeArguments<TCommand['~types']['argsOutput']>;

type GetResults<TCommand extends AnyPadroneCommand> = ReturnType<NonNullable<TCommand['action']>>;

type GetArgsMeta<TArgs extends PadroneSchema> = PadroneArgsSchemaMeta<NonNullable<StandardSchemaV1.InferInput<TArgs>>>;

// ---------------------------------------------------------------------------
// Plugin system
// ---------------------------------------------------------------------------

/** Base context shared across all plugin phases within a single execution. */
export type PluginBaseContext = {
  /** The resolved command for this execution. In the parse phase, this is the root program. */
  command: AnyPadroneCommand;
  /** Mutable state bag shared across phases for this execution. Plugins can store cross-phase data here. */
  state: Record<string, unknown>;
};

/** Context for the parse phase. */
export type PluginParseContext = PluginBaseContext & {
  /** The raw CLI input string (undefined when invoked without input). */
  input: string | undefined;
};

/** Result returned by the parse phase's `next()`. */
export type PluginParseResult = {
  command: AnyPadroneCommand;
  rawArgs: Record<string, unknown>;
  positionalArgs: string[];
};

/** Context for the validate phase. */
export type PluginValidateContext = PluginBaseContext & {
  /** Raw named arguments extracted by the parser. Mutable — modify before `next()` to inject/override values. */
  rawArgs: Record<string, unknown>;
  /** Positional argument strings extracted by the parser. */
  positionalArgs: string[];
};

/** Result returned by the validate phase's `next()`. */
export type PluginValidateResult = {
  args: unknown;
  argsResult: StandardSchemaV1.Result<unknown>;
};

/** Context for the execute phase. */
export type PluginExecuteContext = PluginBaseContext & {
  /** Validated arguments that will be passed to the action. Mutable — modify before `next()` to override. */
  args: unknown;
};

/** Result returned by the execute phase's `next()`. */
export type PluginExecuteResult = {
  result: unknown;
};

type PluginPhaseHandler<TCtx, TResult> = (ctx: TCtx, next: () => TResult | Promise<TResult>) => TResult | Promise<TResult>;

/**
 * A Padrone plugin that can intercept the parse, validate, and execute phases of command execution.
 * Plugins are registered at the program level with `.use()` and apply to all commands.
 *
 * Each phase handler receives a context and a `next()` function (onion/middleware pattern):
 * - Call `next()` to proceed to the next plugin or the core operation.
 * - Return without calling `next()` to short-circuit.
 * - Wrap `next()` in try/catch for error handling.
 * - Modify context fields before `next()` to alter inputs.
 * - Transform the return value of `next()` to alter outputs.
 */
export type PadronePlugin = {
  /** Unique name for this plugin. Used for identification and future disable/override support. */
  name: string;
  /**
   * Ordering hint. Lower values run as outer layers (earlier before `next()`, later after).
   * Plugins with the same order preserve registration order. Defaults to `0`.
   */
  order?: number;
  /** Intercepts command routing and raw argument extraction. */
  parse?: PluginPhaseHandler<PluginParseContext, PluginParseResult>;
  /** Intercepts argument preprocessing, interactive prompting, and schema validation. */
  validate?: PluginPhaseHandler<PluginValidateContext, PluginValidateResult>;
  /** Intercepts handler execution. */
  execute?: PluginPhaseHandler<PluginExecuteContext, PluginExecuteResult>;
};
