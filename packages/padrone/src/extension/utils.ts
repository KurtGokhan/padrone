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
