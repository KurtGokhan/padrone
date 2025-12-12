import type { StandardSchemaV1 } from '@standard-schema/spec';

export interface PadroneOptionsMeta {
  description?: string;
  alias?: string[] | string;
  deprecated?: boolean | string;
  hidden?: boolean;
  examples?: unknown[];
}

export async function extractAliasesFromSchema(schema: StandardSchemaV1, meta?: Record<string, PadroneOptionsMeta | undefined>) {
  const aliases: Record<string, string> = {};

  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (!value?.alias) continue;
      const list = typeof value.alias === 'string' ? [value.alias] : value.alias;
      if (!list) continue;

      for (const aliasKey of list) {
        if (typeof aliasKey !== 'string' || !aliasKey || aliasKey === key) continue;
        aliases[aliasKey] = key;
      }
    }
  }

  const vendor = schema['~standard'].vendor;
  if (!vendor.includes('zod')) return aliases;

  const { $ZodObject, $ZodType, $ZodVoid, globalRegistry } = (await import('zod/v4/core').catch(() => null!)) || {};
  if (!$ZodObject) return aliases;

  if (schema instanceof $ZodVoid || !(schema instanceof $ZodObject)) return aliases;

  const shape = schema._zod.def.shape;
  if (!shape) return aliases;

  for (const [propertyName, propertySchema] of Object.entries(shape)) {
    if (!propertySchema || !(propertySchema instanceof $ZodType)) continue;
    const meta = globalRegistry.get(propertySchema);

    if (!meta?.alias) continue;
    const list = typeof meta.alias === 'string' ? [meta.alias] : meta.alias;
    if (!list) continue;

    for (const aliasKey of list) {
      if (typeof aliasKey !== 'string' || !aliasKey || aliasKey === propertyName) continue;
      aliases[aliasKey] = propertyName;
    }
  }

  return aliases;
}

export function preprocessAliases(data: Record<string, unknown>, aliases: Record<string, string>): Record<string, unknown> {
  const result = { ...data };

  for (const [aliasKey, fullOptionName] of Object.entries(aliases)) {
    if (aliasKey in data && aliasKey !== fullOptionName) {
      const aliasValue = data[aliasKey];
      // Prefer full option name if it exists
      if (!(fullOptionName in result)) result[fullOptionName] = aliasValue;
      delete result[aliasKey];
    }
  }

  return result;
}
