import type {
  AnyPadroneCommand,
  InterceptorErrorContext,
  InterceptorErrorResult,
  InterceptorFactory,
  InterceptorMeta,
  InterceptorShutdownContext,
  InterceptorStartContext,
  PadroneInterceptorFn,
  RegisteredInterceptor,
  ResolvedInterceptor,
} from '../types/index.ts';
import { thenMaybe } from './results.ts';
import type { PadroneProgressIndicator, ResolvedPadroneRuntime } from './runtime.ts';

// ---------------------------------------------------------------------------
// defineInterceptor — creates a single-value distributable interceptor
// ---------------------------------------------------------------------------

/**
 * Creates a self-contained interceptor value by attaching static metadata to the factory function.
 * The returned value can be passed directly to `.intercept()` or exported from a package.
 *
 * ```ts
 * export const myInterceptor = defineInterceptor(
 *   { name: 'my-interceptor', order: 10 },
 *   () => ({
 *     execute(ctx, next) { return next(); },
 *   }),
 * );
 * ```
 */
export function defineInterceptor<TArgs = unknown, TResult = unknown>(
  meta: InterceptorMeta,
  factory: InterceptorFactory<TArgs, TResult>,
): PadroneInterceptorFn<TArgs, TResult> {
  // Function.name is readonly, so we need Object.defineProperty to override it
  Object.defineProperty(factory, 'name', { value: meta.name, configurable: true });
  if (meta.id !== undefined) (factory as any).id = meta.id;
  if (meta.order !== undefined) (factory as any).order = meta.order;
  return factory as PadroneInterceptorFn<TArgs, TResult>;
}

// ---------------------------------------------------------------------------
// Registration normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes an interceptor input (single-value form or two-arg form) into the internal
 * `RegisteredInterceptor` storage format.
 */
export function toRegisteredInterceptor(
  metaOrFn: InterceptorMeta | PadroneInterceptorFn<any, any>,
  factory?: InterceptorFactory<any, any>,
): RegisteredInterceptor {
  if (typeof metaOrFn === 'function') {
    // Single-value form: PadroneInterceptorFn (factory with meta as own properties)
    return { meta: { name: metaOrFn.name, id: metaOrFn.id, order: metaOrFn.order }, factory: metaOrFn };
  }
  // Two-arg form: (meta, factory)
  return { meta: metaOrFn, factory: factory! };
}

// ---------------------------------------------------------------------------
// Factory resolution
// ---------------------------------------------------------------------------

/**
 * Resolves registered interceptors by calling their factories and merging the resulting
 * phase handlers with the static metadata. Uses a cache to ensure each factory is called
 * at most once per execution (so root interceptor closures are shared across all phases).
 */
export function resolveRegisteredInterceptors(
  registered: RegisteredInterceptor[],
  cache: Map<RegisteredInterceptor, ResolvedInterceptor>,
): ResolvedInterceptor[] {
  return registered.map((reg) => {
    let resolved = cache.get(reg);
    if (!resolved) {
      resolved = { ...reg.meta, ...reg.factory() };
      cache.set(reg, resolved);
    }
    return resolved;
  });
}

// ---------------------------------------------------------------------------
// Interceptor chain runner
// ---------------------------------------------------------------------------

/**
 * Deduplicates interceptors by `id`. When multiple interceptors share the same `id`,
 * only the last one in the array is kept. Interceptors without an `id` are always kept.
 */
function deduplicateInterceptors(interceptors: ResolvedInterceptor[]): ResolvedInterceptor[] {
  // Fast path: no ids at all
  if (!interceptors.some((p) => p.id)) return interceptors;

  // Find the last index for each id
  const lastIndex = new Map<string, number>();
  for (let i = 0; i < interceptors.length; i++) {
    const id = interceptors[i]!.id;
    if (id) lastIndex.set(id, i);
  }

  return interceptors.filter((p, i) => !p.id || lastIndex.get(p.id) === i);
}

/**
 * Runs an interceptor chain for a given phase using the onion/middleware pattern.
 * Interceptors are sorted by `order` (ascending, stable), then composed so that
 * the first interceptor in sorted order is the outermost wrapper.
 * If no interceptors handle this phase, `core` is called directly.
 *
 * Each interceptor's `next()` accepts optional partial overrides that are merged
 * into the context before passing to the next interceptor or core function.
 */
export function runInterceptorChain<TCtx extends object, TResult>(
  phase: 'start' | 'parse' | 'validate' | 'execute' | 'error' | 'shutdown',
  interceptors: ResolvedInterceptor[],
  ctx: TCtx,
  core: (ctx: TCtx) => TResult | Promise<TResult>,
): TResult | Promise<TResult> {
  // Deduplicate by id (last wins), then filter to interceptors that have a handler for this phase
  const deduped = deduplicateInterceptors(interceptors);
  const phaseInterceptors = deduped.filter((p) => p[phase]);
  if (phaseInterceptors.length === 0) return core(ctx);

  // Stable sort by order (lower = outermost). Equal order preserves registration order.
  phaseInterceptors.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Build chain from inside out: last interceptor wraps core, first interceptor is outermost
  let next: (currentCtx: TCtx) => TResult | Promise<TResult> = core;
  for (let i = phaseInterceptors.length - 1; i >= 0; i--) {
    const handler = phaseInterceptors[i]![phase]! as unknown as (
      ctx: TCtx,
      next: (overrides?: Record<string, unknown>) => TResult | Promise<TResult>,
    ) => TResult | Promise<TResult>;
    const prevNext = next;
    next = (currentCtx: TCtx) =>
      handler(currentCtx, (overrides?: Record<string, unknown>) =>
        prevNext(overrides ? (Object.assign({}, currentCtx, overrides) as TCtx) : currentCtx),
      );
  }

  return next(ctx);
}

/**
 * Resolves a progress message field (static or callback) into the arguments for succeed/fail.
 * Handles string, null, `{ message, indicator }` objects, and callback functions.
 */
export function resolveProgressMessage(
  field: unknown,
  value: unknown,
  fallback?: string,
): { message: string | null | undefined; indicator?: string } {
  const raw = typeof field === 'function' ? (field as (v: unknown) => unknown)(value) : field;
  if (raw === undefined) return { message: fallback };
  if (raw === null || typeof raw === 'string') return { message: raw };
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { message?: string | null; indicator?: string };
    return { message: obj.message, indicator: obj.indicator };
  }
  return { message: fallback };
}

/** No-op progress indicator returned when the runtime doesn't provide a `progress` factory. */
export const noopIndicator: PadroneProgressIndicator = {
  update() {},
  succeed() {},
  fail() {},
  stop() {},
  pause() {},
  resume() {},
};

/** Creates a progress indicator from the runtime, or returns a no-op if unavailable. */
export function createProgress(
  runtime: ResolvedPadroneRuntime,
  message: string,
  options?: import('./runtime.ts').PadroneProgressOptions,
): PadroneProgressIndicator {
  return runtime.progress?.(message, options) ?? noopIndicator;
}

/**
 * Creates a lazy progress indicator that defers real indicator creation until first use.
 * This allows `ctx.progress` to work even without `.progress()` config, as long as the
 * runtime provides a progress factory.
 */
export function createLazyIndicator(runtime: ResolvedPadroneRuntime, state: Record<string, unknown>): PadroneProgressIndicator {
  if (!runtime.progress) return noopIndicator;

  let real: PadroneProgressIndicator | undefined;
  const ensure = (message?: string) => {
    if (!real) {
      real = runtime.progress!(message ?? '', undefined);
      state._progress = real;
    }
    return real;
  };

  return {
    update(msg) {
      ensure(msg).update(msg);
    },
    succeed(msg) {
      if (real) real.succeed(msg);
    },
    fail(msg) {
      if (real) real.fail(msg);
    },
    stop() {
      if (real) real.stop();
    },
    pause() {
      if (real) real.pause();
    },
    resume() {
      if (real) real.resume();
    },
  };
}

/**
 * Wraps a pipeline with start → error → shutdown lifecycle hooks.
 * - `start` interceptors wrap the pipeline (onion pattern, root interceptors only).
 * - On error: `error` interceptors run (can transform/suppress the error).
 * - Always: `shutdown` interceptors run (success or failure).
 */
export function wrapWithLifecycle<T>(
  interceptors: ResolvedInterceptor[],
  command: AnyPadroneCommand,
  state: Record<string, unknown>,
  input: string | undefined,
  pipeline: () => T | Promise<T>,
  wrapErrorResult?: (result: unknown) => T,
  signal?: AbortSignal,
  context?: unknown,
  runtime?: ResolvedPadroneRuntime,
): T | Promise<T> {
  const hasStart = interceptors.some((p) => p.start);
  const hasError = interceptors.some((p) => p.error);
  const hasShutdown = interceptors.some((p) => p.shutdown);

  const cleanupProgress = (error?: unknown, result?: unknown) => {
    const indicator = state._progress as PadroneProgressIndicator | undefined;
    if (indicator) {
      // If there's no progress config (lazy/manual indicator), just stop it silently
      const hasProgressConfig = '_progressMsg' in state;
      if (!hasProgressConfig) {
        indicator.stop();
      } else if (error !== undefined) {
        const fallback = error instanceof Error ? error.message : String(error);
        const { message: errorMsg, indicator: errorIcon } = resolveProgressMessage(state._progressError, error, fallback);
        indicator.fail(errorMsg, errorIcon !== undefined ? { indicator: errorIcon } : undefined);
      } else {
        const { message: successMsg, indicator: successIcon } = resolveProgressMessage(state._progressSuccess, result);
        indicator.succeed(successMsg, successIcon !== undefined ? { indicator: successIcon } : undefined);
      }
      (state._restoreOutput as (() => void) | undefined)?.();
      state._progress = undefined;
      state._restoreOutput = undefined;
    }
  };

  // Fast path: no lifecycle interceptors — still need progress cleanup
  if (!hasStart && !hasError && !hasShutdown) {
    let result: T | Promise<T>;
    try {
      result = pipeline();
    } catch (e) {
      cleanupProgress(e);
      throw e;
    }
    if (result instanceof Promise) {
      return result.then(
        (r) => {
          cleanupProgress();
          return r;
        },
        (e) => {
          cleanupProgress(e);
          throw e;
        },
      );
    }
    cleanupProgress();
    return result;
  }

  const defaultSignal = typeof AbortSignal !== 'undefined' ? AbortSignal.abort() : (undefined as unknown as AbortSignal);
  const effectiveSignal = signal ?? defaultSignal;

  const runShutdown = (error?: unknown, result?: unknown) => {
    cleanupProgress(error);
    if (!hasShutdown) return;
    const ctx: InterceptorShutdownContext = { command, state, error, result, signal: effectiveSignal, context, runtime: runtime! };
    return runInterceptorChain('shutdown', interceptors, ctx, () => {});
  };

  const runError = (error: unknown): T | Promise<T> => {
    if (!hasError) {
      const s = runShutdown(error);
      if (s instanceof Promise)
        return s.then(() => {
          throw error;
        });
      throw error;
    }
    const ctx: InterceptorErrorContext = { command, state, error, signal: effectiveSignal, context, runtime: runtime! };
    const errorResult = runInterceptorChain('error', interceptors, ctx, (): InterceptorErrorResult => ({ error }));
    return thenMaybe(errorResult, (er) => {
      if (er.error !== undefined) {
        const s = runShutdown(er.error);
        return thenMaybe(s as void | Promise<void>, () => {
          throw er.error;
        });
      }
      const wrapped = wrapErrorResult ? wrapErrorResult(er.result) : (er.result as T);
      const s = runShutdown(undefined, wrapped);
      return thenMaybe(s as void | Promise<void>, () => wrapped);
    });
  };

  const handleSuccess = (result: T): T | Promise<T> => {
    const s = runShutdown(undefined, result);
    if (s instanceof Promise) return s.then(() => result);
    return result;
  };

  // Run start phase wrapping the pipeline.
  // Use getter/setter so interceptors that set `ctx.input` automatically propagate to `state._input`,
  // which `runPipeline` reads as the effective input for the parse phase.
  const startCtx: InterceptorStartContext = {
    command,
    state,
    signal: effectiveSignal,
    context,
    runtime: runtime!,
    get input() {
      return (state._input as string | undefined) ?? input;
    },
    set input(v: string | undefined) {
      state._input = v;
    },
  };
  let result: T | Promise<T>;
  try {
    result = (hasStart ? runInterceptorChain('start', interceptors, startCtx, pipeline as any) : pipeline()) as T | Promise<T>;
  } catch (e) {
    return runError(e);
  }

  if (result instanceof Promise) {
    return result.then(handleSuccess, runError);
  }

  return handleSuccess(result);
}
