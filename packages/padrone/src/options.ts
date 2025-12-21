import type { StandardJSONSchemaV1 } from '@standard-schema/spec';

export interface PadroneOptionsMeta {
  description?: string;
  alias?: string[] | string;
  deprecated?: boolean | string;
  hidden?: boolean;
  examples?: unknown[];
  /**
   * Allow the option to be specified multiple times.
   * Values will be collected into an array.
   */
  variadic?: boolean;
  /**
   * Environment variable name(s) to bind this option to.
   * Can be a single string or array of env var names (checked in order).
   */
  env?: string | string[];
  /**
   * Allow the option to be negated with --no-<option>.
   * When negated, the value will be set to false.
   */
  negatable?: boolean;
  /**
   * Key path in config file that maps to this option.
   * Supports dot notation for nested keys (e.g., 'server.port').
   */
  configKey?: string;
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
export interface SchemaMetadataResult {
  aliases: Record<string, string>;
  variadicOptions: Set<string>;
  negatableOptions: Set<string>;
  envBindings: Record<string, string[]>;
  configKeys: Record<string, string>;
}

/**
 * Extract all option metadata from schema and meta in a single pass.
 * This consolidates aliases, variadic, negatable, env bindings, and config keys extraction.
 */
export function extractSchemaMetadata(
  schema: StandardJSONSchemaV1,
  meta?: Record<string, PadroneOptionsMeta | undefined>,
): SchemaMetadataResult {
  const aliases: Record<string, string> = {};
  const variadicOptions = new Set<string>();
  const negatableOptions = new Set<string>();
  const envBindings: Record<string, string[]> = {};
  const configKeys: Record<string, string> = {};

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

      // Extract variadic
      if (value.variadic) variadicOptions.add(key);

      // Extract negatable
      if (value.negatable) negatableOptions.add(key);

      // Extract env bindings
      if (value.env) {
        envBindings[key] = typeof value.env === 'string' ? [value.env] : value.env;
      }

      // Extract config keys
      if (value.configKey) {
        configKeys[key] = value.configKey;
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

        // Extract variadic from schema
        if (propertySchema.variadic && !variadicOptions.has(propertyName)) {
          variadicOptions.add(propertyName);
        }

        // Extract negatable from schema
        if (propertySchema.negatable && !negatableOptions.has(propertyName)) {
          negatableOptions.add(propertyName);
        }

        // Extract env bindings from schema
        if (propertySchema.env && !(propertyName in envBindings)) {
          const envVars = typeof propertySchema.env === 'string' ? [propertySchema.env] : propertySchema.env;
          if (Array.isArray(envVars)) {
            envBindings[propertyName] = envVars;
          }
        }

        // Extract config keys from schema
        if (propertySchema.configKey && !(propertyName in configKeys)) {
          configKeys[propertyName] = propertySchema.configKey;
        }
      }
    }
  } catch {
    // Ignore errors from JSON schema generation
  }

  return { aliases, variadicOptions, negatableOptions, envBindings, configKeys };
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

/**
 * Apply environment variable values to options.
 * CLI values take precedence over environment variables.
 */
function applyEnvBindings(
  data: Record<string, unknown>,
  envBindings: Record<string, string[]>,
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): Record<string, unknown> {
  const result = { ...data };

  for (const [optionName, envVars] of Object.entries(envBindings)) {
    // Only apply env var if option wasn't already set
    if (optionName in result && result[optionName] !== undefined) continue;

    for (const envVar of envVars) {
      const envValue = env[envVar];
      if (envValue !== undefined) {
        // Try to parse the value intelligently
        result[optionName] = parseEnvValue(envValue);
        break;
      }
    }
  }

  return result;
}

/**
 * Parse an environment variable value, attempting to convert to appropriate types.
 */
function parseEnvValue(value: string): unknown {
  // Handle boolean-like values
  const lowerValue = value.toLowerCase();
  if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') return true;
  if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no') return false;

  // Handle numeric values
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);

  // Handle arrays (comma-separated)
  if (value.includes(',')) {
    return value.split(',').map((v) => parseEnvValue(v.trim()));
  }

  return value;
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Apply config file values to options.
 * CLI values and env values take precedence over config file values.
 */
function applyConfigValues(
  data: Record<string, unknown>,
  configKeys: Record<string, string>,
  configData: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...data };

  for (const [optionName, configKey] of Object.entries(configKeys)) {
    // Only apply config value if option wasn't already set
    if (optionName in result && result[optionName] !== undefined) continue;

    const configValue = getNestedValue(configData, configKey);
    if (configValue !== undefined) {
      result[optionName] = configValue;
    }
  }

  return result;
}

export interface ParseOptionsContext {
  aliases?: Record<string, string>;
  variadicOptions?: Set<string>;
  negatableOptions?: Set<string>;
  envBindings?: Record<string, string[]>;
  configKeys?: Record<string, string>;
  configData?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
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
  if (ctx.envBindings && Object.keys(ctx.envBindings).length > 0) {
    result = applyEnvBindings(result, ctx.envBindings, ctx.env);
  }

  // 3. Apply config file values (lowest precedence)
  // These only apply if neither CLI nor env set the option
  if (ctx.configKeys && ctx.configData) {
    result = applyConfigValues(result, ctx.configKeys, ctx.configData);
  }

  return result;
}
