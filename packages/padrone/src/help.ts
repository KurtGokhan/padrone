import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import { createFormatter, type HelpArgumentInfo, type HelpFormat, type HelpInfo, type HelpOptionInfo } from './formatters';
import { extractAliasesFromSchema, type PadroneOptionsMeta } from './options';
import type { AnyPadroneCommand } from './types';
import { getRootCommand } from './utils';

function extractArgsInfo(schema: StandardJSONSchemaV1) {
  const result: HelpArgumentInfo[] = [];
  if (!schema) return result;

  const vendor = schema['~standard'].vendor;
  if (!vendor.includes('zod')) return result;

  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;

    // Handle tuple: z.tuple([z.string(), z.number(), ...])
    if (jsonSchema.type === 'array' && Array.isArray(jsonSchema.items)) {
      jsonSchema.items.forEach((item: any, index: number) => {
        result.push({
          name: `arg${index + 1}`,
          description: item.description,
          optional: !jsonSchema.required || !jsonSchema.required.includes(`arg${index + 1}`),
          default: item.default,
          type: item.type,
        });
      });
      return result;
    }

    // Handle array: z.array(z.string())
    if (jsonSchema.type === 'array') {
      const items = jsonSchema.items as any;
      const minItems = jsonSchema.minItems;
      const maxItems = jsonSchema.maxItems;

      let name = 'args...';
      if (minItems !== undefined || maxItems !== undefined) {
        const min = minItems ?? 0;
        const max = maxItems ?? '∞';
        name = `args[${min}..${max}]`;
      }

      const elementType = items?.type || 'any';
      result.push({
        name,
        description: jsonSchema.description,
        optional: false,
        type: `array<${elementType}>`,
      });
      return result;
    }

    // Handle other types
    result.push({
      name: 'args',
      description: jsonSchema.description,
      optional: false,
      default: jsonSchema.default,
      type: jsonSchema.type as string,
    });
  } catch {
    // Fallback to empty result if toJSONSchema fails
  }

  return result;
}

function extractOptionsInfo(schema: StandardJSONSchemaV1, meta?: Record<string, PadroneOptionsMeta | undefined>) {
  const result: HelpOptionInfo[] = [];
  if (!schema) return result;

  const vendor = schema['~standard'].vendor;
  if (!vendor.includes('zod')) return result;

  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;

    // Handle object: z.object({ key: z.string(), ... })
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const properties = jsonSchema.properties as Record<string, any>;
      const required = (jsonSchema.required as string[]) || [];

      for (const [key, prop] of Object.entries(properties)) {
        const isOptional = !required.includes(key);
        const enumValues = prop.enum as string[] | undefined;
        const optMeta = meta?.[key];

        result.push({
          name: key,
          description: optMeta?.description ?? prop.description,
          optional: isOptional,
          default: prop.default,
          type: prop.type as string,
          enum: enumValues,
          deprecated: optMeta?.deprecated ?? prop?.deprecated,
          hidden: optMeta?.hidden ?? prop?.hidden,
          examples: optMeta?.examples ?? prop?.examples,
        });
      }
    }
  } catch {
    // Fallback to empty result if toJSONSchema fails
  }

  return result;
}

export type HelpOptions = {
  format?: HelpFormat | 'auto';
  /** Future: Control the level of detail in the output */
  detail?: 'minimal' | 'standard' | 'full';
};

// ============================================================================
// Core Help Info Builder
// ============================================================================

/**
 * Builds a comprehensive HelpInfo structure from a command.
 * This is the single source of truth that all formatters use.
 * @param cmd - The command to build help info for
 * @param detail - The level of detail ('minimal', 'standard', or 'full')
 */
function getHelpInfo(cmd: AnyPadroneCommand, detail: HelpOptions['detail'] = 'standard'): HelpInfo {
  const rootCmd = getRootCommand(cmd);
  const commandName = cmd.path || cmd.name || 'program';

  const helpInfo: HelpInfo = {
    name: commandName,
    description: cmd.description,
    usage: {
      command: rootCmd === cmd ? commandName : `${rootCmd.name} ${commandName}`,
      hasSubcommands: !!(cmd.commands && cmd.commands.length > 0),
      hasArguments: !!cmd.args,
      hasOptions: !!cmd.options,
    },
  };

  // Build subcommands info
  if (cmd.commands && cmd.commands.length > 0) {
    helpInfo.subcommands = cmd.commands.map((c) => ({
      name: c.name,
      description: c.description,
    }));

    // In 'full' detail mode, recursively build help for all nested commands
    if (detail === 'full') {
      helpInfo.nestedCommands = cmd.commands.map((c) => getHelpInfo(c, 'full'));
    }
  }

  // Build arguments info
  if (cmd.args) {
    const argsInfo = extractArgsInfo(cmd.args);
    if (argsInfo.length > 0) {
      helpInfo.arguments = argsInfo;
    }
  }

  // Build options info with aliases
  if (cmd.options) {
    const optionsInfo = extractOptionsInfo(cmd.options, cmd.meta);
    const optMap: Record<string, HelpOptionInfo> = Object.fromEntries(optionsInfo.map((opt) => [opt.name, opt]));

    // Merge aliases into options
    const aliases = extractAliasesFromSchema(cmd.options, cmd.meta);
    for (const [alias, name] of Object.entries(aliases)) {
      const opt = optMap[name];
      if (!opt) continue;
      opt.aliases = [...(opt.aliases || []), alias];
    }

    // Filter out hidden options
    const visibleOptions = optionsInfo.filter((opt) => !opt.hidden);
    if (visibleOptions.length > 0) {
      helpInfo.options = visibleOptions;
    }
  }

  return helpInfo;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export function generateHelp(rootCommand: AnyPadroneCommand, commandObj: AnyPadroneCommand = rootCommand, options?: HelpOptions): string {
  const helpInfo = getHelpInfo(commandObj, options?.detail);
  const formatter = createFormatter(options?.format ?? 'auto', options?.detail);
  return formatter.format(helpInfo);
}
