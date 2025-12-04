import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createColorizer } from './colorizer';
import { extractAliasesFromSchema, type ZodrunOptionsMeta } from './options';
import type { AnyZodrunCommand } from './types';

export type HelpFormat = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json';

type Formatter = {
  command: (text: string) => string;
  option: (text: string) => string;
  type: (text: string) => string;
  description: (text: string) => string;
  label: (text: string) => string;
  meta: (text: string) => string;
  example: (text: string) => string;
  exampleValue: (text: string) => string;
  deprecated: (text: string) => string;
  newline: () => string;
  join: (parts: string[]) => string;
};

function createTextFormatter(): Formatter {
  return {
    command: (text) => text,
    option: (text) => text,
    type: (text) => text,
    description: (text) => text,
    label: (text) => text,
    meta: (text) => text,
    example: (text) => text,
    exampleValue: (text) => text,
    deprecated: (text) => text,
    newline: () => '\n',
    join: (parts) => parts.filter(Boolean).join(' '),
  };
}

function createAnsiFormatter(): Formatter {
  const colorizer = createColorizer();
  return {
    command: colorizer.command,
    option: colorizer.option,
    type: colorizer.type,
    description: colorizer.description,
    label: colorizer.label,
    meta: colorizer.meta,
    example: colorizer.example,
    exampleValue: colorizer.exampleValue,
    deprecated: colorizer.deprecated,
    newline: () => '\n',
    join: (parts) => parts.filter(Boolean).join(' '),
  };
}

function createConsoleFormatter(): Formatter {
  const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    strikethrough: '\x1b[9m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    gray: '\x1b[90m',
  };
  return {
    command: (text) => `${colors.cyan}${colors.bold}${text}${colors.reset}`,
    option: (text) => `${colors.green}${text}${colors.reset}`,
    type: (text) => `${colors.yellow}${text}${colors.reset}`,
    description: (text) => `${colors.dim}${text}${colors.reset}`,
    label: (text) => `${colors.bold}${text}${colors.reset}`,
    meta: (text) => `${colors.gray}${text}${colors.reset}`,
    example: (text) => `${colors.underline}${text}${colors.reset}`,
    exampleValue: (text) => `${colors.italic}${text}${colors.reset}`,
    deprecated: (text) => `${colors.strikethrough}${colors.gray}${text}${colors.reset}`,
    newline: () => '\n',
    join: (parts) => parts.filter(Boolean).join(' '),
  };
}

function createMarkdownFormatter(): Formatter {
  return {
    command: (text) => `**${text}**`,
    option: (text) => `\`${text}\``,
    type: (text) => `\`${text}\``,
    description: (text) => text,
    label: (text) => `### ${text}`,
    meta: (text) => `*${text}*`,
    example: (text) => `**${text}**`,
    exampleValue: (text) => `\`${text}\``,
    deprecated: (text) => `~~${text}~~`,
    newline: () => '\n',
    join: (parts) => parts.filter(Boolean).join(' '),
  };
}

function createHtmlFormatter(): Formatter {
  return {
    command: (text) => `<strong style="color: #00bcd4;">${escapeHtml(text)}</strong>`,
    option: (text) => `<code style="color: #4caf50;">${escapeHtml(text)}</code>`,
    type: (text) => `<code style="color: #ff9800;">${escapeHtml(text)}</code>`,
    description: (text) => `<span style="color: #666;">${escapeHtml(text)}</span>`,
    label: (text) => `<h3>${escapeHtml(text)}</h3>`,
    meta: (text) => `<span style="color: #999;">${escapeHtml(text)}</span>`,
    example: (text) => `<strong style="text-decoration: underline;">${escapeHtml(text)}</strong>`,
    exampleValue: (text) => `<em>${escapeHtml(text)}</em>`,
    deprecated: (text) => `<del style="color: #999;">${escapeHtml(text)}</del>`,
    newline: () => '<br>',
    join: (parts) => parts.filter(Boolean).join(' '),
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function shouldUseAnsi(): boolean {
  if (typeof process === 'undefined') return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.CI) return false;
  if (process.stdout && typeof process.stdout.isTTY === 'boolean') return process.stdout.isTTY;
  return false;
}

function createFormatter(format: HelpFormat | 'auto'): Formatter {
  if (format === 'ansi' || (format === 'auto' && shouldUseAnsi())) return createAnsiFormatter();
  if (format === 'console') return createConsoleFormatter();
  if (format === 'markdown') return createMarkdownFormatter();
  if (format === 'html') return createHtmlFormatter();
  return createTextFormatter();
}

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
  deprecated?: boolean | string;
  hidden?: boolean;
  examples?: unknown[];
};

async function extractArgsInfo(argsSchema: StandardSchemaV1) {
  const result: ArgInfo[] = [];
  if (!argsSchema) return result;

  try {
    const { toJSONSchema, $ZodType } = (await import('zod/v4/core').catch(() => null!)) || {};
    if (!$ZodType || !(argsSchema instanceof $ZodType)) return result;
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

async function extractOptionsInfo(optionsSchema: StandardSchemaV1, meta?: Record<string, ZodrunOptionsMeta | undefined>) {
  const result: OptionInfo[] = [];
  if (!optionsSchema) return result;

  try {
    const { toJSONSchema, $ZodType } = (await import('zod/v4/core').catch(() => null!)) || {};
    if (!$ZodType || !(optionsSchema instanceof $ZodType)) return result;
    const jsonSchema = toJSONSchema(optionsSchema);

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
  colorize?: boolean | 'auto';
  format?: HelpFormat | 'auto';
};

async function generateJsonHelp(cmd: AnyZodrunCommand): Promise<string> {
  const commandName = cmd.fullName || '<root>';
  const usageParts: string[] = [commandName];
  if (cmd.commands?.length) usageParts.push('[command]');
  if (cmd.args) usageParts.push('[args...]');
  if (cmd.options) usageParts.push('[options]');

  const json: {
    name: string;
    usage: string;
    commands?: Array<{ name: string }>;
    arguments?: Array<{
      name: string;
      description?: string;
      optional: boolean;
      default?: unknown;
      type?: string;
    }>;
    options?: Array<{
      name: string;
      aliases?: string[];
      description?: string;
      optional: boolean;
      default?: unknown;
      type?: string;
      enum?: string[];
      deprecated?: boolean | string;
      examples?: unknown[];
    }>;
  } = {
    name: commandName,
    usage: usageParts.join(' '),
  };

  if (cmd.commands && cmd.commands.length > 0) {
    json.commands = cmd.commands.map((c) => ({ name: c.name }));
  }

  if (cmd.args) {
    const argsInfo = await extractArgsInfo(cmd.args);
    if (argsInfo.length > 0) {
      json.arguments = argsInfo.map((arg) => {
        const argJson: {
          name: string;
          description?: string;
          optional: boolean;
          default?: unknown;
          type?: string;
        } = {
          name: arg.name,
          optional: arg.optional,
        };
        if (arg.description) argJson.description = arg.description;
        if (arg.default !== undefined) argJson.default = arg.default;
        if (arg.type) argJson.type = arg.type;
        return argJson;
      });
    }
  }

  if (cmd.options) {
    const optionsInfo = await extractOptionsInfo(cmd.options, cmd.meta);
    const optMap: Record<string, OptionInfo> = Object.fromEntries(optionsInfo.map((opt) => [opt.name, opt]));

    const aliases = await extractAliasesFromSchema(cmd.options, cmd.meta);
    for (const [alias, name] of Object.entries(aliases)) {
      const opt = optMap[name];
      if (!opt) continue;
      opt.aliases = [...(opt.aliases || []), alias];
    }

    const visibleOptions = optionsInfo.filter((opt) => !opt.hidden);
    if (visibleOptions.length > 0) {
      json.options = visibleOptions.map((opt) => {
        const option: {
          name: string;
          aliases?: string[];
          description?: string;
          optional: boolean;
          default?: unknown;
          type?: string;
          enum?: string[];
          deprecated?: boolean | string;
          examples?: unknown[];
        } = {
          name: opt.name,
          optional: opt.optional,
        };
        if (opt.aliases && opt.aliases.length > 0) option.aliases = opt.aliases;
        if (opt.description) option.description = opt.description;
        if (opt.default !== undefined) option.default = opt.default;
        if (opt.type) option.type = opt.type;
        if (opt.enum) option.enum = opt.enum;
        if (opt.deprecated !== undefined) option.deprecated = opt.deprecated;
        if (opt.examples && opt.examples.length > 0) option.examples = opt.examples;
        return option;
      });
    }
  }

  return JSON.stringify(json, null, 2);
}

export async function generateHelp(
  targetCommand: AnyZodrunCommand,
  findCommandByName: (name: string, commands?: AnyZodrunCommand[]) => AnyZodrunCommand | undefined,
  command?: string | AnyZodrunCommand,
  options?: HelpOptions,
) {
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

  const format = options?.format ?? 'auto';

  if (format === 'json') {
    return generateJsonHelp(cmd);
  }

  const formatter = createFormatter(format);
  const lines: string[] = [];

  if (format === 'html') {
    lines.push('<div style="font-family: monospace; line-height: 1.6;">');
  }

  // Command name/usage
  const commandName = cmd.fullName || '<root>';
  const usageParts = formatter.join([
    formatter.command(commandName),
    cmd.commands?.length ? formatter.meta('[command]') : '',
    cmd.args ? formatter.meta('[args...]') : '',
    cmd.options ? formatter.meta('[options]') : '',
  ]);
  const usageLabel = format === 'html' ? '<strong>Usage:</strong>' : 'Usage:';
  lines.push(`${usageLabel} ${usageParts}`);
  lines.push('');

  // Subcommands
  if (cmd.commands && cmd.commands.length > 0) {
    lines.push(formatter.label('Commands:'));
    const maxNameLength = Math.max(...cmd.commands.map((c) => c.name.length));
    for (const subCmd of cmd.commands) {
      const padding = ' '.repeat(Math.max(0, maxNameLength - subCmd.name.length + 2));
      lines.push(`  ${formatter.command(subCmd.name)}${padding}`);
    }
    lines.push('');
    lines.push(formatter.meta(`Run "${commandName} [command] --help" for more information on a command.`));
    lines.push('');
  }

  // Arguments
  if (cmd.args) {
    const argsInfo = await extractArgsInfo(cmd.args);
    if (argsInfo.length > 0) {
      lines.push(formatter.label('Arguments:'));
      for (const arg of argsInfo) {
        const optional = arg.optional ? formatter.meta(' (optional)') : '';
        const defaultVal = arg.default !== undefined ? formatter.meta(` (default: ${String(arg.default)})`) : '';
        lines.push(`  ${formatter.option(arg.name)}${optional}${defaultVal}`);
        if (arg.description) {
          lines.push(`    ${formatter.description(arg.description)}`);
        }
      }
      lines.push('');
    }
  }

  // Options
  if (cmd.options) {
    const optionsInfo = await extractOptionsInfo(cmd.options, cmd.meta);
    const optMap: Record<string, OptionInfo> = Object.fromEntries(optionsInfo.map((opt) => [opt.name, opt]));

    const aliases = await extractAliasesFromSchema(cmd.options, cmd.meta);
    for (const [alias, name] of Object.entries(aliases)) {
      const opt = optMap[name];
      if (!opt) continue;
      opt.aliases = [...(opt.aliases || []), alias];
    }

    const visibleOptions = optionsInfo.filter((opt) => !opt.hidden);

    if (visibleOptions.length > 0) {
      lines.push(formatter.label('Options:'));
      const maxNameLength = Math.max(...visibleOptions.map((opt) => opt.name.length));
      for (const opt of visibleOptions) {
        const optionName = `--${opt.name}`;
        const aliasNames = opt.aliases && opt.aliases.length > 0 ? opt.aliases.map((a) => `-${a}`).join(', ') : '';
        const fullOptionName = aliasNames ? `${optionName}, ${aliasNames}` : optionName;
        const padding = ' '.repeat(Math.max(0, maxNameLength - opt.name.length + 2));
        const typeInfo = opt.type ? ` ${formatter.type(`<${opt.type}>`)}` : '';
        const optional = opt.optional && !opt.deprecated ? formatter.meta(' (optional)') : '';
        const defaultVal = opt.default !== undefined ? formatter.meta(` (default: ${String(opt.default)})`) : '';
        const enumVals = opt.enum ? formatter.meta(` (choices: ${opt.enum.join(', ')})`) : '';

        const isDeprecated = !!opt.deprecated;
        const deprecatedMessage = isDeprecated
          ? typeof opt.deprecated === 'string'
            ? formatter.meta(` (deprecated: ${opt.deprecated})`)
            : formatter.meta(' (deprecated)')
          : '';

        const formattedOptionName = isDeprecated ? formatter.deprecated(fullOptionName) : formatter.option(fullOptionName);
        const description = opt.description ? formatter.description(opt.description) : '';
        lines.push(`  ${formattedOptionName}${typeInfo}${optional}${defaultVal}${enumVals}${deprecatedMessage}${padding}${description}`);

        if (opt.examples?.length) {
          const exampleValue = opt.examples.map((example) => (typeof example === 'string' ? example : JSON.stringify(example))).join(', ');
          lines.push(`      ${formatter.example('Example:')} ${formatter.exampleValue(exampleValue)}`);
        }
      }
      lines.push('');
    }
  }

  const result = lines.join(formatter.newline());

  if (format === 'html') {
    return `${result}</div>`;
  }

  return result;
}
