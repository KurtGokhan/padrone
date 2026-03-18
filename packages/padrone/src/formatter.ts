import { camelToKebab } from './args.ts';
import { createColorizer } from './colorizer.ts';

export type HelpFormat = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json';
export type HelpDetail = 'minimal' | 'standard' | 'full';

// ============================================================================
// Help Info Types (shared with help.ts)
// ============================================================================

/**
 * Information about a single positional argument.
 */
export type HelpPositionalInfo = {
  name: string;
  description?: string;
  optional: boolean;
  default?: unknown;
  type?: string;
};

/**
 * Information about a single argument/flag.
 */
export type HelpArgumentInfo = {
  name: string;
  description?: string;
  optional: boolean;
  default?: unknown;
  type?: string;
  enum?: string[];
  /** Single-character short flags (shown as `-v`) */
  flags?: string[];
  /** Multi-character alternative long names (shown as `--dry-run`) */
  aliases?: string[];
  deprecated?: boolean | string;
  hidden?: boolean;
  examples?: unknown[];
  /** Environment variable(s) this arg can be set from */
  env?: string | string[];
  /** Whether this arg is an array type (shown as <type...>) */
  variadic?: boolean;
  /** Whether this arg is a boolean (shown as --[no-]arg) */
  negatable?: boolean;
  /** Config file key that maps to this arg */
  configKey?: string;
};

/**
 * Information about a subcommand (minimal info for listing).
 */
export type HelpSubcommandInfo = {
  name: string;
  title?: string;
  description?: string;
  aliases?: string[];
  deprecated?: boolean | string;
  hidden?: boolean;
  hasSubcommands?: boolean;
};

/**
 * Information about a built-in command/flag entry.
 */
export type HelpBuiltinInfo = {
  name: string;
  description?: string;
  sub?: { name: string; description?: string }[];
};

/**
 * Comprehensive JSON structure for help information.
 * This is the single source of truth that all formatters use.
 */
export type HelpInfo = {
  /** The full command name (e.g., "cli serve" or "<root>") */
  name: string;
  /** Short title for the command */
  title?: string;
  /** Command description */
  description?: string;
  /** Alternative names/aliases for this command */
  aliases?: string[];
  /** Whether the command is deprecated */
  deprecated?: boolean | string;
  /** Whether the command is hidden */
  hidden?: boolean;
  /** Usage string parts for flexible formatting */
  usage: {
    command: string;
    hasSubcommands: boolean;
    hasPositionals: boolean;
    hasArguments: boolean;
    /** The name of the field that reads from stdin, if any. Shown as `[stdin > field]` in usage. */
    stdinField?: string;
  };
  /** List of subcommands */
  subcommands?: HelpSubcommandInfo[];
  /** Positional arguments */
  positionals?: HelpPositionalInfo[];
  /** Arguments/flags (only visible ones, hidden filtered out) */
  arguments?: HelpArgumentInfo[];
  /** Built-in commands and flags (shown only for root command) */
  builtins?: HelpBuiltinInfo[];
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
  arg: (text: string) => string;
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
    arg: (text) => text,
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
    arg: colorizer.arg,
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
    arg: (text) => `${colors.green}${text}${colors.reset}`,
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
    arg: (text) => `\`${text}\``,
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
    arg: (text) => `<code style="color: #4caf50;">${escapeHtml(text)}</code>`,
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
    const usageParts: string[] = [styler.command(info.usage.command), info.usage.hasSubcommands ? styler.meta('[command]') : ''];
    // Show actual positional argument names in usage line
    if (info.positionals && info.positionals.length > 0) {
      for (const arg of info.positionals) {
        const name = arg.name.startsWith('...') ? `${arg.name}` : arg.name;
        usageParts.push(styler.meta(arg.optional ? `[${name}]` : `<${name}>`));
      }
    }
    if (info.usage.hasArguments) usageParts.push(styler.meta('[options]'));
    return [`${usageLabel} ${join(usageParts)}`];
  }

  function formatSubcommandsSection(info: HelpInfo): string[] {
    const lines: string[] = [];
    const subcommands = info.subcommands!;

    lines.push(styler.label('Commands:'));

    const subcommandSuffix = (c: HelpSubcommandInfo) => (c.hasSubcommands ? ' <subcommand>' : '');
    const formatAliasParts = (c: HelpSubcommandInfo) => {
      if (!c.aliases?.length) return { plain: '', styled: '' };
      const realAliases = c.aliases.filter((a) => a !== '[default]');
      const hasDefault = c.aliases.some((a) => a === '[default]');
      const parts: string[] = [];
      const styledParts: string[] = [];
      if (realAliases.length) {
        parts.push(`(${realAliases.join(', ')})`);
        styledParts.push(`(${realAliases.join(', ')})`);
      }
      if (hasDefault) {
        parts.push('[default]');
        styledParts.push(styler.meta('[default]'));
      }
      return { plain: parts.length ? ` ${parts.join(' ')}` : '', styled: styledParts.length ? ` ${styledParts.join(' ')}` : '' };
    };
    const maxNameLength = Math.max(
      ...subcommands.map((c) => {
        return (c.name + subcommandSuffix(c) + formatAliasParts(c).plain).length;
      }),
    );
    for (const subCmd of subcommands) {
      const aliasParts = formatAliasParts(subCmd);
      const suffix = subcommandSuffix(subCmd);
      const commandDisplay = subCmd.name + suffix + aliasParts.plain;
      const padding = ' '.repeat(Math.max(0, maxNameLength - commandDisplay.length + 2));
      const isDeprecated = !!subCmd.deprecated;
      const isDefaultEntry = subCmd.name === '[default]';
      const commandName = isDeprecated
        ? styler.deprecated(commandDisplay)
        : (isDefaultEntry ? styler.meta(subCmd.name) : styler.command(subCmd.name)) +
          (suffix ? styler.meta(suffix) : '') +
          aliasParts.styled;
      const lineParts: string[] = [commandName, padding];

      // Use title if available, otherwise use description
      const displayText = subCmd.title ?? subCmd.description;
      if (displayText) {
        lineParts.push(isDeprecated ? styler.deprecated(displayText) : styler.description(displayText));
      }
      if (isDeprecated) {
        const deprecatedMeta =
          typeof subCmd.deprecated === 'string' ? styler.meta(` (deprecated: ${subCmd.deprecated})`) : styler.meta(' (deprecated)');
        lineParts.push(deprecatedMeta);
      }
      lines.push(indent(1) + lineParts.join(''));
    }

    lines.push('');
    lines.push(styler.meta(`Run "${info.name} [command] --help" for more information on a command.`));

    return lines;
  }

  function formatPositionalsSection(info: HelpInfo): string[] {
    const lines: string[] = [];
    const args = info.positionals!;

    lines.push(styler.label('Arguments:'));

    const maxNameLength = Math.min(32, Math.max(...args.map((a) => a.name.length)));

    for (const arg of args) {
      const padding = ' '.repeat(Math.max(2, maxNameLength - arg.name.length + 2));
      const descParts: string[] = [];
      if (arg.description) descParts.push(styler.description(arg.description));
      if (info.usage.stdinField === arg.name) descParts.push(styler.meta('(stdin)'));
      if (arg.default !== undefined) descParts.push(styler.meta(`(default: ${String(arg.default)})`));
      lines.push(indent(1) + styler.arg(arg.name) + padding + join(descParts));
    }

    return lines;
  }

  function formatArgumentsSection(info: HelpInfo): string[] {
    const lines: string[] = [];
    const argList = info.arguments || [];

    lines.push(styler.label('Options:'));

    // Helper to check if a default value is meaningful (not empty string/array)
    const hasDefault = (value: unknown): boolean => {
      if (value === undefined) return false;
      if (value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    };

    // Build left column (signature) for each arg to compute alignment
    const argColumns: { plain: string; styled: string; arg: HelpArgumentInfo }[] = argList.map((arg) => {
      // Promote kebab-case alias to primary display name if it exists
      const kebab = camelToKebab(arg.name);
      const primaryName = kebab && arg.aliases?.includes(kebab) ? kebab : arg.name;
      const remainingAliases = arg.aliases?.filter((a) => a !== primaryName);
      const argName = `--${primaryName}`;
      const flagNames = arg.flags?.length ? arg.flags.map((f) => `-${f}`).join(', ') : '';
      const aliasNames = remainingAliases?.length ? remainingAliases.map((a) => `--${a}`).join(', ') : '';
      const shortNames = [flagNames, aliasNames].filter(Boolean).join(', ');
      const fullArgName = shortNames ? `${argName}, ${shortNames}` : argName;
      const isDeprecated = !!arg.deprecated;
      const formattedArgName = isDeprecated ? styler.deprecated(fullArgName) : styler.arg(fullArgName);

      const plainParts: string[] = [fullArgName];
      const styledParts: string[] = [formattedArgName];

      if (arg.type && arg.type !== 'boolean') {
        const typePart = arg.optional ? `[${arg.type}]` : `<${arg.type}>`;
        plainParts.push(typePart);
        styledParts.push(styler.type(typePart));
      }
      if (isDeprecated) {
        const deprecatedPart = typeof arg.deprecated === 'string' ? `(deprecated: ${arg.deprecated})` : '(deprecated)';
        plainParts.push(deprecatedPart);
        styledParts.push(styler.meta(deprecatedPart));
      }

      return { plain: plainParts.join(' '), styled: join(styledParts), arg };
    });

    const maxColumnWidth = Math.min(32, Math.max(...argColumns.map((c) => c.plain.length)));

    for (const { plain, styled, arg } of argColumns) {
      const padding = ' '.repeat(Math.max(2, maxColumnWidth - plain.length + 2));

      // Description followed by metadata (choices, default)
      const descParts: string[] = [];
      if (arg.description) descParts.push(styler.description(arg.description));
      if (info.usage.stdinField === arg.name) descParts.push(styler.meta('(stdin)'));
      if (arg.enum) descParts.push(styler.meta(`(choices: ${arg.enum.join(', ')})`));
      if (hasDefault(arg.default)) descParts.push(styler.meta(`(default: ${String(arg.default)})`));

      lines.push(indent(1) + styled + padding + join(descParts));

      // Environment variable line
      if (arg.env) {
        const envVars = typeof arg.env === 'string' ? [arg.env] : arg.env;
        const envParts: string[] = [styler.example('Env:'), styler.exampleValue(envVars.join(', '))];
        lines.push(indent(3) + join(envParts));
      }

      // Config key line
      if (arg.configKey) {
        const configParts: string[] = [styler.example('Config:'), styler.exampleValue(arg.configKey)];
        lines.push(indent(3) + join(configParts));
      }

      // Examples line
      if (arg.examples && arg.examples.length > 0) {
        const exampleValues = arg.examples.map((example) => (typeof example === 'string' ? example : JSON.stringify(example))).join(', ');
        const exampleParts: string[] = [styler.example('Example:'), styler.exampleValue(exampleValues)];
        lines.push(indent(3) + join(exampleParts));
      }
    }

    return lines;
  }

  function formatBuiltinsSection(info: HelpInfo): string[] {
    const lines: string[] = [];
    const builtins = info.builtins!;

    lines.push(styler.label('Built-in:'));

    // Compute max effective name length for alignment across main and sub entries
    const allLengths: number[] = [];
    for (const entry of builtins) {
      allLengths.push(entry.name.length);
      if (entry.sub) {
        for (const sub of entry.sub) {
          // Sub entries get extra indent(2) - indent(1) = 2 chars
          allLengths.push(sub.name.length + 2);
        }
      }
    }
    const maxLen = Math.max(...allLengths);

    for (const entry of builtins) {
      const padding = ' '.repeat(Math.max(2, maxLen - entry.name.length + 2));
      const parts: string[] = [styler.command(entry.name)];
      if (entry.description) parts.push(padding + styler.description(entry.description));
      lines.push(indent(1) + parts.join(''));

      if (entry.sub) {
        for (const sub of entry.sub) {
          const subPadding = ' '.repeat(Math.max(2, maxLen - sub.name.length));
          const subParts: string[] = [styler.arg(sub.name)];
          if (sub.description) subParts.push(subPadding + styler.description(sub.description));
          lines.push(indent(2) + subParts.join(''));
        }
      }
    }

    return lines;
  }

  return {
    format(info: HelpInfo): string {
      const lines: string[] = [];

      // Show deprecation warning at the top if command is deprecated
      if (info.deprecated) {
        const deprecationMessage =
          typeof info.deprecated === 'string' ? `⚠️  This command is deprecated: ${info.deprecated}` : '⚠️  This command is deprecated';
        lines.push(styler.deprecated(deprecationMessage));
        lines.push('');
      }

      // Usage section
      lines.push(...formatUsageSection(info));
      lines.push('');

      // Title section (if present, shows a short summary line)
      if (info.title) {
        lines.push(styler.label(info.title));
        lines.push('');
      }

      // Aliases section (if present)
      if (info.aliases && info.aliases.length > 0) {
        lines.push(styler.meta(`Aliases: ${info.aliases.join(', ')}`));
        lines.push('');
      }

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

      if (info.positionals && info.positionals.length > 0) {
        lines.push(...formatPositionalsSection(info));
        lines.push('');
      }

      if (info.arguments && info.arguments.length > 0) {
        lines.push(...formatArgumentsSection(info));
        lines.push('');
      }

      if (info.builtins && info.builtins.length > 0) {
        lines.push(...formatBuiltinsSection(info));
        lines.push('');
      }

      // Show --no- hint when there are negatable boolean options defaulting to true
      if (info.arguments?.some((arg) => arg.negatable && arg.default === true)) {
        lines.push(styler.meta('Boolean options can be negated with --no-<option>.'));
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
  return {
    format(info: HelpInfo): string {
      return JSON.stringify(info, null, 2);
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
      if (info.positionals && info.positionals.length > 0) {
        for (const arg of info.positionals) {
          const name = arg.name.startsWith('...') ? `${arg.name}` : arg.name;
          parts.push(arg.optional ? `[${name}]` : `<${name}>`);
        }
      }
      if (info.usage.hasArguments) parts.push('[options]');
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
