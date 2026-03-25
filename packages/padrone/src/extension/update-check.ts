import { getCommandRuntime } from '../core/commands.ts';
import { parseCliInputToParts } from '../core/parse.ts';
import type { UpdateCheckConfig } from '../feature/update-check.ts';
import type { CommandTypesBase, InterceptorShutdownContext, InterceptorStartContext } from '../types/index.ts';
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
  return ((builder: any) =>
    builder.intercept({
      id: 'padrone:update-check',
      name: 'padrone:update-check',
      order: 1000,
      start(ctx: InterceptorStartContext, next: () => unknown) {
        // Check for --no-update-check flag
        const hasNoUpdateCheckFlag =
          ctx.input &&
          parseCliInputToParts(ctx.input).some((p) => p.type === 'named' && p.key.length === 1 && p.key[0] === 'no-update-check');

        if (!hasNoUpdateCheckFlag) {
          const rootCommand = ctx.command;
          const currentVersion = getVersion(rootCommand.version);
          const runtime = getCommandRuntime(rootCommand);

          // Start background check
          const checkPromise = import('../feature/update-check.ts').then(({ createUpdateChecker }) => {
            const show = createUpdateChecker(rootCommand.name, currentVersion, config, runtime);
            return show;
          });
          ctx.state._updateCheckPromise = checkPromise;
        }

        // Strip --no-update-check from input
        if (hasNoUpdateCheckFlag && ctx.input) {
          const parts = parseCliInputToParts(ctx.input);
          const filtered = parts.filter((p) => !(p.type === 'named' && p.key.length === 1 && p.key[0] === 'no-update-check'));
          const tokens: string[] = [];
          for (const part of filtered) {
            if (part.type === 'term' || part.type === 'arg') {
              tokens.push(part.value.includes(' ') ? `"${part.value}"` : part.value);
            } else if (part.type === 'named') {
              const key = part.key.join('.');
              if (part.negated) tokens.push(`--no-${key}`);
              else if (part.value !== undefined) tokens.push(`--${key}=${Array.isArray(part.value) ? part.value.join(',') : part.value}`);
              else tokens.push(`--${key}`);
            } else if (part.type === 'alias') {
              const key = part.key[0]!;
              if (part.value !== undefined) tokens.push(`-${key} ${Array.isArray(part.value) ? part.value.join(',') : part.value}`);
              else tokens.push(`-${key}`);
            }
          }
          ctx.input = tokens.join(' ') || undefined;
        }

        return next();
      },
      shutdown(ctx: InterceptorShutdownContext, next: () => void) {
        const result = next();
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

        // If already resolved, show now
        if (resolved !== null) {
          (resolved as (() => void) | undefined)?.();
          return result;
        }

        // Otherwise the cache will be written for next time
        return result;
      },
    })) as any;
}
