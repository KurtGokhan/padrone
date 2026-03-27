import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { PadroneFieldMeta } from '../types/args-meta.ts';
import { camelToKebab } from '../util/shell-utils.ts';
import { asyncStreamRegistry } from '../util/stream.ts';

export type { PadroneArgsSchemaMeta, PadroneFieldMeta, SingleChar, StdinConfig } from '../types/args-meta.ts';

/** Extract the JSON schema from a Standard Schema, returning it as a plain record. */
export function getJsonSchema(schema: StandardJSONSchemaV1): Record<string, any> {
  return schema['~standard'].jsonSchema.input({
    target: 'draft-2020-12',
    libraryOptions: { unrepresentable: 'any' },
  }) as Record<string, any>;
}

function getFieldJsonSchema(schema: StandardJSONSchemaV1 | undefined, field: string): Record<string, any> | undefined {
  if (!schema) return undefined;
  try {
    const jsonSchema = getJsonSchema(schema);
    if (jsonSchema.type === 'object' && jsonSchema.properties) return jsonSchema.properties[field];
  } catch {}
  return undefined;
}

/**
 * Checks if a field in the schema is an array type (e.g. `z.string().array()`).
 */
export function isArrayField(schema: StandardJSONSchemaV1 | undefined, field: string): boolean {
  return getFieldJsonSchema(schema, field)?.type === 'array';
}

/**
 * Checks if a field is an async stream (marked with `asyncStream()` metadata).
 * Returns the item schema if provided, or `true` if it's a plain string stream.
 */
export function isAsyncStreamField(schema: StandardJSONSchemaV1 | undefined, field: string): { itemSchema?: StandardSchemaV1 } | false {
  const prop = getFieldJsonSchema(schema, field);
  const asyncStreamId = prop?.asyncStream;
  if (asyncStreamId && asyncStreamRegistry.has(asyncStreamId)) {
    const meta = asyncStreamRegistry.get(asyncStreamId);
    return { itemSchema: meta?.itemSchema };
  }

  return false;
}

/**
 * Parse positional configuration to extract names and variadic info.
 */
export function parsePositionalConfig(positional: readonly string[]): { name: string; variadic: boolean }[] {
  return positional.map((p) => {
    const variadic = p.startsWith('...');
    const name = variadic ? p.slice(3) : p;
    return { name, variadic };
  });
}

/**
 * Result type for extractSchemaMetadata function.
 */
interface SchemaMetadataResult {
  /** Single-char flags: maps flag char → full arg name (e.g. `{ v: 'verbose' }`) */
  flags: Record<string, string>;
  /** Multi-char aliases: maps alias → full arg name (e.g. `{ 'dry-run': 'dryRun' }`) */
  aliases: Record<string, string>;
}

function addEntries(target: Record<string, string>, key: string, items: string | readonly string[], filter?: (item: string) => boolean) {
  const list = typeof items === 'string' ? [items] : items;
  for (const item of list) {
    if (typeof item === 'string' && item && item !== key && !(item in target) && (!filter || filter(item))) {
      target[item] = key;
    }
  }
}

/**
 * Extract all arg metadata from schema and meta in a single pass.
 * Returns flags (single-char, stackable) and aliases (multi-char, long names) separately.
 * When `autoAlias` is true (default), camelCase property names automatically get kebab-case aliases.
 */
export function extractSchemaMetadata(
  schema: StandardJSONSchemaV1,
  meta?: Record<string, PadroneFieldMeta | undefined>,
  autoAlias?: boolean,
): SchemaMetadataResult {
  const flags: Record<string, string> = {};
  const aliases: Record<string, string> = {};

  // Extract from meta object
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (!value) continue;

      if (value.flags) {
        addEntries(flags, key, value.flags, (item) => item.length === 1);
      }
      if (value.alias) {
        addEntries(aliases, key, value.alias, (item) => item.length > 1);
      }
    }
  }

  // Extract from JSON schema properties
  try {
    const jsonSchema = getJsonSchema(schema) as Record<string, any>;
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        if (!propertySchema) continue;

        // Extract flags from schema `.meta({ flags: ... })`
        const propFlags = propertySchema.flags;
        if (propFlags) {
          addEntries(flags, propertyName, propFlags, (item) => item.length === 1);
        }

        // Extract aliases from schema `.meta({ alias: ... })`
        const propAlias = propertySchema.alias;
        if (propAlias) {
          const list = typeof propAlias === 'string' ? [propAlias] : propAlias;
          if (Array.isArray(list)) {
            addEntries(aliases, propertyName, list, (item) => item.length > 1);
          }
        }

        // Auto-generate kebab-case alias for camelCase property names
        if (autoAlias !== false) {
          const kebab = camelToKebab(propertyName);
          if (kebab && !(kebab in aliases)) {
            aliases[kebab] = propertyName;
          }
        }
      }
    }
  } catch {
    // Ignore errors from JSON schema generation
  }

  return { flags, aliases };
}

function preprocessMappings(data: Record<string, unknown>, mappings: Record<string, string>): Record<string, unknown> {
  const result = { ...data };

  for (const [mappedKey, fullArgName] of Object.entries(mappings)) {
    if (mappedKey in data && mappedKey !== fullArgName) {
      const mappedValue = data[mappedKey];
      // Prefer full arg name if it exists
      if (!(fullArgName in result)) result[fullArgName] = mappedValue;
      delete result[mappedKey];
    }
  }

  return result;
}

/**
 * Apply values to arguments using "set if not present" semantics.
 * Existing values take precedence — only fills in undefined or missing keys.
 */
export function applyValues(data: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };

  for (const [key, value] of Object.entries(values)) {
    if (key in result && result[key] !== undefined) continue;
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/** Applies flag and alias mappings to raw arguments. */
export function preprocessArgs(
  data: Record<string, unknown>,
  ctx: { flags?: Record<string, string>; aliases?: Record<string, string> },
): Record<string, unknown> {
  let result = { ...data };

  if (ctx.flags && Object.keys(ctx.flags).length > 0) {
    result = preprocessMappings(result, ctx.flags);
  }
  if (ctx.aliases && Object.keys(ctx.aliases).length > 0) {
    result = preprocessMappings(result, ctx.aliases);
  }

  return result;
}

/**
 * Auto-coerce CLI string values to match the expected schema types.
 * Handles: string → number, string → boolean for primitive schema fields.
 * Arrays of primitives are also coerced element-wise.
 */
export function coerceArgs(data: Record<string, unknown>, schema: StandardJSONSchemaV1): Record<string, unknown> {
  let properties: Record<string, any>;
  try {
    const jsonSchema = getJsonSchema(schema) as Record<string, any>;
    if (jsonSchema.type !== 'object' || !jsonSchema.properties) return data;
    properties = jsonSchema.properties;
  } catch {
    return data;
  }

  const result = { ...data };

  for (const [key, value] of Object.entries(result)) {
    const prop = properties[key];
    if (!prop) continue;

    const targetType = prop.type as string | undefined;

    if (targetType === 'number' || targetType === 'integer') {
      if (typeof value === 'string') {
        const num = Number(value);
        if (!Number.isNaN(num)) result[key] = num;
      }
    } else if (targetType === 'boolean') {
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') result[key] = true;
        else if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') result[key] = false;
      }
    } else if (targetType === 'array') {
      // Coerce single items to array
      const arr = Array.isArray(value) ? value : [value];
      const itemType = prop.items?.type as string | undefined;
      if (itemType === 'number' || itemType === 'integer') {
        result[key] = arr.map((v) => {
          if (typeof v === 'string') {
            const num = Number(v);
            return Number.isNaN(num) ? v : num;
          }
          return v;
        });
      } else if (itemType === 'boolean') {
        result[key] = arr.map((v) => {
          if (typeof v === 'string') {
            const lower = v.toLowerCase();
            if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
            if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') return false;
          }
          return v;
        });
      } else if (!Array.isArray(value)) {
        result[key] = arr;
      }
    }
  }

  return result;
}

/**
 * Detect unknown keys in the args that don't match any schema property.
 * Returns an array of { key, suggestion? } for each unknown key.
 * Framework-reserved keys (--config, -c) are always allowed.
 */
export function detectUnknownArgs(
  data: Record<string, unknown>,
  schema: StandardJSONSchemaV1,
  flags: Record<string, string>,
  aliases: Record<string, string>,
  suggestFn: (input: string, candidates: string[]) => string[],
): { key: string; suggestions: string[] }[] {
  let properties: Record<string, any>;
  let isLoose = false;
  try {
    const jsonSchema = getJsonSchema(schema) as Record<string, any>;
    if (jsonSchema.type !== 'object' || !jsonSchema.properties) return [];
    properties = jsonSchema.properties;
    // If additionalProperties is set (true, {}, or a schema), the schema allows extra keys
    if (jsonSchema.additionalProperties !== undefined && jsonSchema.additionalProperties !== false) isLoose = true;
  } catch {
    return [];
  }

  if (isLoose) return [];

  const knownKeys = new Set<string>([
    ...Object.keys(properties),
    ...Object.keys(flags),
    ...Object.values(flags),
    ...Object.keys(aliases),
    ...Object.values(aliases),
  ]);
  const propertyNames = Object.keys(properties);
  const unknowns: { key: string; suggestions: string[] }[] = [];

  for (const key of Object.keys(data)) {
    if (!knownKeys.has(key)) {
      const suggestions = suggestFn(key, propertyNames);
      unknowns.push({ key, suggestions });
    }
  }

  return unknowns;
}
