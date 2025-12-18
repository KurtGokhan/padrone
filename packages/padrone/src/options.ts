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

/**
 * Extract variadic option names from schema and meta.
 */
export function extractVariadicFromSchema(
  schema: StandardJSONSchemaV1,
  meta?: Record<string, PadroneOptionsMeta | undefined>,
): Set<string> {
  const variadicOptions = new Set<string>();

  // Extract from meta object
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (value?.variadic) variadicOptions.add(key);
    }
  }

  // Extract from JSON schema properties
  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        if (propertySchema?.variadic && !variadicOptions.has(propertyName)) {
          variadicOptions.add(propertyName);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return variadicOptions;
}

/**
 * Extract negatable option names from schema and meta.
 */
export function extractNegatableFromSchema(
  schema: StandardJSONSchemaV1,
  meta?: Record<string, PadroneOptionsMeta | undefined>,
): Set<string> {
  const negatableOptions = new Set<string>();

  // Extract from meta object
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (value?.negatable) negatableOptions.add(key);
    }
  }

  // Extract from JSON schema properties
  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        if (propertySchema?.negatable && !negatableOptions.has(propertyName)) {
          negatableOptions.add(propertyName);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return negatableOptions;
}

/**
 * Extract environment variable bindings from schema and meta.
 */
export function extractEnvBindingsFromSchema(
  schema: StandardJSONSchemaV1,
  meta?: Record<string, PadroneOptionsMeta | undefined>,
): Record<string, string[]> {
  const envBindings: Record<string, string[]> = {};

  // Extract from meta object
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (value?.env) {
        const envVars = typeof value.env === 'string' ? [value.env] : value.env;
        envBindings[key] = envVars;
      }
    }
  }

  // Extract from JSON schema properties
  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        if (propertySchema?.env && !(propertyName in envBindings)) {
          const envVars = typeof propertySchema.env === 'string' ? [propertySchema.env] : propertySchema.env;
          if (Array.isArray(envVars)) {
            envBindings[propertyName] = envVars;
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return envBindings;
}

/**
 * Extract config key mappings from schema and meta.
 */
export function extractConfigKeysFromSchema(
  schema: StandardJSONSchemaV1,
  meta?: Record<string, PadroneOptionsMeta | undefined>,
): Record<string, string> {
  const configKeys: Record<string, string> = {};

  // Extract from meta object
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (value?.configKey) {
        configKeys[key] = value.configKey;
      }
    }
  }

  // Extract from JSON schema properties
  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        if (propertySchema?.configKey && !(propertyName in configKeys)) {
          configKeys[propertyName] = propertySchema.configKey;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return configKeys;
}

/**
 * Apply environment variable values to options.
 * CLI values take precedence over environment variables.
 */
export function applyEnvBindings(
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
export function applyConfigValues(
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
 * Process variadic options by collecting multiple values into arrays.
 */
export function processVariadicOptions(data: Record<string, unknown>, _variadicOptions: Set<string>): Record<string, unknown> {
  // Values are already accumulated during parsing - this ensures the final structure
  return data;
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
