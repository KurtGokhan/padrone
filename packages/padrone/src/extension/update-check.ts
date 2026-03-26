import { thenMaybe } from '#src/core/results.ts';
import type { UpdateCheckConfig } from '../feature/update-check.ts';
import type { AnyPadroneBuilder, CommandTypesBase } from '../types/index.ts';
import { getVersion } from '../util/utils.ts';

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that adds background update checking:
 * - Checks for newer versions on npm (or custom registry) in the background
 * - Shows an update notification after command execution
 * - Respects `--no-update-check` flag to suppress
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli')
 *   .extend(padroneUpdateCheck({ packageName: 'my-cli' }))
 * ```
 */
export function padroneUpdateCheck(config: UpdateCheckConfig = {}): <T extends CommandTypesBase>(builder: T) => T {
  return ((builder: AnyPadroneBuilder) =>
    builder.intercept({
      id: 'padrone:update-check',
      name: 'padrone:update-check',
      order: 1000,
      start(ctx, next) {
        const rootCommand = ctx.command;
        const currentVersion = getVersion(rootCommand.version);
        const runtime = ctx.runtime;

        ctx.state._updateCheckPromise = import('../feature/update-check.ts').then(({ createUpdateChecker }) =>
          createUpdateChecker(rootCommand.name, currentVersion, config, runtime),
        );

        return next();
      },
      parse(ctx, next) {
        return thenMaybe(next(), (res) => {
          if ('update-check' in res.rawArgs) {
            if (res.rawArgs['update-check'] === false) ctx.state._noUpdateCheck = true;
            delete res.rawArgs['update-check'];
          }
          return res;
        });
      },
      shutdown(ctx, next) {
        const result = next();
        if (ctx.state._noUpdateCheck) return result;

        const showPromise = ctx.state._updateCheckPromise as Promise<(() => void) | undefined> | undefined;
        if (!showPromise) return result;

        // Try to show notification synchronously if the check already resolved
        let resolved: (() => void) | undefined | null = null;
        showPromise.then(
          (fn) => {
            resolved = fn;
          },
          () => {
            resolved = undefined;
          },
        );

        if (resolved !== null) {
          (resolved as (() => void) | undefined)?.();
        }

        return result;
      },
    })) as any;
}
