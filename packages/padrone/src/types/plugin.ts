import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AnyPadroneCommand } from './command.ts';

// ---------------------------------------------------------------------------
// Plugin system
// ---------------------------------------------------------------------------

/** Base context shared across all plugin phases within a single execution. */
export type PluginBaseContext = {
  /** The resolved command for this execution. In the parse phase, this is the root program. */
  command: AnyPadroneCommand;
  /** Mutable state bag shared across phases for this execution. Plugins can store cross-phase data here. */
  state: Record<string, unknown>;
  /** Cancellation signal that fires when the process receives a termination signal. */
  signal: AbortSignal;
  /** User-defined context object, resolved through the command's parent chain. */
  context: unknown;
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
export type PluginValidateResult<TArgs = unknown> = {
  args: TArgs;
  argsResult: StandardSchemaV1.Result<TArgs>;
};

/** Context for the execute phase. */
export type PluginExecuteContext<TArgs = unknown> = PluginBaseContext & {
  /** Validated arguments that will be passed to the action. Mutable — modify before `next()` to override. */
  args: TArgs;
};

/** Result returned by the execute phase's `next()`. */
export type PluginExecuteResult<TResult = unknown> = {
  result: TResult;
};

/** Context for the start phase. Runs before parsing, wraps the entire pipeline. */
export type PluginStartContext = PluginBaseContext & {
  /** The raw CLI input string (undefined when invoked without input). */
  input: string | undefined;
};

/** Context for the error phase. Called when the pipeline throws. */
export type PluginErrorContext = PluginBaseContext & {
  /** The error that was thrown. */
  error: unknown;
};

/** Result returned by the error phase's `next()`. */
export type PluginErrorResult<TResult = unknown> = {
  /** The error (possibly transformed). Set to `undefined` to suppress the error. */
  error?: unknown;
  /** A replacement result when suppressing the error. */
  result?: TResult;
};

/** Context for the shutdown phase. Always runs after the pipeline (success or failure). */
export type PluginShutdownContext<TResult = unknown> = PluginBaseContext & {
  /** The error, if the pipeline failed (after error phase processing). */
  error?: unknown;
  /** The pipeline result, if it succeeded. */
  result?: TResult;
};

/**
 * A phase handler function for the plugin middleware chain.
 *
 * - `TCtx` — the context object available to the handler.
 * - `TNextResult` — the typed result returned by `next()`, giving the handler type-safe access to downstream output.
 * - `TReturn` — the type the handler itself returns. Defaults to `TNextResult` but can be wider,
 *   allowing plugins to transform or replace the result (e.g., error-recovery plugins returning a different type).
 */
type PluginPhaseHandler<TCtx, TNextResult, TReturn = TNextResult> = (
  ctx: TCtx,
  next: () => TNextResult | Promise<TNextResult>,
) => TReturn | Promise<TReturn>;

/**
 * A Padrone plugin that can intercept the parse, validate, and execute phases of command execution.
 * Plugins are registered at the program or subcommand level with `.use()`.
 *
 * Type parameters:
 * - `TArgs` — the validated arguments type (output of the args schema). Provides typed `ctx.args` in the execute phase
 *   and typed `args` in the validate result from `next()`.
 * - `TResult` — the command's return type. Provides typed `result` in execute/error/shutdown phases.
 *
 * When registered inline on a builder, these are inferred from the command's types automatically.
 * For reusable plugins that work with any command, use `PadronePlugin<any, any>`.
 *
 * Each phase handler receives a context and a `next()` function (onion/middleware pattern):
 * - Call `next()` to proceed to the next plugin or the core operation.
 * - Return without calling `next()` to short-circuit.
 * - Wrap `next()` in try/catch for error handling.
 * - Modify context fields before `next()` to alter inputs.
 * - Transform the return value of `next()` to alter outputs.
 */
export type PadronePlugin<TArgs = unknown, TResult = unknown> = {
  /** Display name for this plugin. Used for identification in logs and debugging. */
  name: string;
  /**
   * Optional unique identifier for deduplication. When multiple plugins share the same `id`,
   * only the last one registered is kept. Useful for allowing downstream code to override
   * a plugin without accumulating duplicates.
   */
  id?: string;
  /**
   * Ordering hint. Lower values run as outer layers (earlier before `next()`, later after).
   * Plugins with the same order preserve registration order. Defaults to `0`.
   */
  order?: number;
  /**
   * Runs before the pipeline (parse → validate → execute). `next()` proceeds to the pipeline.
   * Root plugins only. Use for startup tasks like telemetry, update checks, or global config loading.
   */
  start?: PluginPhaseHandler<PluginStartContext, unknown>;
  /** Intercepts command routing and raw argument extraction. */
  parse?: PluginPhaseHandler<PluginParseContext, PluginParseResult>;
  /** Intercepts argument preprocessing, interactive prompting, and schema validation. */
  validate?: PluginPhaseHandler<PluginValidateContext, PluginValidateResult<TArgs>, PluginValidateResult>;
  /** Intercepts handler execution. */
  execute?: PluginPhaseHandler<PluginExecuteContext<TArgs>, PluginExecuteResult<TResult>, PluginExecuteResult>;
  /**
   * Called when the pipeline throws an error. `next()` passes to the next error handler
   * (innermost returns `{ error }` unchanged). Return `{ result }` without `error` to suppress.
   */
  error?: PluginPhaseHandler<PluginErrorContext, PluginErrorResult<TResult>, PluginErrorResult>;
  /**
   * Always runs after the pipeline completes (success or failure). `next()` calls the next shutdown handler.
   * Use for cleanup: closing connections, flushing logs, etc.
   */
  shutdown?: PluginPhaseHandler<PluginShutdownContext<TResult>, void>;
};
