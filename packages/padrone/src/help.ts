import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import {
  createFormatter,
  type HelpArgumentInfo,
  type HelpDetail,
  type HelpFormat,
  type HelpInfo,
  type HelpOptionInfo,
} from './formatter.ts';
import { extractSchemaMetadata, type PadroneMeta, parsePositionalConfig } from './options.ts';
import type { AnyPadroneCommand } from './types.ts';
import { getRootCommand } from './utils.ts';

export type HelpOptions = {
  format?: HelpFormat | 'auto';
  detail?: HelpDetail;
};

/**
 * Extract positional arguments info from schema based on meta.positional config.
 */
function extractPositionalArgsInfo(
  schema: StandardJSONSchemaV1,
  meta?: PadroneMeta,
): { args: HelpArgumentInfo[]; positionalNames: Set<string> } {
  const args: HelpArgumentInfo[] = [];
  const positionalNames = new Set<string>();

  if (!schema || !meta?.positional || meta.positional.length === 0) {
    return { args, positionalNames };
  }

  const positionalConfig = parsePositionalConfig(meta.positional);

  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;

    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const properties = jsonSchema.properties as Record<string, any>;
      const required = (jsonSchema.required as string[]) || [];

      for (const { name, variadic } of positionalConfig) {
        const prop = properties[name];
        if (!prop) continue;

        positionalNames.add(name);
        const optMeta = meta.options?.[name];

        args.push({
          name: variadic ? `...${name}` : name,
          description: optMeta?.description ?? prop.description,
          optional: !required.includes(name),
          default: prop.default,
          type: variadic ? `array<${prop.items?.type || 'string'}>` : prop.type,
        });
      }
    }
  } catch {
    // Fallback to empty result if toJSONSchema fails
  }

  return { args, positionalNames };
}

function extractOptionsInfo(schema: StandardJSONSchemaV1, meta?: PadroneMeta, positionalNames?: Set<string>) {
  const result: HelpOptionInfo[] = [];
  if (!schema) return result;

  const vendor = schema['~standard'].vendor;
  if (!vendor.includes('zod')) return result;

  const optionsMeta = meta?.options;

  try {
    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;

    // Handle object: z.object({ key: z.string(), ... })
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const properties = jsonSchema.properties as Record<string, any>;
      const required = (jsonSchema.required as string[]) || [];
      const propertyNames = new Set(Object.keys(properties));

      // Helper to check if a negated version of an option exists
      const hasExplicitNegation = (key: string): boolean => {
        // Check for noVerbose style (camelCase)
        const camelNegated = `no${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        if (propertyNames.has(camelNegated)) return true;
        // Check for no-verbose style (kebab-case, though rare in JS)
        const kebabNegated = `no-${key}`;
        if (propertyNames.has(kebabNegated)) return true;
        return false;
      };

      // Helper to check if this option is itself a negation of another option
      const isNegationOf = (key: string): boolean => {
        // Check for noVerbose -> verbose (camelCase)
        if (key.startsWith('no') && key.length > 2 && key[2] === key[2]?.toUpperCase()) {
          const positiveKey = key.charAt(2).toLowerCase() + key.slice(3);
          if (propertyNames.has(positiveKey)) return true;
        }
        // Check for no-verbose -> verbose (kebab-case)
        if (key.startsWith('no-')) {
          const positiveKey = key.slice(3);
          if (propertyNames.has(positiveKey)) return true;
        }
        return false;
      };

      for (const [key, prop] of Object.entries(properties)) {
        // Skip positional arguments - they are shown in arguments section
        if (positionalNames?.has(key)) continue;

        const isOptional = !required.includes(key);
        const enumValues = prop.enum as string[] | undefined;
        const optMeta = optionsMeta?.[key];
        const propType = prop.type as string;

        // Booleans are negatable unless there's an explicit noOption property
        // or this option is itself a negation of another option
        const isNegatable = propType === 'boolean' && !hasExplicitNegation(key) && !isNegationOf(key);

        result.push({
          name: key,
          description: optMeta?.description ?? prop.description,
          optional: isOptional,
          default: prop.default,
          type: propType,
          enum: enumValues,
          deprecated: optMeta?.deprecated ?? prop?.deprecated,
          hidden: optMeta?.hidden ?? prop?.hidden,
          examples: optMeta?.examples ?? prop?.examples,
          variadic: propType === 'array', // Arrays are always variadic
          negatable: isNegatable,
        });
      }
    }
  } catch {
    // Fallback to empty result if toJSONSchema fails
  }

  return result;
}

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

  // Extract positional args from options schema based on meta.positional
  const { args: positionalArgs, positionalNames } = cmd.options
    ? extractPositionalArgsInfo(cmd.options, cmd.meta)
    : { args: [], positionalNames: new Set<string>() };

  const hasArguments = positionalArgs.length > 0;

  const helpInfo: HelpInfo = {
    name: commandName,
    title: cmd.title,
    description: cmd.description,
    aliases: cmd.aliases,
    deprecated: cmd.deprecated,
    hidden: cmd.hidden,
    usage: {
      command: rootCmd === cmd ? commandName : `${rootCmd.name} ${commandName}`,
      hasSubcommands: !!(cmd.commands && cmd.commands.length > 0),
      hasArguments,
      hasOptions: !!cmd.options,
    },
  };

  // Build subcommands info (filter out hidden commands unless showing full detail)
  if (cmd.commands && cmd.commands.length > 0) {
    const visibleCommands = detail === 'full' ? cmd.commands : cmd.commands.filter((c) => !c.hidden);
    helpInfo.subcommands = visibleCommands.map((c) => {
      return {
        name: c.name,
        title: c.title,
        description: c.description,
        aliases: c.aliases,
        deprecated: c.deprecated,
        hidden: c.hidden,
      };
    });

    // In 'full' detail mode, recursively build help for all nested commands
    if (detail === 'full') {
      helpInfo.nestedCommands = visibleCommands.map((c) => getHelpInfo(c, 'full'));
    }
  }

  // Build arguments info from positional options
  if (hasArguments) {
    helpInfo.arguments = positionalArgs;
  }

  // Build options info with aliases (excluding positional args)
  if (cmd.options) {
    const optionsInfo = extractOptionsInfo(cmd.options, cmd.meta, positionalNames);
    const optMap: Record<string, HelpOptionInfo> = Object.fromEntries(optionsInfo.map((opt) => [opt.name, opt]));

    // Merge aliases into options
    const { aliases } = extractSchemaMetadata(cmd.options, cmd.meta?.options);
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
