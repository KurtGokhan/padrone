import type { StandardSchemaV1 } from '@standard-schema/spec';
import { applyValues } from '../core/args.ts';
import { defineInterceptor } from '../core/interceptors.ts';
import { thenMaybe } from '../core/results.ts';
import type { AnyPadroneBuilder, CommandTypesBase, InterceptorValidateContext } from '../types/index.ts';

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that reads environment variables, validates them against a schema,
 * and merges the transformed values into command arguments.
 *
 * The schema transforms raw env vars into the args shape:
 * ```ts
 * .extend(padroneEnv(
 *   z.object({ PORT: z.string() }).transform(e => ({ port: Number(e.PORT) }))
 * ))
 * ```
 *
 * Env values have lower precedence than CLI args and stdin, but higher than config files.
 */
export function padroneEnv(schema: StandardSchemaV1): <T extends CommandTypesBase>(builder: T) => T {
  const interceptor = defineInterceptor({ id: 'padrone:env', name: 'padrone:env', order: -1000 }, () => ({
    validate(ctx: InterceptorValidateContext, next) {
      const rawEnv = ctx.runtime.env();
      const envValidated = schema['~standard'].validate(rawEnv);

      return thenMaybe(envValidated, (result) => {
        if (result.issues || !result.value) return next();
        const envData = result.value as Record<string, unknown>;
        const mergedRawArgs = applyValues(ctx.rawArgs, envData);
        return next({ rawArgs: mergedRawArgs });
      });
    },
  }));

  return ((builder: AnyPadroneBuilder) => builder.intercept(interceptor)) as any;
}
