import type {
  AnyPadroneCommand,
  AnyPadroneProgram,
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
  if (meta.disabled !== undefined) (factory as any).disabled = meta.disabled;
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
    return { meta: { name: metaOrFn.name, id: metaOrFn.id, order: metaOrFn.order, disabled: metaOrFn.disabled }, factory: metaOrFn };
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
  // Deduplicate by id (last wins), then filter to enabled interceptors that have a handler for this phase
  const deduped = deduplicateInterceptors(interceptors);
  const phaseInterceptors = deduped.filter((p) => p[phase] && !p.disabled);
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

/** No-op progress indicator returned when no progress extension is active. */
export const noopIndicator: PadroneProgressIndicator = {
  update() {},
  succeed() {},
  fail() {},
  stop() {},
  pause() {},
  resume() {},
};

/**
 * Wraps a pipeline with start → error → shutdown lifecycle hooks.
 * - `start` interceptors wrap the pipeline (onion pattern, root interceptors only).
 * - On error: `error` interceptors run (can transform/suppress the error).
 * - Always: `shutdown` interceptors run (success or failure).
 */
export function wrapWithLifecycle<T>(
  interceptors: ResolvedInterceptor[],
  command: AnyPadroneCommand,
  input: string | undefined,
  pipeline: () => T | Promise<T>,
  wrapErrorResult?: (result: unknown) => T,
  signal?: AbortSignal,
  context?: unknown,
  runtime?: ResolvedPadroneRuntime,
  program?: AnyPadroneProgram,
): T | Promise<T> {
  const hasStart = interceptors.some((p) => p.start);
  const hasError = interceptors.some((p) => p.error);
  const hasShutdown = interceptors.some((p) => p.shutdown);

  // Fast path: no lifecycle interceptors
  if (!hasStart && !hasError && !hasShutdown) return pipeline();

  const defaultSignal = typeof AbortSignal !== 'undefined' ? AbortSignal.abort() : (undefined as unknown as AbortSignal);
  const effectiveSignal = signal ?? defaultSignal;

  const runShutdown = (error?: unknown, result?: unknown) => {
    if (!hasShutdown) return;
    const ctx: InterceptorShutdownContext = { command, error, result, signal: effectiveSignal, context, runtime: runtime! };
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
    const ctx: InterceptorErrorContext = { command, error, signal: effectiveSignal, context, runtime: runtime! };
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

  const startCtx: InterceptorStartContext = {
    command,
    signal: effectiveSignal,
    context,
    runtime: runtime!,
    program: program!,
    input,
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
