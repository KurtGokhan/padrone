import { thenMaybe } from '#src/core/results.ts';
import type { AnyPadroneBuilder, CommandTypesBase } from '../types/index.ts';

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that handles `--color` / `--no-color` flags:
 * - `--color` or `--color=true` → use default theme
 * - `--color=false` or `--no-color` → disable colors (text format)
 * - `--color=<theme>` → use the named theme
 *
 * Modifies the runtime's format and theme accordingly.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneColor())
 * ```
 */
export function padroneColor(): <T extends CommandTypesBase>(builder: T) => T {
  return ((builder: AnyPadroneBuilder) =>
    builder.intercept({
      id: 'padrone:color',
      name: 'padrone:color',
      order: -1001,
      parse(ctx, next) {
        return thenMaybe(next(), (res) => {
          if ('color' in res.rawArgs) {
            const color = res.rawArgs.color;
            delete res.rawArgs.color;

            ctx.runtime.theme = color as any;
          }
          return res;
        });
      },
    })) as any;
}
