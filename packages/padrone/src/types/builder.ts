import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Tool } from 'ai';
import type { PadroneRuntime } from '../core/runtime.ts';
import type { PadroneMcpPreferences } from '../feature/mcp.ts';
import type { PadroneServePreferences } from '../feature/serve.ts';
import type { WrapConfig, WrapResult } from '../feature/wrap.ts';
import type { HelpPreferences } from '../output/help.ts';
import type {
  FindDirectChild,
  FlattenCommands,
  FullCommandName,
  MaybePromise,
  OrAsync,
  OrAsyncMeta,
  PickCommandByName,
  PickCommandByPossibleCommands,
  PossibleCommands,
  RepathCommands,
  ReplaceOrAppendCommand,
  SafeString,
} from '../util/type-utils.ts';
import type {
  AnyPadroneCommand,
  CommandTypesBase,
  GetArgsMeta,
  PadroneActionContext,
  PadroneCommand,
  PadroneCommandConfig,
} from './command.ts';
import type {
  ExtractInterceptorContext,
  InterceptorFactory,
  InterceptorMeta,
  InterceptorRequiresCheck,
  InterceptorRequiresError,
  PadroneContextInterceptor,
  PadroneInterceptorFn,
} from './interceptor.ts';
import type { PadroneCliPreferences, PadroneEvalPreferences, PadroneReplPreferences } from './preferences.ts';
import type {
  GetArguments,
  MaybePromiseCommandResult,
  PadroneAPI,
  PadroneCommandResult,
  PadroneDrainResult,
  PadroneParseResult,
} from './result.ts';
import type { PadroneSchema } from './schema.ts';

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
 * When TContext is `unknown` (no `.context()` called), context param is optional.
 * Otherwise it is required.
 */
type ContextParam<TContext> = unknown extends TContext ? { context?: TContext } : { context: TContext };

/** Options for the `mount()` method. */
type MountOptions<TContext, TNewContext> = { context: (ctx: TContext) => TNewContext };

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
  TParentContext,
> = [FindDirectChild<TCommands, TNameNested>] extends [never]
  ? PadroneBuilder<TProgramName, TNameNested, TParentPath, PadroneSchema<void>, void, [], TParentArgs, false, TParentContext>
  : FindDirectChild<TCommands, TNameNested> extends infer E extends AnyPadroneCommand
    ? PadroneBuilder<
        TProgramName,
        TNameNested,
        TParentPath,
        E['~types']['argsSchema'],
        E['~types']['result'],
        E['~types']['commands'],
        TParentArgs,
        E['~types']['async'],
        E['~types']['context'],
        E['~types']['contextProvided']
      >
    : PadroneBuilder<TProgramName, TNameNested, TParentPath, PadroneSchema<void>, void, [], TParentArgs, false, TParentContext>;

export type AnyPadroneBuilder = InitialCommandBuilder<string, string, string, any, [...AnyPadroneCommand[]], any>;

/**
 * Like InitialCommandBuilder but uses `any` for args in the fresh case.
 * Used as the default for TBuilder when no builderFn is provided.
 */
type DefaultCommandBuilder<
  TProgramName extends string,
  TNameNested extends string,
  TParentPath extends string,
  TParentArgs extends PadroneSchema,
  TCommands extends [...AnyPadroneCommand[]],
  TParentContext,
> = [FindDirectChild<TCommands, TNameNested>] extends [never]
  ? PadroneBuilder<TProgramName, TNameNested, TParentPath, any, void, [], TParentArgs, false, TParentContext>
  : FindDirectChild<TCommands, TNameNested> extends infer E extends AnyPadroneCommand
    ? PadroneBuilder<
        TProgramName,
        TNameNested,
        TParentPath,
        E['~types']['argsSchema'],
        E['~types']['result'],
        E['~types']['commands'],
        TParentArgs,
        E['~types']['async'],
        E['~types']['context'],
        E['~types']['contextProvided']
      >
    : PadroneBuilder<TProgramName, TNameNested, TParentPath, any, void, [], TParentArgs, false, TParentContext>;

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
  TAsync extends boolean,
  TContext,
  TContextProvided = unknown,
> = TReturn extends 'builder'
  ? PadroneBuilder<TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TAsync, TContext, TContextProvided>
  : PadroneProgram<TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TAsync, TContext, TContextProvided>;

/**
 * Base builder methods shared between PadroneBuilder and PadroneProgram.
 * These methods are used for defining command structure (arguments, action, subcommands).
 */
export type PadroneBuilderMethods<
  TProgramName extends string,
  TName extends string,
  TParentName extends string,
  TArgs extends PadroneSchema,
  TRes,
  TCommands extends [...AnyPadroneCommand[]],
  TParentArgs extends PadroneSchema,
  TAsync extends boolean,
  TContext,
  TContextProvided,
  /** The return type for builder methods - either PadroneBuilder or PadroneProgram */
  TReturn extends 'builder' | 'program',
> = {
  extend: <TResult extends CommandTypesBase>(
    extension: PadroneExtension<
      BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TAsync, TContext, TContextProvided>,
      TResult
    >,
  ) => TResult;

  intercept: {
    /** Context-providing interceptor — extends context type. Rejects if required context is not satisfied. */
    <TInterceptor extends PadroneContextInterceptor<any, StandardSchemaV1.InferOutput<TArgs>, TRes>>(
      interceptor: TInterceptor,
    ): InterceptorRequiresCheck<TInterceptor, TContext & TContextProvided> extends true
      ? BuilderOrProgram<
          TReturn,
          TProgramName,
          TName,
          TParentName,
          TArgs,
          TRes,
          TCommands,
          TParentArgs,
          TAsync,
          TContext,
          TContextProvided & ExtractInterceptorContext<TInterceptor>
        >
      : InterceptorRequiresError;
    /** Plain interceptor — no context change. Rejects if required context is not satisfied. */
    <TInterceptor extends PadroneInterceptorFn<StandardSchemaV1.InferOutput<TArgs>, TRes>>(
      interceptor: TInterceptor,
    ): InterceptorRequiresCheck<TInterceptor, TContext & TContextProvided> extends true
      ? BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TAsync, TContext, TContextProvided>
      : InterceptorRequiresError;
    /** Register an interceptor with static metadata and a factory function. Context is strongly typed. */
    (
      meta: InterceptorMeta,
      factory: InterceptorFactory<StandardSchemaV1.InferOutput<TArgs>, TRes, TContext & TContextProvided>,
    ): BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TAsync, TContext, TContextProvided>;
  };

  configure: (
    config: PadroneCommandConfig,
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TAsync, TContext, TContextProvided>;

  runtime: (
    runtime: PadroneRuntime,
  ) => BuilderOrProgram<TReturn, TProgramName, TName, TParentName, TArgs, TRes, TCommands, TParentArgs, TAsync, TContext, TContextProvided>;

  async: () => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TArgs,
    TRes,
    TCommands,
    TParentArgs,
    true,
    TContext,
    TContextProvided
  >;

  /**
   * Declare or transform the user-defined context type for this command.
   *
   * - Without a callback: narrows the context type (type-only, no runtime transform).
   * - With a callback: transforms the parent/current context into a new type. Chainable — multiple calls compose.
   *
   * Interceptor-provided context (`TContextProvided`) is preserved across `.context()` calls.
   */
  context: {
    <TNewContext>(): BuilderOrProgram<
      TReturn,
      TProgramName,
      TName,
      TParentName,
      TArgs,
      TRes,
      TCommands,
      TParentArgs,
      TAsync,
      TNewContext,
      TContextProvided
    >;
    <TNewContext>(
      transform: (ctx: TContext) => TNewContext,
    ): BuilderOrProgram<
      TReturn,
      TProgramName,
      TName,
      TParentName,
      TArgs,
      TRes,
      TCommands,
      TParentArgs,
      TAsync,
      TNewContext,
      TContextProvided
    >;
  };

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
    OrAsyncMeta<OrAsync<TAsync, TNewArgs>, TMeta>,
    TContext,
    TContextProvided
  >;

  action: <TNewRes>(
    handler?: (
      args: StandardSchemaV1.InferOutput<TArgs>,
      ctx: PadroneActionContext<TContext & TContextProvided>,
      base: (args: StandardSchemaV1.InferOutput<TArgs>, ctx: PadroneActionContext<TContext & TContextProvided>) => TRes,
    ) => TNewRes,
  ) => BuilderOrProgram<
    TReturn,
    TProgramName,
    TName,
    TParentName,
    TArgs,
    TNewRes,
    TCommands,
    TParentArgs,
    TAsync,
    TContext,
    TContextProvided
  >;

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
    TAsync,
    TContext,
    TContextProvided
  >;

  command: <
    TNameNested extends string,
    TAliases extends string[] = [],
    TBuilder extends CommandTypesBase = DefaultCommandBuilder<
      TProgramName,
      TNameNested,
      FullCommandName<TName, TParentName>,
      TArgs,
      TCommands,
      TContext & TContextProvided
    >,
  >(
    name: TNameNested | readonly [TNameNested, ...TAliases],
    builderFn?: (
      builder: InitialCommandBuilder<
        TProgramName,
        TNameNested,
        FullCommandName<TName, TParentName>,
        TArgs,
        TCommands,
        TContext & TContextProvided
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
        : ReplaceOrAppendCommand<
            TCommands,
            TNameNested,
            WithAliases<TBuilder['~types']['command'], ResolvedAliases<TCommands, TNameNested, TAliases>>
          >,
    TParentArgs,
    TAsync,
    TContext,
    TContextProvided
  >;

  mount: {
    <TNameNested extends string, TAliases extends string[] = [], TProgram extends CommandTypesBase = CommandTypesBase>(
      name: TNameNested | readonly [TNameNested, ...TAliases],
      program: TProgram,
    ): BuilderOrProgram<
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
                TProgram['~types']['command']['~types']['async'],
                TContext & TContextProvided
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
                  TProgram['~types']['command']['~types']['async'],
                  TContext & TContextProvided
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
                  TProgram['~types']['command']['~types']['async'],
                  TContext & TContextProvided
                >,
                ResolvedAliases<TCommands, TNameNested, TAliases>
              >
            >,
      TParentArgs,
      TAsync,
      TContext,
      TContextProvided
    >;

    <
      TNameNested extends string,
      TAliases extends string[] = [],
      TProgram extends CommandTypesBase = CommandTypesBase,
      TNewContext = unknown,
    >(
      name: TNameNested | readonly [TNameNested, ...TAliases],
      program: TProgram,
      options: MountOptions<TContext & TContextProvided, TNewContext>,
    ): BuilderOrProgram<
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
                TProgram['~types']['command']['~types']['async'],
                TNewContext
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
                  TProgram['~types']['command']['~types']['async'],
                  TNewContext
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
                  TProgram['~types']['command']['~types']['async'],
                  TNewContext
                >,
                ResolvedAliases<TCommands, TNameNested, TAliases>
              >
            >,
      TParentArgs,
      TAsync,
      TContext,
      TContextProvided
    >;
  };

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
    context: TContext;
    contextProvided: TContextProvided;
    command: PadroneCommand<TName, TParentName, TArgs, TRes, TCommands, [], TAsync, TContext, TContextProvided>;
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
  TAsync extends boolean = false,
  TContext = unknown,
  TContextProvided = unknown,
> = PadroneBuilderMethods<
  TProgramName,
  TName,
  TParentName,
  TArgs,
  TRes,
  TCommands,
  TParentArgs,
  TAsync,
  TContext,
  TContextProvided,
  'builder'
>;

export type PadroneProgram<
  TProgramName extends string = '',
  TName extends string = string,
  TParentName extends string = '',
  TArgs extends PadroneSchema = PadroneSchema<DefaultArgs>,
  TRes = void,
  TCommands extends [...AnyPadroneCommand[]] = [],
  TParentArgs extends PadroneSchema = PadroneSchema<void>,
  TAsync extends boolean = false,
  TContext = unknown,
  TContextProvided = unknown,
> = PadroneBuilderMethods<
  TProgramName,
  TName,
  TParentName,
  TArgs,
  TRes,
  TCommands,
  TParentArgs,
  TAsync,
  TContext,
  TContextProvided,
  'program'
> & {
  run: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], true, true>>(
    name: TCommand | SafeString,
    args: NoInfer<GetArguments<'in', PickCommandByName<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>>,
    prefs?: ContextParam<TContext>,
  ) => PadroneCommandResult<PickCommandByName<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>;

  eval: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], true, true>>(
    input: TCommand | SafeString,
    prefs?: PadroneEvalPreferences & ContextParam<TContext>,
  ) => MaybePromiseCommandResult<
    PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>,
    PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>['~types']['async']
  >;

  cli: (
    prefs?: PadroneCliPreferences & ContextParam<TContext>,
  ) => MaybePromiseCommandResult<FlattenCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>]>, TAsync>;

  parse: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], true, false>>(
    input?: TCommand | SafeString,
  ) => MaybePromise<
    PadroneParseResult<PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>,
    PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>['~types']['async']
  >;

  stringify: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], false, true>>(
    command?: TCommand | SafeString,
    args?: GetArguments<'out', PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TCommand>>,
  ) => string;

  find: <const TFind extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], false, true>>(
    command: TFind | SafeString,
  ) => PickCommandByPossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], TFind> | undefined;

  api: () => PadroneAPI<PadroneCommand<'', '', TArgs, TRes, TCommands>>;

  repl: (options?: PadroneReplPreferences<PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>]>>) => AsyncIterable<
    PadroneCommandResult<FlattenCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>]>>
  > & {
    drain: () => Promise<PadroneDrainResult<PadroneCommandResult<FlattenCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>]>>[]>>;
  };

  tool: () => Tool<{ command: string }>;

  help: <const TCommand extends PossibleCommands<[PadroneCommand<'', '', TArgs, TRes, TCommands>], false, true>>(
    command?: TCommand,
    prefs?: HelpPreferences,
  ) => string;

  completion: (shell?: 'bash' | 'zsh' | 'fish' | 'powershell') => Promise<string>;

  mcp: (prefs?: PadroneMcpPreferences) => Promise<void>;

  serve: (prefs?: PadroneServePreferences) => Promise<void>;
};

export type AnyPadroneProgram = PadroneProgram<string, string, string, any, any, [...AnyPadroneCommand[]]>;

/**
 * A build-time extension that transforms a builder/program.
 * Extensions can add commands, arguments, interceptors, configure settings, etc.
 *
 * Use with `.extend(extension)`:
 * ```ts
 * const withAuth = (b) => b.arguments(authSchema).command('login', ...)
 * program.extend(withAuth)
 * ```
 */
export type PadroneExtension<TIn extends CommandTypesBase = CommandTypesBase, TOut extends CommandTypesBase = TIn> = (builder: TIn) => TOut;

type DefaultArgs = Record<string, unknown> | void;
