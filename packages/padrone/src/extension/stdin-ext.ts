import { applyValues, isArrayField, isAsyncStreamField } from '../core/args.ts';
import { resolveStdin, resolveStdinAlways } from '../core/default-runtime.ts';
import { defineInterceptor } from '../core/interceptors.ts';
import type { AnyPadroneBuilder, CommandTypesBase, InterceptorValidateContext } from '../types/index.ts';
import { createStdinStream } from '../util/stream.ts';

// ── Interceptor ─────────────────────────────────────────────────────────

const stdinInterceptor = defineInterceptor({ id: 'padrone:stdin', name: 'padrone:stdin', order: -1001 }, () => ({
  validate(ctx: InterceptorValidateContext, next) {
    const stdinField = ctx.command.meta?.stdin;
    if (!stdinField) return next();

    // Skip if the field was already provided via CLI flags
    if (stdinField in ctx.rawArgs && ctx.rawArgs[stdinField] !== undefined) return next();

    const streamInfo = isAsyncStreamField(ctx.command.argsSchema, stdinField);
    if (streamInfo) {
      const stdinForStream = resolveStdinAlways(ctx.runtime as any);
      const mergedRawArgs = applyValues(ctx.rawArgs, { [stdinField]: createStdinStream(stdinForStream, streamInfo.itemSchema) });
      return next({ rawArgs: mergedRawArgs });
    }

    const stdin = resolveStdin(ctx.runtime as any);
    if (!stdin) return next();

    if (isArrayField(ctx.command.argsSchema, stdinField)) {
      return (async () => {
        const lines: string[] = [];
        for await (const line of stdin.lines()) {
          lines.push(line);
        }
        const mergedRawArgs = applyValues(ctx.rawArgs, { [stdinField]: lines });
        return next({ rawArgs: mergedRawArgs });
      })();
    }

    return stdin.text().then((text) => {
      if (!text) return next();
      const mergedRawArgs = applyValues(ctx.rawArgs, { [stdinField]: text });
      return next({ rawArgs: mergedRawArgs });
    });
  },
}));

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that reads stdin data into the argument field specified by `meta.stdin`.
 * Included by default via `createPadrone()`.
 *
 * Read mode is inferred from the schema type:
 * - `string` field → reads all stdin as a single string
 * - `string[]` field → reads stdin line-by-line into an array
 * - `AsyncIterable` field → returns a stream for line-by-line async consumption
 *
 * Stdin is only read when piped (not a TTY) and the field wasn't already provided via CLI flags.
 */
export function padroneStdin(options?: { disabled?: boolean }): <T extends CommandTypesBase>(builder: T) => T {
  const interceptor = options?.disabled ? defineInterceptor({ ...stdinInterceptor, disabled: true }, () => ({})) : stdinInterceptor;
  return ((builder: AnyPadroneBuilder) => builder.intercept(interceptor)) as any;
}
