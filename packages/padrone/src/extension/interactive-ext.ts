import { defineInterceptor } from '../core/interceptors.ts';
import { hasInteractiveConfig } from '../core/results.ts';
import type { AnyPadroneBuilder, CommandTypesBase, InterceptorValidateContext } from '../types/index.ts';

// ── Interceptor ─────────────────────────────────────────────────────────

const interactiveInterceptor = defineInterceptor({ id: 'padrone:interactive', name: 'padrone:interactive', order: -999 }, () => ({
  validate(ctx: InterceptorValidateContext, next) {
    if (hasInteractiveConfig(ctx.command.meta)) {
      let flagInteractive: boolean | undefined;

      if (ctx.rawArgs.interactive !== undefined) {
        flagInteractive = ctx.rawArgs.interactive !== false && ctx.rawArgs.interactive !== 'false';
        delete ctx.rawArgs.interactive;
      }
      if (ctx.rawArgs.i !== undefined) {
        flagInteractive = ctx.rawArgs.i !== false && ctx.rawArgs.i !== 'false';
        delete ctx.rawArgs.i;
      }

      if (flagInteractive !== undefined) {
        return next({ interactive: flagInteractive });
      }
    }

    return next();
  },
}));

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that handles `--interactive` / `-i` flags.
 * Extracts the flag from rawArgs and passes the effective value to the core
 * validation pipeline via `next()` context override.
 *
 * Note: This extension only handles flag extraction. The actual interactive prompting
 * logic remains in the core validation pipeline.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneInteractive())
 * ```
 */
export function padroneInteractive(): <T extends CommandTypesBase>(builder: T) => T {
  return ((builder: AnyPadroneBuilder) => builder.intercept(interactiveInterceptor)) as any;
}
