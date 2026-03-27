import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { PadroneProgressIndicator, ResolvedPadroneRuntime } from '../core/runtime.ts';
import type { AnyPadroneProgram } from './builder.ts';
import type { AnyPadroneCommand } from './command.ts';

// ---------------------------------------------------------------------------
// Interceptor system
// ---------------------------------------------------------------------------

/** Base context shared across all interceptor phases within a single execution. */
export type InterceptorBaseContext = {
  /** The resolved command for this execution. In the parse phase, this is the root program. */
  command: AnyPadroneCommand;
  /** Mutable state bag shared across phases for this execution. Interceptors can store cross-phase data here. */
  state: Record<string, unknown>;
  /** Cancellation signal that fires when the process receives a termination signal. */
  signal: AbortSignal;
  /** User-defined context object, resolved through the command's parent chain. */
  context: unknown;
  /** The resolved runtime for this execution. Interceptors can override this before calling `next()`. */
  runtime: ResolvedPadroneRuntime;
};

/** Context for the parse phase. */
export type InterceptorParseContext = InterceptorBaseContext & {
  /** The raw CLI input string (undefined when invoked without input). */
  input: string | undefined;
};

/** Result returned by the parse phase's `next()`. */
export type InterceptorParseResult = {
  command: AnyPadroneCommand;
  rawArgs: Record<string, unknown>;
  positionalArgs: string[];
};

/** Context for the validate phase. */
export type InterceptorValidateContext = InterceptorBaseContext & {
  /** Raw named arguments extracted by the parser. Mutable — modify before `next()` to inject/override values. */
  rawArgs: Record<string, unknown>;
  /** Positional argument strings extracted by the parser. */
  positionalArgs: string[];
  /** Pre-loaded config data (set by the config extension when `--config` is used). */
  configData?: Record<string, unknown>;
  /** Interactive mode override (set by the interactive extension when `--interactive` is used). */
  interactive?: boolean;
};

/** Result returned by the validate phase's `next()`. */
export type InterceptorValidateResult<TArgs = unknown> = {
  args: TArgs;
  argsResult: StandardSchemaV1.Result<TArgs>;
};

/** Context for the execute phase. */
export type InterceptorExecuteContext<TArgs = unknown> = InterceptorBaseContext & {
  /** Validated arguments that will be passed to the action. Mutable — modify before `next()` to override. */
  args: TArgs;
  /** Progress indicator injected by an interceptor. Action handlers receive this as `ctx.progress`. Defaults to a no-op. */
  progress?: PadroneProgressIndicator;
};

/** Result returned by the execute phase's `next()`. */
export type InterceptorExecuteResult<TResult = unknown> = {
  result: TResult;
};

/** Context for the start phase. Runs before parsing, wraps the entire pipeline. */
export type InterceptorStartContext = InterceptorBaseContext & {
  /** The raw CLI input string (undefined when invoked without input). */
  input: string | undefined;
  /** The program instance. Available for extensions that need program-level methods (e.g., repl). */
  program: AnyPadroneProgram;
};

/** Context for the error phase. Called when the pipeline throws. */
export type InterceptorErrorContext = InterceptorBaseContext & {
  /** The error that was thrown. */
  error: unknown;
};

/** Result returned by the error phase's `next()`. */
export type InterceptorErrorResult<TResult = unknown> = {
  /** The error (possibly transformed). Set to `undefined` to suppress the error. */
  error?: unknown;
  /** A replacement result when suppressing the error. */
  result?: TResult;
};

/** Context for the shutdown phase. Always runs after the pipeline (success or failure). */
export type InterceptorShutdownContext<TResult = unknown> = InterceptorBaseContext & {
  /** The error, if the pipeline failed (after error phase processing). */
  error?: unknown;
  /** The pipeline result, if it succeeded. */
  result?: TResult;
};

/** Overrides passable to `next()`. Provides autocomplete for common fields; accepts any phase-specific fields. */
export type InterceptorNextOverrides = Partial<InterceptorBaseContext> & Record<string, unknown>;

/**
 * A phase handler function for the interceptor middleware chain.
 *
 * - `TCtx` — the context object available to the handler.
 * - `TNextResult` — the typed result returned by `next()`, giving the handler type-safe access to downstream output.
 * - `TReturn` — the type the handler itself returns. Defaults to `TNextResult` but can be wider,
 *   allowing interceptors to transform or replace the result (e.g., error-recovery interceptors returning a different type).
 */
type InterceptorPhaseHandler<TCtx, TNextResult, TReturn = TNextResult> = (
  ctx: TCtx,
  next: (overrides?: InterceptorNextOverrides) => TNextResult | Promise<TNextResult>,
) => TReturn | Promise<TReturn>;

// ---------------------------------------------------------------------------
// Interceptor meta, phases, and factory
// ---------------------------------------------------------------------------

/** Static metadata for an interceptor. Always available at registration time without calling the factory. */
export type InterceptorMeta = {
  /** Display name for this interceptor. Used for identification in logs and debugging. */
  name: string;
  /**
   * Optional unique identifier for deduplication. When multiple interceptors share the same `id`,
   * only the last one registered is kept. Useful for allowing downstream code to override
   * an interceptor without accumulating duplicates.
   */
  id?: string;
  /**
   * Ordering hint. Lower values run as outer layers (earlier before `next()`, later after).
   * Interceptors with the same order preserve registration order. Defaults to `0`.
   */
  order?: number;
  /**
   * When `true`, the interceptor is skipped during execution. Combined with `id`-based deduplication,
   * this lets downstream code disable an interceptor by re-registering it with `disabled: true`.
   */
  disabled?: boolean;
};

/**
 * Phase handler definitions returned by an interceptor factory.
 * The factory's closure provides typed, scoped cross-phase state — no `state` bag needed
 * for data that stays within a single interceptor.
 *
 * Type parameters:
 * - `TArgs` — the validated arguments type (output of the args schema).
 * - `TResult` — the command's return type.
 */
export type InterceptorPhases<TArgs = unknown, TResult = unknown> = {
  /**
   * Runs before the pipeline (parse → validate → execute). `next()` proceeds to the pipeline.
   * Root interceptors only. Use for startup tasks like telemetry, update checks, or global config loading.
   */
  start?: InterceptorPhaseHandler<InterceptorStartContext, unknown>;
  /** Intercepts command routing and raw argument extraction. */
  parse?: InterceptorPhaseHandler<InterceptorParseContext, InterceptorParseResult>;
  /** Intercepts argument preprocessing, interactive prompting, and schema validation. */
  validate?: InterceptorPhaseHandler<InterceptorValidateContext, InterceptorValidateResult<TArgs>, InterceptorValidateResult>;
  /** Intercepts handler execution. */
  execute?: InterceptorPhaseHandler<InterceptorExecuteContext<TArgs>, InterceptorExecuteResult<TResult>, InterceptorExecuteResult>;
  /**
   * Called when the pipeline throws an error. `next()` passes to the next error handler
   * (innermost returns `{ error }` unchanged). Return `{ result }` without `error` to suppress.
   */
  error?: InterceptorPhaseHandler<InterceptorErrorContext, InterceptorErrorResult<TResult>, InterceptorErrorResult>;
  /**
   * Always runs after the pipeline completes (success or failure). `next()` calls the next shutdown handler.
   * Use for cleanup: closing connections, flushing logs, etc.
   */
  shutdown?: InterceptorPhaseHandler<InterceptorShutdownContext<TResult>, void>;
};

/**
 * Factory function that creates phase handlers for an interceptor.
 * Called once per command execution — the closure provides typed, scoped cross-phase state.
 */
export type InterceptorFactory<TArgs = unknown, TResult = unknown> = () => InterceptorPhases<TArgs, TResult>;

/**
 * A self-contained interceptor value: a factory function with static metadata as own properties.
 * Created via `defineInterceptor(meta, factory)`. This is the distributable form — a single
 * importable value that packages can export.
 *
 * Also accepted directly by `.intercept()` as the single-argument form.
 */
export type PadroneInterceptorFn<TArgs = unknown, TResult = unknown> = InterceptorFactory<TArgs, TResult> & InterceptorMeta;

/**
 * A Padrone interceptor in its single-value distributable form.
 * Alias for `PadroneInterceptorFn` — this is the primary public type.
 *
 * Create with `defineInterceptor(meta, factory)` or pass `(meta, factory)` directly to `.intercept()`.
 */
export type PadroneInterceptor<TArgs = unknown, TResult = unknown> = PadroneInterceptorFn<TArgs, TResult>;

/**
 * Internal stored form on command objects. Separates static metadata from the factory
 * so that deduplication and sorting can happen without calling the factory.
 */
export type RegisteredInterceptor = {
  meta: InterceptorMeta;
  factory: InterceptorFactory<any, any>;
};

/**
 * Resolved interceptor: metadata merged with phase handlers after the factory has been called.
 * Used internally by the runtime chain runner.
 */
export type ResolvedInterceptor = InterceptorMeta & InterceptorPhases<any, any>;
