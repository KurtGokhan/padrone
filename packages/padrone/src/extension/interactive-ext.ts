import { hasInteractiveConfig } from '../core/results.ts';
import type { CommandTypesBase, InterceptorValidateContext } from '../types/index.ts';

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that handles `--interactive` / `-i` flags.
 * Extracts the flag from rawArgs and stores the effective value in `state._interactive`.
 * The core validation pipeline reads `state._interactive` for the interactive override.
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
  return ((builder: any) =>
    builder.intercept({
      id: 'padrone:interactive',
      name: 'padrone:interactive',
      order: -999,
      validate(ctx: InterceptorValidateContext, next: () => unknown) {
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
            ctx.state._interactive = flagInteractive;
          }
        }

        return next();
      },
    })) as any;
}
