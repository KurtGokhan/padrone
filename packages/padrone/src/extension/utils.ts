import { parseCliInputToParts } from '../core/parse.ts';
import type { AnyPadroneCommand } from '../types/index.ts';

/**
 * Strip specific flags (named and alias) from a raw CLI input string.
 * Returns the cleaned input with matching flags removed.
 *
 * Each flag definition specifies:
 * - `name`: the long flag name (e.g., 'color', 'config')
 * - `aliases`: optional single-char aliases (e.g., ['c'])
 * - `hasValue`: whether the flag consumes a value (e.g., --config=path or --config path)
 * - `negatable`: whether --no-<name> should also be stripped
 */
export type FlagDef = {
  name: string;
  aliases?: string[];
  hasValue?: boolean;
  negatable?: boolean;
};

export function stripFlagsFromInput(
  input: string | undefined,
  flags: FlagDef[],
): { cleaned: string | undefined; extracted: Record<string, unknown> } {
  if (!input) return { cleaned: undefined, extracted: {} };

  const parts = parseCliInputToParts(input);
  const extracted: Record<string, unknown> = {};
  const indicesToRemove = new Set<number>();

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    for (const flag of flags) {
      if (part.type === 'named' && part.key.length === 1) {
        if (part.key[0] === flag.name) {
          extracted[flag.name] = part.value ?? true;
          indicesToRemove.add(i);
          break;
        }
        if (flag.negatable && (part.key[0] === `no-${flag.name}` || part.negated)) {
          extracted[flag.name] = false;
          indicesToRemove.add(i);
          break;
        }
      }

      if (part.type === 'alias' && part.key.length === 1 && flag.aliases?.includes(part.key[0]!)) {
        extracted[flag.name] = part.value ?? true;
        indicesToRemove.add(i);
        break;
      }
    }
  }

  if (indicesToRemove.size === 0) return { cleaned: input, extracted };

  // Reconstruct the input string without removed parts
  const remaining = parts.filter((_, idx) => !indicesToRemove.has(idx));
  const cleaned = reconstructInput(remaining);
  return { cleaned: cleaned || undefined, extracted };
}

/** Reconstruct a CLI input string from parsed parts. */
function reconstructInput(parts: ReturnType<typeof parseCliInputToParts>): string {
  const tokens: string[] = [];
  for (const part of parts) {
    if (part.type === 'term' || part.type === 'arg') {
      tokens.push(part.value.includes(' ') ? `"${part.value}"` : part.value);
    } else if (part.type === 'named') {
      const key = part.key.join('.');
      if (part.negated) {
        tokens.push(`--no-${key}`);
      } else if (part.value !== undefined) {
        if (Array.isArray(part.value)) {
          for (const v of part.value) tokens.push(`--${key}=${v}`);
        } else {
          tokens.push(`--${key}=${part.value}`);
        }
      } else {
        tokens.push(`--${key}`);
      }
    } else if (part.type === 'alias') {
      const key = part.key[0]!;
      if (part.value !== undefined) {
        if (Array.isArray(part.value)) {
          for (const v of part.value) tokens.push(`-${key} ${v}`);
        } else {
          tokens.push(`-${key} ${part.value}`);
        }
      } else {
        tokens.push(`-${key}`);
      }
    }
  }
  return tokens.join(' ');
}

/** Minimal Standard Schema that passes through known fields, ignoring unknown ones. */
export function passthroughSchema(fields: Record<string, 'string' | 'string[]' | 'boolean'>) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'padrone' as const,
      validate: (value: unknown) => {
        const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
        const result: Record<string, unknown> = {};
        for (const [name, type] of Object.entries(fields)) {
          const v = input[name];
          if (v === undefined) continue;
          if (type === 'string[]') {
            if (Array.isArray(v)) result[name] = v.map(String);
            else if (typeof v === 'string') result[name] = [v];
          } else if (type === 'string') {
            if (typeof v === 'string') result[name] = v;
            else if (Array.isArray(v) && v.length > 0) result[name] = String(v[0]);
          } else if (type === 'boolean') {
            result[name] = v === true || v === 'true';
          }
        }
        return { value: result };
      },
    },
  };
}

/** Find a command by space-separated name in the command tree. */
export function findCommandInTree(name: string, rootCommand: AnyPadroneCommand): AnyPadroneCommand | undefined {
  const parts = name.split(' ').filter(Boolean);
  let current = rootCommand;
  for (const part of parts) {
    const found = current.commands?.find((c) => c.name === part || c.aliases?.includes(part));
    if (!found) return undefined;
    current = found;
  }
  return current;
}
