import type { AnyPadroneCommand, PadroneSchema } from '../types/index.ts';

type SchemaShape = Record<string, 'string' | 'string[]' | 'boolean'>;

type InferPassthroughSchema<T extends SchemaShape> = {
  [K in keyof T]: T[K] extends 'string' ? string : T[K] extends 'string[]' ? string[] : T[K] extends 'boolean' ? boolean : never;
};

/** Minimal Standard Schema that passes through known fields, ignoring unknown ones. */
export function passthroughSchema<TShape extends SchemaShape>(fields: TShape): PadroneSchema<InferPassthroughSchema<TShape>> {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'padrone' as const,
      jsonSchema: {
        input: () => ({}),
        output: () => ({}),
      },
      validate: (value) => {
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
        return { value: result as InferPassthroughSchema<TShape> };
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
