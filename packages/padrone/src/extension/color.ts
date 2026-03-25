import { getCommandRuntime } from '../core/commands.ts';
import { parseCliInputToParts } from '../core/parse.ts';
import { type ColorConfig, type ColorTheme, colorThemes } from '../output/colorizer.ts';
import type { AnyPadroneCommand, CommandTypesBase, InterceptorStartContext } from '../types/index.ts';

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
  return ((builder: any) =>
    builder.intercept({
      id: 'padrone:color',
      name: 'padrone:color',
      order: -999,
      start(ctx: InterceptorStartContext, next: () => unknown) {
        const colorFlag = extractColorFlag(ctx.input, ctx.command);
        if (colorFlag) {
          const runtime = getCommandRuntime(ctx.command);
          if (colorFlag.disableColor) {
            runtime.format = 'text';
            runtime.theme = undefined;
          } else if (colorFlag.theme) {
            runtime.theme = colorFlag.theme;
          }
          // Strip --color/--no-color from input so they don't appear as unknown args
          ctx.input = stripColorFlags(ctx.input);
        }
        return next();
      },
    })) as any;
}

/** Extract --color flag from input. */
function extractColorFlag(
  input: string | undefined,
  _rootCommand: AnyPadroneCommand,
): { theme?: ColorTheme | ColorConfig; disableColor?: boolean } | undefined {
  if (!input) return undefined;

  const parts = parseCliInputToParts(input);
  const args = parts.filter((p) => p.type === 'named');
  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

  for (const arg of args) {
    if (arg.type === 'named' && keyIs(arg.key, 'no-color')) {
      return { disableColor: true };
    }
    if (arg.type === 'named' && keyIs(arg.key, 'color')) {
      if (arg.negated) return { disableColor: true };
      if (arg.value === undefined || arg.value === 'true') return { theme: 'default' };
      if (arg.value === 'false') return { disableColor: true };
      if (typeof arg.value === 'string' && arg.value in colorThemes) return { theme: arg.value as ColorTheme };
      return undefined;
    }
  }
  return undefined;
}

/** Strip --color and --no-color flags from raw input. */
function stripColorFlags(input: string | undefined): string | undefined {
  if (!input) return input;

  const parts = parseCliInputToParts(input);
  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;
  const filtered = parts.filter((p) => {
    if (p.type !== 'named') return true;
    if (keyIs(p.key, 'color') || keyIs(p.key, 'no-color')) return false;
    return true;
  });

  if (filtered.length === parts.length) return input;

  // Reconstruct
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
  return tokens.join(' ') || undefined;
}
