import type {
  AnyPadroneCommand,
  InterceptorErrorContext,
  InterceptorErrorResult,
  InterceptorShutdownContext,
  InterceptorStartContext,
  PadroneInterceptor,
} from '../types/index.ts';
import { thenMaybe } from './results.ts';
import type { PadroneProgressIndicator, ResolvedPadroneRuntime } from './runtime.ts';

/**
 * Deduplicates interceptors by `id`. When multiple interceptors share the same `id`,
 * only the last one in the array is kept. Interceptors without an `id` are always kept.
 */
function deduplicateInterceptors(interceptors: PadroneInterceptor<any, any>[]): PadroneInterceptor<any, any>[] {
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
 */
export function runInterceptorChain<TCtx, TResult>(
  phase: 'start' | 'parse' | 'validate' | 'execute' | 'error' | 'shutdown',
  interceptors: PadroneInterceptor<any, any>[],
  ctx: TCtx,
  core: () => TResult | Promise<TResult>,
): TResult | Promise<TResult> {
  // Deduplicate by id (last wins), then filter to interceptors that have a handler for this phase
  const deduped = deduplicateInterceptors(interceptors);
  const phaseInterceptors = deduped.filter((p) => p[phase]);
  if (phaseInterceptors.length === 0) return core();

  // Stable sort by order (lower = outermost). Equal order preserves registration order.
  phaseInterceptors.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Build chain from inside out: last interceptor wraps core, first interceptor is outermost
  let next = core;
  for (let i = phaseInterceptors.length - 1; i >= 0; i--) {
    const handler = phaseInterceptors[i]![phase]! as unknown as (
      ctx: TCtx,
      next: () => TResult | Promise<TResult>,
    ) => TResult | Promise<TResult>;
    const prevNext = next;
    next = () => handler(ctx, prevNext);
  }

  return next();
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
  interceptors: PadroneInterceptor<any, any>[],
  command: AnyPadroneCommand,
  state: Record<string, unknown>,
  input: string | undefined,
  pipeline: () => T | Promise<T>,
  wrapErrorResult?: (result: unknown) => T,
  signal?: AbortSignal,
  context?: unknown,
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
    const ctx: InterceptorShutdownContext = { command, state, error, result, signal: effectiveSignal, context };
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
    const ctx: InterceptorErrorContext = { command, state, error, signal: effectiveSignal, context };
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

  // Run start phase wrapping the pipeline
  const startCtx: InterceptorStartContext = { command, state, input, signal: effectiveSignal, context };
  let result: T | Promise<T>;
  try {
    result = (hasStart ? runInterceptorChain('start', interceptors, startCtx, pipeline) : pipeline()) as T | Promise<T>;
  } catch (e) {
    return runError(e);
  }

  if (result instanceof Promise) {
    return result.then(handleSuccess, runError);
  }

  return handleSuccess(result);
}
