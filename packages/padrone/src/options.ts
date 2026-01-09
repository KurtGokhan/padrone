import type { StandardJSONSchemaV1 } from '@standard-schema/spec';

export interface PadroneOptionsMeta {
  description?: string;
  alias?: string[] | string;
  deprecated?: boolean | string;
  hidden?: boolean;
  examples?: unknown[];
}

type PositionalArgs<TObj> =
  TObj extends Record<string, any>
    ? {
        [K in keyof TObj]: TObj[K] extends Array<any> ? `...${K & string}` : K & string;
      }[keyof TObj]
    : string;

/**
 * Meta configuration for options including positional arguments.
 * The `positional` array defines which options are positional arguments and their order.
 * Use '...name' prefix to indicate variadic (rest) arguments, matching JS/TS rest syntax.
 *
 * @example
 * ```ts
 * .options(schema, {
 *   positional: ['source', '...files', 'dest'],  // '...files' is variadic
 * })
 * ```
 */
export interface PadroneMeta<TObj = Record<string, any>> {
  /**
   * Array of option names that should be treated as positional arguments.
   * Order in array determines position. Use '...name' prefix for variadic args.
   * @example ['source', '...files', 'dest'] - 'files' captures multiple values
   */
  positional?: PositionalArgs<TObj>[];
  /**
   * Per-option metadata.
   */
  options?: { [K in keyof TObj]?: PadroneOptionsMeta };
}

/**
 * Parse positional configuration to extract names and variadic info.
 */
export function parsePositionalConfig(positional: string[]): { name: string; variadic: boolean }[] {
  return positional.map((p) => {
    const isVariadic = p.startsWith('...');
    const name = isVariadic ? p.slice(3) : p;
    return { name, variadic: isVariadic };
  });
}

/**
 * Result type for extractSchemaMetadata function.
 */
interface SchemaMetadataResult {
  aliases: Record<string, string>;
}

/**
 * Extract all option metadata from schema and meta in a single pass.
 * This consolidates aliases, env bindings, and config keys extraction.
 */
export function extractSchemaMetadata(
  schema: StandardJSONSchemaV1,
  meta?: Record<string, PadroneOptionsMeta | undefined>,
): SchemaMetadataResult {
  const aliases: Record<string, string> = {};

  // Extract from meta object
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (!value) continue;

      // Extract aliases
      if (value.alias) {
        const list = typeof value.alias === 'string' ? [value.alias] : value.alias;
        for (const aliasKey of list) {
          if (typeof aliasKey === 'string' && aliasKey && aliasKey !== key) {
            aliases[aliasKey] = key;
          }
        }
      }
    }
  }

  // Extract from JSON schema properties
  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        if (!propertySchema) continue;

        // Extract aliases from schema
        const propAlias = propertySchema.alias;
        if (propAlias) {
          const list = typeof propAlias === 'string' ? [propAlias] : propAlias;
          if (Array.isArray(list)) {
            for (const aliasKey of list) {
              if (typeof aliasKey === 'string' && aliasKey && aliasKey !== propertyName && !(aliasKey in aliases)) {
                aliases[aliasKey] = propertyName;
              }
            }
          }
        }
      }
    }
  } catch {
    // Ignore errors from JSON schema generation
  }

  return { aliases };
}

function preprocessAliases(data: Record<string, unknown>, aliases: Record<string, string>): Record<string, unknown> {
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

interface ParseOptionsContext {
  aliases?: Record<string, string>;
  envData?: Record<string, unknown>;
  configData?: Record<string, unknown>;
}

/**
 * Apply values directly to options.
 * CLI values take precedence over the provided values.
 */
function applyValues(data: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };

  for (const [key, value] of Object.entries(values)) {
    // Only apply value if option wasn't already set
    if (key in result && result[key] !== undefined) continue;
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Combined preprocessing of options with all features.
 * Precedence order (highest to lowest): CLI args > env vars > config file
 */
export function preprocessOptions(data: Record<string, unknown>, ctx: ParseOptionsContext): Record<string, unknown> {
  let result = { ...data };

  // 1. Apply aliases first
  if (ctx.aliases && Object.keys(ctx.aliases).length > 0) {
    result = preprocessAliases(result, ctx.aliases);
  }

  // 2. Apply environment variables (higher precedence than config)
  // These only apply if CLI didn't set the option
  if (ctx.envData) {
    result = applyValues(result, ctx.envData);
  }

  // 3. Apply config file values (lowest precedence)
  // These only apply if neither CLI nor env set the option
  if (ctx.configData) {
    result = applyValues(result, ctx.configData);
  }

  return result;
}
