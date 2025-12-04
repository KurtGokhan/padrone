import { createColorizer } from './colorizer';

export type HelpFormat = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json';

export type Formatter = {
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
  indent: (level: number, content: string) => string;
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
    indent: (level, content) => '  '.repeat(level) + content,
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
    indent: (level, content) => '  '.repeat(level) + content,
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
    indent: (level, content) => '  '.repeat(level) + content,
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
    newline: () => '\n\n',
    join: (parts) => parts.filter(Boolean).join(' '),
    indent: (level, content) => {
      if (level === 0) return content;
      if (level === 1) return `  ${content}`;
      return `    ${content}`;
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
    indent: (level, content) => '&nbsp;&nbsp;'.repeat(level) + content,
  };
}

function shouldUseAnsi(): boolean {
  if (typeof process === 'undefined') return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.CI) return false;
  if (process.stdout && typeof process.stdout.isTTY === 'boolean') return process.stdout.isTTY;
  return false;
}

export function createFormatter(format: HelpFormat | 'auto'): Formatter {
  if (format === 'ansi' || (format === 'auto' && shouldUseAnsi())) return createAnsiFormatter();
  if (format === 'console') return createConsoleFormatter();
  if (format === 'markdown') return createMarkdownFormatter();
  if (format === 'html') return createHtmlFormatter();
  return createTextFormatter();
}
