import z from 'zod/v4';

export interface ZodrunOptionsMeta {
  description?: string;
  deprecated?: boolean;
  alias?: string[] | string;
  examples?: z.$input[];
}

export function extractAliasesFromSchema(schema: z.ZodType): Record<string, string> {
  const aliases: Record<string, string> = {};

  if (schema instanceof z.ZodVoid || !(schema instanceof z.ZodObject)) return aliases;

  const shape = schema.shape;
  if (!shape) return aliases;

  for (const [propertyName, propertySchema] of Object.entries(shape)) {
    if (!propertySchema || !(propertySchema instanceof z.ZodType)) continue;
    const meta = propertySchema.meta();

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

export function augmentSchemaWithOptionsSpec(schema: z.ZodType): z.ZodType {
  const aliases = extractAliasesFromSchema(schema);
  if (Object.keys(aliases).length === 0) return schema;
  if (schema instanceof z.ZodVoid || !(schema instanceof z.ZodObject)) return schema;

  return z.preprocess((data) => {
    if (typeof data !== 'object' || data === null) return data;
    return preprocessAliases(data as Record<string, unknown>, aliases);
  }, schema);
}
