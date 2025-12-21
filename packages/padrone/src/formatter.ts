import { createColorizer } from './colorizer';

export type HelpFormat = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json';
export type HelpDetail = 'minimal' | 'standard' | 'full';

// ============================================================================
// Help Info Types (shared with help.ts)
// ============================================================================

/**
 * Information about a single positional argument.
 */
export type HelpArgumentInfo = {
  name: string;
  description?: string;
  optional: boolean;
  default?: unknown;
  type?: string;
};

/**
 * Information about a single option/flag.
 */
export type HelpOptionInfo = {
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
  /** Environment variable(s) this option can be set from */
  env?: string | string[];
  /** Whether this option is an array type (shown as <type...>) */
  variadic?: boolean;
  /** Whether this option is a boolean (shown as --[no-]option) */
  negatable?: boolean;
  /** Config file key that maps to this option */
  configKey?: string;
};

/**
 * Information about a subcommand (minimal info for listing).
 */
export type HelpSubcommandInfo = {
  name: string;
  description?: string;
};

/**
 * Comprehensive JSON structure for help information.
 * This is the single source of truth that all formatters use.
 */
export type HelpInfo = {
  /** The full command name (e.g., "cli serve" or "<root>") */
  name: string;
  /** Command description */
  description?: string;
  /** Usage string parts for flexible formatting */
  usage: {
    command: string;
    hasSubcommands: boolean;
    hasArguments: boolean;
    hasOptions: boolean;
  };
  /** List of subcommands */
  subcommands?: HelpSubcommandInfo[];
  /** Positional arguments */
  arguments?: HelpArgumentInfo[];
  /** Options/flags (only visible ones, hidden filtered out) */
  options?: HelpOptionInfo[];
  /** Full help info for nested commands (used in 'full' detail mode) */
  nestedCommands?: HelpInfo[];
};

// ============================================================================
// Formatter Interface
// ============================================================================

/**
 * A formatter that takes the entire HelpInfo structure and produces formatted output.
 */
export type Formatter = {
  /** Format the entire help info structure into a string */
  format: (info: HelpInfo) => string;
};

// ============================================================================
// Internal Styling Types
// ============================================================================

/**
 * Internal styling functions used by formatters.
 * These handle the visual styling of individual text elements.
 */
type Styler = {
  command: (text: string) => string;
  option: (text: string) => string;
  type: (text: string) => string;
  description: (text: string) => string;
  label: (text: string) => string;
  meta: (text: string) => string;
  example: (text: string) => string;
  exampleValue: (text: string) => string;
  deprecated: (text: string) => string;
};

/**
 * Layout configuration for formatters.
 */
type LayoutConfig = {
  newline: string;
  indent: (level: number) => string;
  join: (parts: string[]) => string;
  wrapDocument?: (content: string) => string;
  usageLabel: string;
};

// ============================================================================
// Styler Factories
// ============================================================================

function createTextStyler(): Styler {
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
  };
}

function createAnsiStyler(): Styler {
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
  };
}

function createConsoleStyler(): Styler {
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
  };
}

function createMarkdownStyler(): Styler {
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
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function createHtmlStyler(): Styler {
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
  };
}

// ============================================================================
// Layout Configurations
// ============================================================================

function createTextLayout(): LayoutConfig {
  return {
    newline: '\n',
    indent: (level) => '  '.repeat(level),
    join: (parts) => parts.filter(Boolean).join(' '),
    usageLabel: 'Usage:',
  };
}

function createMarkdownLayout(): LayoutConfig {
  return {
    newline: '\n\n',
    indent: (level) => {
      if (level === 0) return '';
      if (level === 1) return '  ';
      return '    ';
    },
    join: (parts) => parts.filter(Boolean).join(' '),
    usageLabel: 'Usage:',
  };
}

function createHtmlLayout(): LayoutConfig {
  return {
    newline: '<br>',
    indent: (level) => '&nbsp;&nbsp;'.repeat(level),
    join: (parts) => parts.filter(Boolean).join(' '),
    wrapDocument: (content) => `<div style="font-family: monospace; line-height: 1.6;">${content}</div>`,
    usageLabel: '<strong>Usage:</strong>',
  };
}

// ============================================================================
// Generic Formatter Implementation
// ============================================================================

/**
 * Creates a formatter that uses the given styler and layout configuration.
 */
function createGenericFormatter(styler: Styler, layout: LayoutConfig): Formatter {
  const { newline, indent, join, wrapDocument, usageLabel } = layout;

  function formatUsageSection(info: HelpInfo): string[] {
    const usageParts: string[] = [
      styler.command(info.usage.command),
      info.usage.hasSubcommands ? styler.meta('[command]') : '',
      info.usage.hasArguments ? styler.meta('[args...]') : '',
      info.usage.hasOptions ? styler.meta('[options]') : '',
    ];
    return [`${usageLabel} ${join(usageParts)}`];
  }

  function formatSubcommandsSection(info: HelpInfo): string[] {
    const lines: string[] = [];
    const subcommands = info.subcommands!;

    lines.push(styler.label('Commands:'));

    const maxNameLength = Math.max(...subcommands.map((c) => c.name.length));
    for (const subCmd of subcommands) {
      const padding = ' '.repeat(Math.max(0, maxNameLength - subCmd.name.length + 2));
      const lineParts: string[] = [styler.command(subCmd.name), padding];
      if (subCmd.description) {
        lineParts.push(styler.description(subCmd.description));
      }
      lines.push(indent(1) + lineParts.join(''));
    }

    lines.push('');
    lines.push(styler.meta(`Run "${info.name} [command] --help" for more information on a command.`));

    return lines;
  }

  function formatArgumentsSection(info: HelpInfo): string[] {
    const lines: string[] = [];
    const args = info.arguments!;

    lines.push(styler.label('Arguments:'));

    for (const arg of args) {
      const parts: string[] = [styler.option(arg.name)];
      if (arg.optional) parts.push(styler.meta('(optional)'));
      if (arg.default !== undefined) parts.push(styler.meta(`(default: ${String(arg.default)})`));
      lines.push(indent(1) + join(parts));

      if (arg.description) {
        lines.push(indent(2) + styler.description(arg.description));
      }
    }

    return lines;
  }

  function formatOptionsSection(info: HelpInfo): string[] {
    const lines: string[] = [];
    const options = info.options!;

    lines.push(styler.label('Options:'));

    const maxNameLength = Math.max(...options.map((opt) => opt.name.length));

    for (const opt of options) {
      // Format option name: --[no-]option for booleans, --option otherwise
      const optionName = opt.negatable ? `--[no-]${opt.name}` : `--${opt.name}`;
      const aliasNames = opt.aliases && opt.aliases.length > 0 ? opt.aliases.map((a) => `-${a}`).join(', ') : '';
      const fullOptionName = aliasNames ? `${optionName}, ${aliasNames}` : optionName;
      const padding = ' '.repeat(Math.max(0, maxNameLength - opt.name.length + 2));
      const isDeprecated = !!opt.deprecated;
      const formattedOptionName = isDeprecated ? styler.deprecated(fullOptionName) : styler.option(fullOptionName);

      const parts: string[] = [formattedOptionName];
      if (opt.type) parts.push(styler.type(`<${opt.type}>`));
      if (opt.optional && !opt.deprecated) parts.push(styler.meta('(optional)'));
      if (opt.default !== undefined) parts.push(styler.meta(`(default: ${String(opt.default)})`));
      if (opt.enum) parts.push(styler.meta(`(choices: ${opt.enum.join(', ')})`));
      if (opt.variadic) parts.push(styler.meta('(repeatable)'));
      if (isDeprecated) {
        const deprecatedMeta =
          typeof opt.deprecated === 'string' ? styler.meta(`(deprecated: ${opt.deprecated})`) : styler.meta('(deprecated)');
        parts.push(deprecatedMeta);
      }

      const description = opt.description ? styler.description(opt.description) : '';
      lines.push(indent(1) + join(parts) + padding + description);

      // Environment variable line
      if (opt.env) {
        const envVars = typeof opt.env === 'string' ? [opt.env] : opt.env;
        const envParts: string[] = [styler.example('Env:'), styler.exampleValue(envVars.join(', '))];
        lines.push(indent(3) + join(envParts));
      }

      // Config key line
      if (opt.configKey) {
        const configParts: string[] = [styler.example('Config:'), styler.exampleValue(opt.configKey)];
        lines.push(indent(3) + join(configParts));
      }

      // Examples line
      if (opt.examples && opt.examples.length > 0) {
        const exampleValues = opt.examples.map((example) => (typeof example === 'string' ? example : JSON.stringify(example))).join(', ');
        const exampleParts: string[] = [styler.example('Example:'), styler.exampleValue(exampleValues)];
        lines.push(indent(3) + join(exampleParts));
      }
    }

    return lines;
  }

  return {
    format(info: HelpInfo): string {
      const lines: string[] = [];

      // Usage section
      lines.push(...formatUsageSection(info));
      lines.push('');

      // Description section (if present)
      if (info.description) {
        lines.push(styler.description(info.description));
        lines.push('');
      }

      // Subcommands section
      if (info.subcommands && info.subcommands.length > 0) {
        lines.push(...formatSubcommandsSection(info));
        lines.push('');
      }

      // Arguments section
      if (info.arguments && info.arguments.length > 0) {
        lines.push(...formatArgumentsSection(info));
        lines.push('');
      }

      // Options section
      if (info.options && info.options.length > 0) {
        lines.push(...formatOptionsSection(info));
        lines.push('');
      }

      // Nested commands section (full detail mode)
      if (info.nestedCommands?.length) {
        lines.push(styler.label('Subcommand Details:'));
        lines.push('');
        for (const nestedCmd of info.nestedCommands) {
          lines.push(styler.meta('─'.repeat(60)));
          lines.push(this.format(nestedCmd));
        }
      }

      const result = lines.join(newline);
      return wrapDocument ? wrapDocument(result) : result;
    },
  };
}

// ============================================================================
// JSON Formatter
// ============================================================================

function createJsonFormatter(): Formatter {
  function getJson(info: HelpInfo) {
    const json: Record<string, unknown> = {
      name: info.name,
      usage: [
        info.usage.command,
        info.usage.hasSubcommands ? '[command]' : null,
        info.usage.hasArguments ? '[args...]' : null,
        info.usage.hasOptions ? '[options]' : null,
      ]
        .filter(Boolean)
        .join(' '),
    };

    if (info.description) json.description = info.description;

    if (info.subcommands?.length) {
      json.commands = info.subcommands.map((c) => {
        const cmd: Record<string, unknown> = { name: c.name };
        if (c.description) cmd.description = c.description;
        return cmd;
      });
    }

    if (info.arguments?.length) {
      json.arguments = info.arguments.map((arg) => {
        const argJson: Record<string, unknown> = {
          name: arg.name,
          optional: arg.optional,
        };
        if (arg.description) argJson.description = arg.description;
        if (arg.default !== undefined) argJson.default = arg.default;
        if (arg.type) argJson.type = arg.type;
        return argJson;
      });
    }

    if (info.options?.length) {
      json.options = info.options.map((opt) => {
        const optJson: Record<string, unknown> = {
          name: opt.name,
          optional: opt.optional,
        };
        if (opt.aliases && opt.aliases.length > 0) optJson.aliases = opt.aliases;
        if (opt.description) optJson.description = opt.description;
        if (opt.default !== undefined) optJson.default = opt.default;
        if (opt.type) optJson.type = opt.type;
        if (opt.enum) optJson.enum = opt.enum;
        if (opt.deprecated !== undefined) optJson.deprecated = opt.deprecated;
        if (opt.examples && opt.examples.length > 0) optJson.examples = opt.examples;
        return optJson;
      });
    }

    if (info.nestedCommands?.length) {
      json.nestedCommands = info.nestedCommands.map(getJson);
    }

    return json;
  }

  return {
    format(info: HelpInfo): string {
      return JSON.stringify(getJson(info), null, 2);
    },
  };
}

// ============================================================================
// Formatter Factory
// ============================================================================

function shouldUseAnsi(): boolean {
  if (typeof process === 'undefined') return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.CI) return false;
  if (process.stdout && typeof process.stdout.isTTY === 'boolean') return process.stdout.isTTY;
  return false;
}

// ============================================================================
// Minimal Formatter
// ============================================================================

/**
 * Creates a minimal formatter that outputs just a single-line usage string.
 */
function createMinimalFormatter(): Formatter {
  return {
    format(info: HelpInfo): string {
      const parts: string[] = [info.usage.command];
      if (info.usage.hasSubcommands) parts.push('[command]');
      if (info.usage.hasArguments) parts.push('[args...]');
      if (info.usage.hasOptions) parts.push('[options]');
      return parts.join(' ');
    },
  };
}

export function createFormatter(format: HelpFormat | 'auto', detail: HelpDetail = 'standard'): Formatter {
  if (detail === 'minimal') return createMinimalFormatter();
  if (format === 'json') return createJsonFormatter();
  if (format === 'ansi' || (format === 'auto' && shouldUseAnsi())) return createGenericFormatter(createAnsiStyler(), createTextLayout());
  if (format === 'console') return createGenericFormatter(createConsoleStyler(), createTextLayout());
  if (format === 'markdown') return createGenericFormatter(createMarkdownStyler(), createMarkdownLayout());
  if (format === 'html') return createGenericFormatter(createHtmlStyler(), createHtmlLayout());
  return createGenericFormatter(createTextStyler(), createTextLayout());
}
