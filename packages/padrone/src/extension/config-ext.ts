import { parseCliInputToParts } from '../core/parse.ts';
import type { CommandTypesBase, InterceptorStartContext } from '../types/index.ts';

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that handles `--config` / `-c` flags for config file path override.
 * Extracts the config path and stores it in `state._configPath` for the validation phase.
 * Strips the flag from input so it doesn't appear as an unknown option.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneConfig())
 * ```
 */
export function padroneConfig(): <T extends CommandTypesBase>(builder: T) => T {
  return ((builder: any) =>
    builder.intercept({
      id: 'padrone:config',
      name: 'padrone:config',
      order: -999,
      start(ctx: InterceptorStartContext, next: () => unknown) {
        if (!ctx.input) return next();

        const parts = parseCliInputToParts(ctx.input);
        let configPath: string | undefined;
        const indicesToRemove = new Set<number>();

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]!;
          if (part.type === 'named' && part.key.length === 1 && part.key[0] === 'config' && typeof part.value === 'string') {
            configPath = part.value;
            indicesToRemove.add(i);
            break;
          }
          if (part.type === 'alias' && part.key.length === 1 && part.key[0] === 'c' && typeof part.value === 'string') {
            configPath = part.value;
            indicesToRemove.add(i);
            break;
          }
        }

        if (configPath) {
          ctx.state._configPath = configPath;

          // Strip from input
          const filtered = parts.filter((_, idx) => !indicesToRemove.has(idx));
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
    })) as any;
}
