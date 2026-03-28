import { defineInterceptor } from '../core/interceptors.ts';
import type { AnyPadroneBuilder, CommandTypesBase } from '../types/index.ts';
import type { InterceptorExecuteResult } from '../types/interceptor.ts';

// ── React element detection ─────────────────────────────────────────────

const reactElement = Symbol.for('react.element');
const reactTransitional = Symbol.for('react.transitional.element');

/** Checks whether a value is a React element (JSX) by inspecting its `$$typeof` symbol. */
export function isReactElement(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const tag = (value as Record<string | symbol, unknown>).$$typeof;
  return tag === reactElement || tag === reactTransitional;
}

// ── Types ───────────────────────────────────────────────────────────────

export type InkOptions = {
  /** Whether to wait for the Ink app to unmount before resolving. Defaults to `true`. */
  waitUntilExit?: boolean;
  /** Options forwarded to Ink's `render()`. */
  render?: import('ink').RenderOptions;
};

// ── Interceptor ─────────────────────────────────────────────────────────

const inkMeta = { id: 'padrone:ink', name: 'padrone:ink', order: -1050 } as const;

function createInkInterceptor(options: InkOptions = {}) {
  const { waitUntilExit = true } = options;

  return defineInterceptor(inkMeta, () => ({
    execute(ctx, next) {
      const handleResult = async (e: InterceptorExecuteResult): Promise<InterceptorExecuteResult> => {
        let value = e.result;
        if (value instanceof Promise) value = await value;
        if (!isReactElement(value)) return e;

        const { render } = await import('ink');
        const instance = render(value as import('react').ReactElement, options.render);

        // Unmount on abort so Ink cleans up stdin/stdout
        const onAbort = () => instance.unmount();
        ctx.signal.addEventListener('abort', onAbort, { once: true });

        if (waitUntilExit) {
          try {
            await instance.waitUntilExit();
          } finally {
            ctx.signal.removeEventListener('abort', onAbort);
          }
        }

        // Return undefined so auto-output skips this result
        return { result: undefined };
      };

      const executedOrPromise = next();
      if (executedOrPromise instanceof Promise) return executedOrPromise.then(handleResult);
      return handleResult(executedOrPromise);
    },
  }));
}

// ── Extension ───────────────────────────────────────────────────────────

/**
 * Extension that renders React (Ink) components returned from command actions.
 *
 * When a command's action returns a React element (JSX), this extension
 * renders it using Ink instead of passing it to the normal output path.
 *
 * Requires `ink` and `react` as peer dependencies.
 *
 * ```ts
 * import { createPadrone, padroneInk } from 'padrone';
 *
 * const program = createPadrone('my-tui')
 *   .extend(padroneInk())
 *   .command('dashboard', (c) =>
 *     c.action(() => <Dashboard />)
 *   );
 * ```
 */
export function padroneInk(options?: InkOptions): <T extends CommandTypesBase>(builder: T) => T {
  const interceptor = createInkInterceptor(options);
  return ((builder: AnyPadroneBuilder) => builder.intercept(interceptor)) as any;
}
