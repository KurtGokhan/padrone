import { defineInterceptor } from '../core/interceptors.ts';
import { isAsyncIterator, isIterator } from '../core/results.ts';
import type { AnyPadroneBuilder, CommandTypesBase, InterceptorExecuteResult } from '../types/index.ts';

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Outputs each value and collects into a result.
 * For iterators: outputs each yielded value, returns collected array.
 * For promises: awaits, then recurses.
 * For other values: outputs directly, returns as-is.
 */
function outputAndCollect(value: unknown, output: (...args: unknown[]) => void): unknown {
  if (value == null) return value;

  if (isAsyncIterator(value)) {
    return (async () => {
      const items: unknown[] = [];
      const iter = (value as any)[Symbol.asyncIterator]();
      while (true) {
        const { done, value: item } = await iter.next();
        if (done) break;
        items.push(item);
        if (item != null) output(item);
      }
      return items;
    })();
  }

  if (typeof value !== 'string' && !Array.isArray(value) && isIterator(value)) {
    const items: unknown[] = [];
    const iter = (value as any)[Symbol.iterator]();
    while (true) {
      const { done, value: item } = iter.next();
      if (done) break;
      items.push(item);
      if (item != null) output(item);
    }
    return items;
  }

  if (value instanceof Promise) {
    return value.then((resolved) => outputAndCollect(resolved, output));
  }

  output(value);
  return value;
}

// ── Interceptor ─────────────────────────────────────────────────────────

const autoOutputMeta = { id: 'padrone:auto-output', name: 'padrone:auto-output', order: -1100 } as const;

const autoOutputInterceptor = defineInterceptor(autoOutputMeta, () => ({
  execute(ctx, next) {
    const handleResult = (e: InterceptorExecuteResult): InterceptorExecuteResult | Promise<InterceptorExecuteResult> => {
      if (e.result instanceof Promise) {
        return { result: e.result.then((value: unknown) => outputAndCollect(value, ctx.runtime.output)) };
      }

      const collected = outputAndCollect(e.result, ctx.runtime.output);
      if (collected instanceof Promise) return collected.then((v) => ({ result: v }));
      return { result: collected };
    };

    const executedOrPromise = next();
    if (executedOrPromise instanceof Promise) return executedOrPromise.then(handleResult);
    return handleResult(executedOrPromise);
  },
}));

// ── Extension ───────────────────────────────────────────────────────────

/**
 * Extension that automatically writes a command's return value to output after execution.
 *
 * - Values are passed directly to the runtime's `output` function (no stringification).
 * - Promises are awaited before output.
 * - Iterators and async iterators are consumed, outputting each yielded value as it arrives.
 *   The result is replaced with the collected array so `drain()` still works.
 * - `undefined` and `null` results produce no output.
 *
 * Included in the default extensions. Can also be applied per-command:
 * ```ts
 * createPadrone('my-cli')
 *   .command('greet', (c) =>
 *     c.extend(padroneAutoOutput())
 *       .action(() => 'hello')
 *   )
 * ```
 */
export function padroneAutoOutput(options?: { disabled?: boolean }): <T extends CommandTypesBase>(builder: T) => T {
  const interceptor = options?.disabled ? defineInterceptor({ ...autoOutputMeta, disabled: true }, () => ({})) : autoOutputInterceptor;
  return ((builder: AnyPadroneBuilder) => builder.intercept(interceptor)) as any;
}
