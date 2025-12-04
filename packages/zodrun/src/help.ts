import { toJSONSchema } from 'zod/v4';
import type z from 'zod/v4/core';
import { $ZodVoid } from 'zod/v4/core';
import { createColorizer } from './colorizer';
import { extractAliasesFromSchema } from './options';
import type { AnyZodrunCommand } from './types';

type ArgInfo = {
  name: string;
  description?: string;
  optional: boolean;
  default?: unknown;
  type?: string;
};

type OptionInfo = {
  name: string;
  description?: string;
  optional: boolean;
  default?: unknown;
  type?: string;
  enum?: string[];
  aliases?: string[];
};

function extractArgsInfo(argsSchema: z.$ZodType): ArgInfo[] {
  const result: ArgInfo[] = [];

  if (!argsSchema || argsSchema instanceof $ZodVoid) {
    return result;
  }

  try {
    const jsonSchema = toJSONSchema(argsSchema);

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

function extractOptionsInfo(optionsSchema: z.$ZodType): OptionInfo[] {
  const result: OptionInfo[] = [];

  if (!optionsSchema || optionsSchema instanceof $ZodVoid) {
    return result;
  }

  try {
    const jsonSchema = toJSONSchema(optionsSchema);

    // Handle object: z.object({ key: z.string(), ... })
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const properties = jsonSchema.properties as Record<string, any>;
      const required = (jsonSchema.required as string[]) || [];

      for (const [key, prop] of Object.entries(properties)) {
        const isOptional = !required.includes(key);
        const enumValues = prop.enum as string[] | undefined;

        result.push({
          name: key,
          description: prop.description,
          optional: isOptional,
          default: prop.default,
          type: prop.type as string,
          enum: enumValues,
        });
      }
    }
  } catch {
    // Fallback to empty result if toJSONSchema fails
  }

  return result;
}

export type HelpOptions = {
  colorize?: boolean | 'auto';
};

export function generateHelp(
  targetCommand: AnyZodrunCommand,
  findCommandByName: (name: string, commands?: AnyZodrunCommand[]) => AnyZodrunCommand | undefined,
  command?: string | AnyZodrunCommand,
  options?: HelpOptions,
): string {
  let cmd: AnyZodrunCommand | undefined;

  if (command) {
    if (typeof command === 'string') {
      cmd = findCommandByName(command, targetCommand.commands);
    } else {
      cmd = command;
    }
  } else {
    cmd = targetCommand;
  }

  if (!cmd) {
    return `Command "${command ?? ''}" not found`;
  }

  const colorize = createColorizer(options?.colorize);
  const lines: string[] = [];

  // Command name/usage
  const commandName = cmd.fullName || '<root>';
  const usageParts = [
    colorize.command(commandName),
    cmd.commands?.length ? colorize.meta('[command]') : '',
    cmd.args ? colorize.meta('[args...]') : '',
    cmd.options ? colorize.meta('[options]') : '',
  ]
    .filter(Boolean)
    .join(' ');
  lines.push(`Usage: ${usageParts}`);
  lines.push('');

  // Subcommands
  if (cmd.commands && cmd.commands.length > 0) {
    lines.push(colorize.label('Commands:'));
    const maxNameLength = Math.max(...cmd.commands.map((c) => c.name.length));
    for (const subCmd of cmd.commands) {
      const padding = ' '.repeat(Math.max(0, maxNameLength - subCmd.name.length + 2));
      lines.push(`  ${colorize.command(subCmd.name)}${padding}`);
    }
    lines.push('');
    lines.push(colorize.meta(`Run "${commandName} [command] --help" for more information on a command.`));
    lines.push('');
  }

  // Arguments
  if (cmd.args) {
    const argsInfo = extractArgsInfo(cmd.args);
    if (argsInfo.length > 0) {
      lines.push(colorize.label('Arguments:'));
      for (const arg of argsInfo) {
        const optional = arg.optional ? colorize.meta(' (optional)') : '';
        const defaultVal = arg.default !== undefined ? colorize.meta(` (default: ${String(arg.default)})`) : '';
        lines.push(`  ${colorize.option(arg.name)}${optional}${defaultVal}`);
        if (arg.description) {
          lines.push(`    ${colorize.description(arg.description)}`);
        }
      }
      lines.push('');
    }
  }

  // Options
  if (cmd.options) {
    const optionsInfo = extractOptionsInfo(cmd.options);
    const optMap: Record<string, OptionInfo> = Object.fromEntries(optionsInfo.map((opt) => [opt.name, opt]));

    const aliases = extractAliasesFromSchema(cmd.options);
    for (const [alias, name] of Object.entries(aliases)) {
      const opt = optMap[name];
      if (!opt) continue;
      opt.aliases = [...(opt.aliases || []), alias];
    }

    if (optionsInfo.length > 0) {
      lines.push(colorize.label('Options:'));
      const maxNameLength = Math.max(...optionsInfo.map((opt) => opt.name.length));
      for (const opt of optionsInfo) {
        const optionName = `--${opt.name}`;
        const aliasNames = opt.aliases && opt.aliases.length > 0 ? opt.aliases.map((a) => `-${a}`).join(', ') : '';
        const fullOptionName = aliasNames ? `${optionName}, ${aliasNames}` : optionName;
        const padding = ' '.repeat(Math.max(0, maxNameLength - opt.name.length + 2));
        const typeInfo = opt.type ? ` ${colorize.type(`<${opt.type}>`)}` : '';
        const optional = opt.optional ? colorize.meta(' (optional)') : '';
        const defaultVal = opt.default !== undefined ? colorize.meta(` (default: ${String(opt.default)})`) : '';
        const enumVals = opt.enum ? colorize.meta(` (choices: ${opt.enum.join(', ')})`) : '';
        const description = opt.description ? colorize.description(opt.description) : '';
        lines.push(`  ${colorize.option(fullOptionName)}${typeInfo}${optional}${defaultVal}${enumVals}${padding}${description}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
