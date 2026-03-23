import { JSON_SCHEMA_OPTS } from './args.ts';
import type { InteractivePromptConfig, ResolvedPadroneRuntime } from './runtime.ts';
import type { AnyPadroneCommand } from './types.ts';

/**
 * Auto-detect the prompt type for a field based on its JSON schema property definition.
 */
export function detectPromptConfig(
  name: string,
  propSchema: Record<string, any> | undefined,
  description?: string,
): InteractivePromptConfig {
  const message = description || propSchema?.description || name;

  if (!propSchema) return { name, message, type: 'input' };

  if (propSchema.type === 'boolean') {
    return { name, message, type: 'confirm', default: propSchema.default };
  }

  if (propSchema.enum) {
    return {
      name,
      message,
      type: 'select',
      choices: propSchema.enum.map((v: unknown) => ({ label: String(v), value: v })),
      default: propSchema.default,
    };
  }

  if (propSchema.type === 'array' && propSchema.items?.enum) {
    return {
      name,
      message,
      type: 'multiselect',
      choices: propSchema.items.enum.map((v: unknown) => ({ label: String(v), value: v })),
      default: propSchema.default,
    };
  }

  if (propSchema.format === 'password') {
    return { name, message, type: 'password', default: propSchema.default };
  }

  return { name, message, type: 'input', default: propSchema.default };
}

/**
 * Prompt a single field and validate it against the command's schema.
 * Re-prompts with a warning until the user provides a valid value.
 */
async function promptWithValidation(
  field: string,
  config: InteractivePromptConfig,
  currentData: Record<string, unknown>,
  command: AnyPadroneCommand,
  runtime: ResolvedPadroneRuntime,
): Promise<unknown> {
  let promptConfig = config;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await runtime.prompt!(promptConfig);

    if (!command.argsSchema) return value;

    // Validate the full object with the new value to catch field-level issues
    const testData = { ...currentData, [field]: value };
    const validated = await command.argsSchema['~standard'].validate(testData);

    if (!validated.issues) return value;

    // Only keep issues whose path starts with this field
    const fieldIssues = validated.issues.filter((issue: { path?: ReadonlyArray<PropertyKey> }) => {
      const rootKey = issue.path?.[0];
      return rootKey !== undefined && String(rootKey) === field;
    });

    if (fieldIssues.length === 0) return value;

    // Warn the user and re-prompt with the invalid value as default
    const messages = fieldIssues.map((i: { message: string }) => i.message).join('; ');
    runtime.error(`Invalid value for "${field}": ${messages}`);
    promptConfig = { ...config, default: value };
  }
}

/**
 * Prompt for missing interactive fields.
 * Runs after env/config preprocessing and before schema validation.
 *
 * When `force` is true, all configured interactive fields are prompted even if they already
 * have values. The current values are used as defaults in the prompts.
 */
export async function promptInteractiveFields(
  data: Record<string, unknown>,
  command: AnyPadroneCommand,
  runtime: ResolvedPadroneRuntime,
  force?: boolean,
): Promise<Record<string, unknown>> {
  if (!runtime.prompt) return data;

  const meta = command.meta;
  const interactiveConfig = meta?.interactive;
  const optionalInteractiveConfig = meta?.optionalInteractive;
  if (!interactiveConfig && !optionalInteractiveConfig) return data;

  // Extract JSON schema properties for prompt type detection
  let jsonProperties: Record<string, any> = {};
  let requiredFields: Set<string> = new Set();
  if (command.argsSchema) {
    try {
      const jsonSchema = command.argsSchema['~standard'].jsonSchema.input(JSON_SCHEMA_OPTS) as Record<string, any>;
      if (jsonSchema.type === 'object' && jsonSchema.properties) {
        jsonProperties = jsonSchema.properties;
      }
      if (Array.isArray(jsonSchema.required)) {
        requiredFields = new Set(jsonSchema.required);
      }
    } catch {
      // Ignore schema parsing errors
    }
  }

  const fieldDescriptions: Record<string, string | undefined> = {};
  if (meta?.fields) {
    for (const [key, value] of Object.entries(meta.fields)) {
      if (value?.description) fieldDescriptions[key] = value.description;
    }
  }

  const result = { ...data };

  // Determine which required interactive fields to prompt
  let fieldsToPrompt: string[] = [];
  if (interactiveConfig === true) {
    if (force) {
      // When forced, prompt all required fields regardless of current value
      fieldsToPrompt = [...requiredFields];
    } else {
      // All required fields that are missing
      fieldsToPrompt = [...requiredFields].filter((name) => result[name] === undefined);
    }
  } else if (Array.isArray(interactiveConfig)) {
    if (force) {
      fieldsToPrompt = [...interactiveConfig];
    } else {
      fieldsToPrompt = interactiveConfig.filter((name) => result[name] === undefined);
    }
  }

  // Prompt each required interactive field with per-field validation
  for (const field of fieldsToPrompt) {
    const config = detectPromptConfig(field, jsonProperties[field], fieldDescriptions[field]);
    // When forced, use the current value as the default
    if (force && result[field] !== undefined) {
      config.default = result[field];
    }
    result[field] = await promptWithValidation(field, config, result, command, runtime);
  }

  // Determine optional interactive fields
  let optionalFields: string[] = [];
  if (optionalInteractiveConfig === true) {
    if (force) {
      // When forced, include all non-required fields (even those with values)
      const allKeys = Object.keys(jsonProperties);
      optionalFields = allKeys.filter((name) => !requiredFields.has(name));
    } else {
      // All non-required fields that are still missing
      const allKeys = Object.keys(jsonProperties);
      optionalFields = allKeys.filter((name) => !requiredFields.has(name) && result[name] === undefined);
    }
  } else if (Array.isArray(optionalInteractiveConfig)) {
    if (force) {
      optionalFields = [...optionalInteractiveConfig];
    } else {
      optionalFields = optionalInteractiveConfig.filter((name) => result[name] === undefined);
    }
  }

  // Show multiselect for optional fields, then prompt selected ones
  if (optionalFields.length > 0) {
    const selected = (await runtime.prompt({
      name: '_optionalFields',
      message: 'Would you also like to configure:',
      type: 'multiselect',
      choices: optionalFields.map((f) => {
        const label = fieldDescriptions[f] || jsonProperties[f]?.description || f;
        const currentValue = result[f];
        // When forced, show current value next to the label for fields that already have values
        const displayLabel = force && currentValue !== undefined ? `${label} (current: ${currentValue})` : label;
        return { label: displayLabel, value: f };
      }),
    })) as string[];

    if (Array.isArray(selected)) {
      for (const field of selected) {
        const config = detectPromptConfig(field, jsonProperties[field], fieldDescriptions[field]);
        // When forced, use the current value as the default
        if (force && result[field] !== undefined) {
          config.default = result[field];
        }
        result[field] = await promptWithValidation(field, config, result, command, runtime);
      }
    }
  }

  return result;
}
