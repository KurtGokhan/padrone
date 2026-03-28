import { defineInterceptor } from '../core/interceptors.ts';
import type { PadroneBarConfig, PadroneProgressIndicator, PadroneProgressOptions, PadroneSpinnerConfig } from '../core/runtime.ts';
import type { AnyPadroneBuilder, CommandTypesBase } from '../types/index.ts';
import type { WithInterceptor } from '../util/type-utils.ts';
import type { PadroneProgressRenderer } from './progress-renderer.ts';
import { createTerminalProgress } from './progress-renderer.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A progress message value: a plain string, `null` to suppress, or an object with a message and custom indicator icon. */
export type PadroneProgressMessage = string | null | { message?: string | null; indicator?: string };

/**
 * Progress indicator configuration with per-state messages and optional dynamic callbacks.
 */
export type PadroneProgressConfig<TRes = unknown> = {
  /** Message shown during async validation. Defaults to `''` (spinner only). */
  validation?: string;
  /** Message shown while the command's action is running. */
  progress?: string;
  /** Message shown when the command succeeds. `null` to suppress. Defaults to the `progress` message. */
  success?: PadroneProgressMessage | ((result: TRes) => PadroneProgressMessage);
  /** Message shown when the command fails. `null` to suppress. Defaults to the error message. */
  error?: PadroneProgressMessage | ((error: unknown) => PadroneProgressMessage);
  /** Spinner configuration. Default `show` is `'auto'` (visible when bar is not shown). `true` forces spinner to always show (even alongside a bar). */
  spinner?: PadroneSpinnerConfig;
  /** Enable a progress bar. `true` for defaults (`show: 'always'`), or a `PadroneBarConfig` object. `false` to disable entirely. When omitted, bar defaults to `show: 'auto'`. */
  bar?: boolean | PadroneBarConfig;
  /**
   * Custom renderer factory. Called to create the progress indicator.
   * Defaults to the built-in terminal renderer (`createTerminalProgress`).
   */
  renderer?: PadroneProgressRenderer;
};

/**
 * Shared progress defaults that can be provided via context instead of repeating
 * at each call site. Per-instance message fields are excluded — those always come
 * from the constructor argument.
 *
 * Provide via context as `{ progressConfig: PadroneProgressDefaults }`.
 */
export type PadroneProgressDefaults = Pick<PadroneProgressConfig, 'spinner' | 'bar' | 'renderer'>;

/** Builder/program type after applying `padroneProgress()`. Adds `{ progress: PadroneProgressIndicator }` to the command context. */
export type WithProgress<T> = WithInterceptor<T, { progress: PadroneProgressIndicator }>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const noopIndicator: PadroneProgressIndicator = {
  update() {},
  succeed() {},
  fail() {},
  stop() {},
  pause() {},
  resume() {},
};

function resolveMessage(field: unknown, value: unknown, fallback?: string): { message: string | null | undefined; indicator?: string } {
  const raw = typeof field === 'function' ? (field as (v: unknown) => unknown)(value) : field;
  if (raw === undefined) return { message: fallback };
  if (raw === null || typeof raw === 'string') return { message: raw };
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { message?: string | null; indicator?: string };
    return { message: obj.message, indicator: obj.indicator };
  }
  return { message: fallback };
}

function cleanup(
  indicator: PadroneProgressIndicator,
  successConfig: unknown,
  errorConfig: unknown,
  error: unknown,
  result: unknown,
  isError: boolean,
) {
  if (isError) {
    const fallback = error instanceof Error ? error.message : String(error);
    const { message: errorMsg, indicator: errorIcon } = resolveMessage(errorConfig, error, fallback);
    indicator.fail(errorMsg, errorIcon !== undefined ? { indicator: errorIcon } : undefined);
  } else {
    const { message: successMsg, indicator: successIcon } = resolveMessage(successConfig, result);
    indicator.succeed(successMsg, successIcon !== undefined ? { indicator: successIcon } : undefined);
  }
}

// ---------------------------------------------------------------------------
// Interceptor
// ---------------------------------------------------------------------------

function progressInterceptor(config: string | PadroneProgressConfig) {
  const isObj = typeof config === 'object';
  const defaultMsg = typeof config === 'string' ? config : (config.progress ?? 'Working...');
  const progressMsg = isObj ? (config.progress ?? defaultMsg) : defaultMsg;
  const validationMsg = isObj ? (config.validation ?? '') : '';
  const successConfig = isObj ? config.success : undefined;
  const errorConfig = isObj ? config.error : undefined;
  // Raw constructor values — undefined means "not set by caller"
  const rawSpinner = isObj ? config.spinner : undefined;
  const rawBar = isObj ? config.bar : undefined;
  const rawRenderer = isObj ? config.renderer : undefined;

  return defineInterceptor({ id: 'padrone:progress', name: 'padrone:progress' })
    .requires<{ progressConfig?: PadroneProgressDefaults }>()
    .factory(() => {
      let indicator: PadroneProgressIndicator | undefined;
      let restoreOutput: (() => void) | undefined;
      // Lazily resolved from context + constructor args
      let resolvedRenderer: PadroneProgressRenderer | undefined;
      let resolvedOptions: PadroneProgressOptions | undefined;

      function resolve(ctx: { context?: { progressConfig?: PadroneProgressDefaults } }) {
        if (resolvedRenderer) return;
        const ctxCfg = (ctx.context as Record<string, unknown> | undefined)?.progressConfig as PadroneProgressDefaults | undefined;
        const spinner = rawSpinner ?? ctxCfg?.spinner;
        const bar = rawBar ?? ctxCfg?.bar;
        resolvedRenderer = rawRenderer ?? ctxCfg?.renderer ?? createTerminalProgress;
        resolvedOptions = spinner !== undefined || bar !== undefined ? { spinner, bar } : undefined;
      }

      const teardown = () => {
        restoreOutput?.();
        indicator = undefined;
        restoreOutput = undefined;
      };

      return {
        validate(ctx, next) {
          resolve(ctx);
          indicator = resolvedRenderer!(validationMsg || progressMsg, resolvedOptions);

          const originalOutput = ctx.runtime.output;
          const originalError = ctx.runtime.error;
          ctx.runtime.output = (...args: unknown[]) => {
            indicator!.pause();
            originalOutput(...args);
            indicator!.resume();
          };
          ctx.runtime.error = (text: string) => {
            indicator!.pause();
            originalError(text);
            indicator!.resume();
          };
          restoreOutput = () => {
            ctx.runtime.output = originalOutput;
            ctx.runtime.error = originalError;
          };

          return next();
        },

        execute(ctx, next) {
          // Transition from validation message to progress message
          if (indicator && validationMsg) indicator.update(progressMsg);

          const effectiveIndicator = indicator ?? noopIndicator;

          const onSuccess = (value: unknown) => {
            cleanup(effectiveIndicator, successConfig, errorConfig, undefined, value, false);
            teardown();
          };
          const onError = (err: unknown) => {
            if (indicator) {
              cleanup(indicator, successConfig, errorConfig, err, undefined, true);
              teardown();
            }
            throw err;
          };

          let result: any;
          try {
            result = next({ context: { ...(ctx.context as any), progress: effectiveIndicator } });
          } catch (err) {
            onError(err);
          }
          if (result instanceof Promise) {
            return result.then(
              (r) => {
                if (r.result instanceof Promise) {
                  return {
                    result: r.result.then(
                      (value: unknown) => {
                        onSuccess(value);
                        return value;
                      },
                      (err: unknown) => onError(err),
                    ),
                  };
                }
                onSuccess(r.result);
                return r;
              },
              (err: unknown) => onError(err),
            );
          }
          if (result!.result instanceof Promise) {
            return {
              result: result!.result.then(
                (value: unknown) => {
                  onSuccess(value);
                  return value;
                },
                (err: unknown) => onError(err),
              ),
            };
          }
          onSuccess(result!.result);
          return result;
        },
      };
    })
    .provides<{ progress: PadroneProgressIndicator }>();
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/**
 * Extension that adds an auto-managed progress indicator to the command pipeline.
 *
 * - `string` — a single message used for all states.
 * - `PadroneProgressConfig` — separate messages for validation, progress, success, and error.
 *
 * The indicator is automatically started before validation, updated at each phase transition,
 * and stopped on success (`.succeed()`) or failure (`.fail()`).
 *
 * Provides `{ progress: PadroneProgressIndicator }` on the command context.
 * Access it in action handlers as `ctx.context.progress`.
 *
 * Uses the built-in terminal renderer by default. Pass a custom `renderer` for non-terminal
 * environments (web UIs, testing, etc).
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli')
 *   .command('sync', (c) =>
 *     c.extend(padroneProgress('Syncing...'))
 *       .action((_args, ctx) => {
 *         ctx.context.progress.update('halfway');
 *       })
 *   )
 * ```
 */
export function padroneProgress<T extends CommandTypesBase>(config?: string | PadroneProgressConfig): (builder: T) => WithProgress<T> {
  return ((builder: AnyPadroneBuilder) => builder.intercept(progressInterceptor(config ?? 'Working...'))) as any;
}
