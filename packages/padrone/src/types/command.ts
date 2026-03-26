import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { PadroneProgressIndicator, PadroneRuntime, PadroneSpinnerConfig, ResolvedPadroneRuntime } from '../core/runtime.ts';
import type { FullCommandName } from '../util/type-utils.ts';
import type { PadroneArgsSchemaMeta } from './args-meta.ts';
import type { AnyPadroneProgram } from './builder.ts';
import type { RegisteredInterceptor } from './interceptor.ts';
import type { PadroneSchema } from './schema.ts';

type UnknownRecord = Record<string, unknown>;
type DefaultArgs = UnknownRecord | void;

/**
 * Context object passed as the second argument to command action handlers.
 * Contains the resolved runtime, the executing command, and the program instance.
 */
export type PadroneActionContext<TContext = unknown> = {
  /** The resolved runtime for this command (I/O, env, config, etc.). */
  runtime: ResolvedPadroneRuntime;
  /** The command being executed. */
  command: AnyPadroneCommand;
  /** The root program instance. */
  program: AnyPadroneProgram;
  /**
   * The active auto-managed progress indicator, or a no-op if none is configured.
   * Use `.update()` to change the in-progress message mid-execution.
   */
  progress: PadroneProgressIndicator;
  /**
   * Cancellation signal that fires when the process receives SIGINT, SIGTERM, or SIGHUP.
   * Use with `fetch()`, child processes, or any API that accepts `AbortSignal`.
   * Check `signal.aborted` to test if cancellation was requested.
   * The `signal.reason` is a `PadroneSignal` string ('SIGINT', 'SIGTERM', or 'SIGHUP').
   */
  signal: AbortSignal;
  /** User-defined context object. Set via `.context()` on the builder and provided at `cli()`/`eval()` time. */
  context: TContext;
};

/**
 * A progress message value: a plain string, `null` to suppress, or an object with a message and custom indicator icon.
 */
export type PadroneProgressMessage = string | null | { message?: string | null; indicator?: string };

/**
 * Progress indicator configuration with per-state messages and optional dynamic callbacks.
 *
 * The `success` and `error` fields accept either a static value or a callback function:
 * - `string` — static message.
 * - `null` — suppress the message entirely.
 * - `{ message, indicator }` — custom message with a per-call indicator icon override.
 * - `(result) => PadroneProgressMessage` / `(error) => PadroneProgressMessage` — dynamic from the actual result/error.
 */
export type PadroneProgressPrefs<TRes = unknown> = {
  /** Message shown during async validation. Defaults to `''` (spinner only). */
  validation?: string;
  /** Message shown while the command's action is running. */
  progress?: string;
  /** Message shown when the command succeeds. `null` to suppress. Defaults to the `progress` message. */
  success?: PadroneProgressMessage | ((result: TRes) => PadroneProgressMessage);
  /** Message shown when the command fails. `null` to suppress. Defaults to the error message. */
  error?: PadroneProgressMessage | ((error: unknown) => PadroneProgressMessage);
  /** Spinner configuration: a preset name, custom frames/interval, or `false` to disable. */
  spinner?: PadroneSpinnerConfig;
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
  /** Group name for organizing this command under a labeled section in help output. */
  group?: string;
  /**
   * Automatically write this command's return value to output in CLI/eval/REPL mode.
   * Overrides the `autoOutput` setting in eval/cli preferences for this command.
   * See `PadroneEvalPreferences.autoOutput` for serialization details.
   */
  autoOutput?: boolean;
  /** Usage examples shown in help output. Each entry is a command-line invocation string. */
  examples?: string[];
  /**
   * Whether this command performs a mutation (create, update, delete).
   * - In `serve()`: mutation commands accept POST only; non-mutation commands accept GET and POST.
   * - In `mcp()`: sets `annotations.destructiveHint` on the tool definition.
   * - In `tool()`: defaults `needsApproval` to `true` when not explicitly set.
   */
  mutation?: boolean;
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
  TContext = unknown,
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
  /** Group name for organizing this command under a labeled section in help output. */
  group?: string;
  /** Whether this command performs a mutation (create, update, delete). Affects HTTP method in serve (POST-only) and MCP tool annotations (destructiveHint). */
  mutation?: boolean;
  needsApproval?: boolean | ((args: TArgs) => Promise<boolean> | boolean);
  autoOutput?: boolean;
  /** Usage examples shown in help output. Each entry is a command-line invocation string. */
  examples?: string[];
  /**
   * Auto-start a progress indicator when the command's execute phase begins.
   * - `true` — generic message based on command name.
   * - `string` — custom message for all states.
   * - `PadroneProgressConfig` — separate messages for progress, success, and error states.
   *
   * The indicator is automatically stopped on success (`.succeed()`) or failure (`.fail()`).
   * Requires a `progress` factory on the runtime — silently skipped if not available.
   */
  progress?: boolean | string | PadroneProgressPrefs;
  argsSchema?: TArgs;
  configSchema?: TConfig;
  envSchema?: TEnv;
  meta?: GetArgsMeta<TArgs>;
  action?: (args: StandardSchemaV1.InferOutput<TArgs>, ctx: PadroneActionContext<TContext>) => TRes;
  /** List of possible config file names to search for. */
  configFiles?: string[];
  /** Runtime flag indicating this command uses async validation. Set by `.async()` or `asyncSchema()`. */
  isAsync?: boolean;
  /** Runtime configuration for I/O abstraction. */
  runtime?: PadroneRuntime;

  /** Transform function that maps parent context to this command's context. Set by `.context(transform)`. */
  contextTransform?: (ctx: unknown) => unknown;

  /** Interceptors registered on this command. Collected from the parent chain at execution time. */
  interceptors?: RegisteredInterceptor[];

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
    context: TContext;
  };
};

export type AnyPadroneCommand = PadroneCommand<string, any, any, any, [...AnyPadroneCommand[]], string[], any, any, any, any>;

/**
 * Base type for extracting command information from builder or program.
 * Both PadroneBuilder and PadroneProgram share this structure.
 */
export type CommandTypesBase = {
  '~types': {
    command: AnyPadroneCommand;
  };
};

export type GetArgsMeta<TArgs extends PadroneSchema> = PadroneArgsSchemaMeta<NonNullable<StandardSchemaV1.InferInput<TArgs>>>;
