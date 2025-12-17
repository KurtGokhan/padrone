import type { StandardJSONSchemaV1 } from '@standard-schema/spec';

export interface PadroneOptionsMeta {
  description?: string;
  alias?: string[] | string;
  deprecated?: boolean | string;
  hidden?: boolean;
  examples?: unknown[];
}

export function extractAliasesFromSchema(schema: StandardJSONSchemaV1, meta?: Record<string, PadroneOptionsMeta | undefined>) {
  const aliases: Record<string, string> = {};

  // Extract aliases from meta object (explicit parameter)
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

  // Extract aliases from JSON schema properties (e.g., Zod's .meta({ alias: [...] }))
  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        const propAlias = propertySchema?.alias;
        if (!propAlias) continue;

        const list = typeof propAlias === 'string' ? [propAlias] : propAlias;
        if (!Array.isArray(list)) continue;

        for (const aliasKey of list) {
          if (typeof aliasKey !== 'string' || !aliasKey || aliasKey === propertyName) continue;
          // Don't override if already set from meta
          if (!(aliasKey in aliases)) {
            aliases[aliasKey] = propertyName;
          }
        }
      }
    }
  } catch {
    // Ignore errors from JSON schema generation
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
