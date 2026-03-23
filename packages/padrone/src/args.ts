import type { StandardJSONSchemaV1 } from '@standard-schema/spec';

type Letter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';

/** A single letter character, valid as a short CLI flag (e.g. `'v'`, `'n'`, `'V'`). */
export type SingleChar = Letter | Uppercase<Letter>;

export interface PadroneFieldMeta {
  description?: string;
  /** Single-character short flags (stackable: `-abc` = `-a -b -c`). Used with single dash. */
  flags?: readonly SingleChar[] | SingleChar;
  /** Multi-character alternative long names. Used with double dash (e.g. `--dry-run` for `--dryRun`). */
  alias?: readonly string[] | string;
  deprecated?: boolean | string;
  hidden?: boolean;
  examples?: readonly unknown[];
  /** Group name for organizing this option under a labeled section in help output. */
  group?: string;
}

type PositionalArgs<TObj> =
  TObj extends Record<string, any>
    ? {
        [K in keyof TObj]: NonNullable<TObj[K]> extends Array<any> ? `...${K & string}` | (K & string) : K & string;
      }[keyof TObj]
    : string;

/**
 * Meta configuration for arguments, including positional arguments.
 * The `positional` array defines which arguments are positional and their order.
 * Use '...name' prefix to indicate variadic (rest) arguments, matching JS/TS rest syntax.
 *
 * @example
 * ```ts
 * .arguments(schema, {
 *   positional: ['source', '...files', 'dest'],  // '...files' is variadic
 * })
 * ```
 */
/**
 * Configuration for reading from stdin and mapping it to an argument field.
 * Simply specify the field name — the read mode is inferred from the schema:
 * - `string` field → reads all stdin as text
 * - `string[]` field → reads stdin line-by-line
 */
export type StdinConfig<TObj = Record<string, any>> = keyof TObj & string;

export interface PadroneArgsSchemaMeta<TObj = Record<string, any>> {
  /**
   * Array of argument names that should be treated as positional arguments.
   * Order in array determines position. Use '...name' prefix for variadic args.
   * @example ['source', '...files', 'dest'] - 'files' captures multiple values
   */
  positional?: readonly PositionalArgs<TObj>[];
  /**
   * Per-argument metadata.
   */
  fields?: { [K in keyof TObj]?: PadroneFieldMeta };
  /**
   * Automatically generate kebab-case aliases for camelCase option names.
   * For example, `dryRun` automatically gets `--dry-run` as an alias.
   * Defaults to `true`. Set to `false` to disable.
   *
   * @default true
   * @example
   * ```ts
   * // Auto-aliases enabled (default): --dry-run → dryRun
   * .arguments(z.object({ dryRun: z.boolean() }))
   *
   * // Disable auto-aliases
   * .arguments(z.object({ dryRun: z.boolean() }), { autoAlias: false })
   * ```
   */
  autoAlias?: boolean;
  /**
   * Read from stdin and inject the data into the specified argument field.
   * Only reads when stdin is piped (not a TTY) and the field wasn't already provided via CLI flags.
   *
   * The read mode is inferred from the schema type of the target field:
   * - `string` field → reads all stdin as a single string
   * - `string[]` field → reads stdin line-by-line into an array
   *
   * Precedence: CLI flags > stdin > env vars > config file > schema defaults.
   *
   * @example
   * ```ts
   * // Read all stdin as text into 'data' field
   * .arguments(z.object({ data: z.string() }), { stdin: 'data' })
   *
   * // Read stdin lines into 'lines' field (inferred from array schema)
   * .arguments(z.object({ lines: z.string().array() }), { stdin: 'lines' })
   * ```
   */
  stdin?: StdinConfig<TObj>;
  /**
   * Fields to interactively prompt for when their values are missing after CLI/env/config resolution.
   * - `true`: prompt for all required fields that are missing.
   * - `string[]`: prompt for these specific fields if missing.
   *
   * Interactive prompting only occurs in `cli()` when the runtime has `interactive: true`.
   * Setting this makes `parse()` and `cli()` return Promises.
   *
   * @example
   * ```ts
   * .arguments(schema, {
   *   interactive: true,                        // prompt all missing required fields
   *   interactive: ['name', 'template'],         // prompt only these fields
   * })
   * ```
   */
  interactive?: true | readonly (keyof TObj & string)[];
  /**
   * Optional fields offered after required interactive prompts.
   * Users are shown a multi-select to choose which of these fields to configure.
   * - `true`: offer all optional fields that are missing.
   * - `string[]`: offer these specific fields.
   *
   * @example
   * ```ts
   * .arguments(schema, {
   *   interactive: ['name'],
   *   optionalInteractive: ['typescript', 'eslint', 'prettier'],
   * })
   * ```
   */
  optionalInteractive?: true | readonly (keyof TObj & string)[];
}

/**
 * Convert a camelCase string to kebab-case.
 * Returns null if the string has no uppercase letters (no conversion needed).
 */
export function camelToKebab(str: string): string | null {
  if (!/[A-Z]/.test(str)) return null;
  return str.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/**
 * Returns the stdin field name from the config.
 */
export function parseStdinConfig(stdin: StdinConfig): string {
  return stdin;
}

/**
 * Checks if a field in the schema is an array type (e.g. `z.string().array()`).
 */
export function isArrayField(schema: StandardJSONSchemaV1 | undefined, field: string): boolean {
  if (!schema) return false;
  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const prop = jsonSchema.properties[field];
      return prop?.type === 'array';
    }
  } catch {}
  return false;
}

/**
 * Parse positional configuration to extract names and variadic info.
 */
export function parsePositionalConfig(positional: readonly string[]): { name: string; variadic: boolean }[] {
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
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
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

interface ParseArgsContext {
  flags?: Record<string, string>;
  aliases?: Record<string, string>;
  stdinData?: Record<string, unknown>;
  envData?: Record<string, unknown>;
  configData?: Record<string, unknown>;
}

/**
 * Apply values directly to arguments.
 * CLI values take precedence over the provided values.
 */
function applyValues(data: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };

  for (const [key, value] of Object.entries(values)) {
    // Only apply value if arg wasn't already set
    if (key in result && result[key] !== undefined) continue;
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Combined preprocessing of arguments with all features.
 * Precedence order (highest to lowest): CLI args > stdin > env vars > config file
 */
export function preprocessArgs(data: Record<string, unknown>, ctx: ParseArgsContext): Record<string, unknown> {
  let result = { ...data };

  // 1. Apply flags and aliases first
  if (ctx.flags && Object.keys(ctx.flags).length > 0) {
    result = preprocessMappings(result, ctx.flags);
  }
  if (ctx.aliases && Object.keys(ctx.aliases).length > 0) {
    result = preprocessMappings(result, ctx.aliases);
  }

  // 2. Apply stdin data (higher precedence than env)
  // Only applies if CLI didn't set the arg
  if (ctx.stdinData) {
    result = applyValues(result, ctx.stdinData);
  }

  // 3. Apply environment variables (higher precedence than config)
  // These only apply if CLI/stdin didn't set the arg
  if (ctx.envData) {
    result = applyValues(result, ctx.envData);
  }

  // 4. Apply config file values (lowest precedence)
  // These only apply if neither CLI, stdin, nor env set the arg
  if (ctx.configData) {
    result = applyValues(result, ctx.configData);
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
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
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

/** Keys consumed by the CLI framework that are not user-defined args. */
const frameworkReservedKeys = new Set(['config', 'c']);

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
  suggestFn: (input: string, candidates: string[]) => string,
): { key: string; suggestion: string }[] {
  let properties: Record<string, any>;
  let isLoose = false;
  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
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
  const unknowns: { key: string; suggestion: string }[] = [];

  for (const key of Object.keys(data)) {
    if (!knownKeys.has(key) && !frameworkReservedKeys.has(key)) {
      const suggestion = suggestFn(key, propertyNames);
      unknowns.push({ key, suggestion });
    }
  }

  return unknowns;
}
