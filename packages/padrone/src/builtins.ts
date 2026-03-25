import { type ColorConfig, type ColorTheme, colorThemes } from './colorizer.ts';
import { findCommandByName } from './command-utils.ts';
import type { ShellType } from './completion.ts';
import { parseCliInputToParts } from './parse.ts';
import type { AnyPadroneCommand } from './types.ts';

type DetailLevel = 'minimal' | 'standard' | 'full';
type FormatLevel = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json' | 'auto';

export type BuiltinAction =
  | { type: 'help'; command?: AnyPadroneCommand; detail?: DetailLevel; format?: FormatLevel; all?: boolean }
  | { type: 'version' }
  | { type: 'completion'; shell?: ShellType; setup?: boolean }
  | { type: 'man'; setup?: boolean; remove?: boolean }
  | { type: 'repl'; scope?: string }
  | { type: 'mcp'; transport?: 'http' | 'stdio'; port?: number; host?: string; basePath?: string }
  | { type: 'serve'; port?: number; host?: string; basePath?: string };

/**
 * Check if help, version, or completion flags/commands are present in the input.
 * Returns the appropriate action to take, or null if normal execution should proceed.
 */
export function checkBuiltinCommands(input: string | undefined, rootCommand: AnyPadroneCommand): BuiltinAction | null {
  if (!input) return null;

  const parts = parseCliInputToParts(input);
  const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
  const args = parts.filter((p) => p.type === 'named' || p.type === 'alias');

  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

  // Check for --help, -h flags (these take precedence over commands)
  const hasHelpFlag = args.some((p) => (p.type === 'named' && keyIs(p.key, 'help')) || (p.type === 'alias' && keyIs(p.key, 'h')));

  // Extract detail level from --detail[=<level>] or -d [<level>]
  const getDetailLevel = (): DetailLevel | undefined => {
    for (const arg of args) {
      if (arg.type === 'named' && keyIs(arg.key, 'detail')) {
        if (typeof arg.value === 'string' && (arg.value === 'minimal' || arg.value === 'standard' || arg.value === 'full')) {
          return arg.value;
        }
        return 'full';
      }
      if (arg.type === 'alias' && keyIs(arg.key, 'd')) {
        if (typeof arg.value === 'string' && (arg.value === 'minimal' || arg.value === 'standard' || arg.value === 'full')) {
          return arg.value;
        }
        return 'full';
      }
    }
    return undefined;
  };
  const detail = getDetailLevel();

  // Extract format from --format=<value> or -f <value>
  const getFormat = (): FormatLevel | undefined => {
    const validFormats: FormatLevel[] = ['text', 'ansi', 'console', 'markdown', 'html', 'json', 'auto'];
    for (const arg of args) {
      if (arg.type === 'named' && keyIs(arg.key, 'format') && typeof arg.value === 'string') {
        if (validFormats.includes(arg.value as FormatLevel)) return arg.value as FormatLevel;
      }
      if (arg.type === 'alias' && keyIs(arg.key, 'f') && typeof arg.value === 'string') {
        if (validFormats.includes(arg.value as FormatLevel)) return arg.value as FormatLevel;
      }
    }
    return undefined;
  };
  const format = getFormat();

  // Check for --all flag (show all built-in help)
  const hasAllFlag = args.some((p) => p.type === 'named' && keyIs(p.key, 'all'));

  // Check for --version, -v, -V flags
  const hasVersionFlag = args.some(
    (p) => (p.type === 'named' && keyIs(p.key, 'version')) || (p.type === 'alias' && (keyIs(p.key, 'v') || keyIs(p.key, 'V'))),
  );

  // If the first term is the program name, skip it
  const normalizedTerms = [...terms];
  if (normalizedTerms[0] === rootCommand.name) normalizedTerms.shift();

  // Check if user has defined 'help', 'version', or 'completion' commands (they take precedence)
  const userHelpCommand = findCommandByName('help', rootCommand.commands);
  const userVersionCommand = findCommandByName('version', rootCommand.commands);
  const userCompletionCommand = findCommandByName('completion', rootCommand.commands);

  // Check for 'help' command (only if user hasn't defined one)
  // Supports both 'help <command>' and '<command> help' forms
  if (!userHelpCommand && normalizedTerms[0] === 'help') {
    const commandName = normalizedTerms.slice(1).join(' ');
    const targetCommand = commandName ? findCommandByName(commandName, rootCommand.commands) : undefined;
    return { type: 'help', command: targetCommand, detail, format, all: hasAllFlag || undefined };
  }
  if (!userHelpCommand && normalizedTerms.length > 0 && normalizedTerms[normalizedTerms.length - 1] === 'help') {
    const commandTerms = normalizedTerms.slice(0, -1);
    let targetCommand: AnyPadroneCommand | undefined;
    let current = rootCommand;
    for (const term of commandTerms) {
      const found = findCommandByName(term, current.commands);
      if (found) {
        targetCommand = found;
        current = found;
      } else {
        break;
      }
    }
    return { type: 'help', command: targetCommand, detail, format, all: hasAllFlag || undefined };
  }

  // Check for 'version' command (only if user hasn't defined one)
  if (!userVersionCommand && normalizedTerms[0] === 'version') {
    return { type: 'version' };
  }

  // Check for 'completion' command (only if user hasn't defined one)
  if (!userCompletionCommand && normalizedTerms[0] === 'completion') {
    const shellArg = normalizedTerms[1] as ShellType | undefined;
    const validShells: ShellType[] = ['bash', 'zsh', 'fish', 'powershell'];
    const shell = shellArg && validShells.includes(shellArg) ? shellArg : undefined;
    const setup = args.some((p) => p.type === 'named' && keyIs(p.key, 'setup'));
    return { type: 'completion', shell, setup };
  }

  // Check for 'man' command (only if user hasn't defined one)
  const userManCommand = findCommandByName('man', rootCommand.commands);
  if (!userManCommand && normalizedTerms[0] === 'man') {
    const setup = args.some((p) => p.type === 'named' && keyIs(p.key, 'setup'));
    const remove = args.some((p) => p.type === 'named' && keyIs(p.key, 'remove'));
    return { type: 'man', setup, remove };
  }

  // Handle help flag - find the command being requested
  if (hasHelpFlag) {
    const commandTerms = normalizedTerms.filter((t) => t !== 'help');
    const commandName = commandTerms.join(' ');
    const targetCommand = commandName ? findCommandByName(commandName, rootCommand.commands) : undefined;
    return { type: 'help', command: targetCommand, detail, format, all: hasAllFlag || undefined };
  }

  // Handle version flag (only for root command, i.e., no subcommand terms)
  if (hasVersionFlag && normalizedTerms.length === 0) {
    return { type: 'version' };
  }

  // Check for 'mcp' command (only if user hasn't defined one)
  const userMcpCommand = findCommandByName('mcp', rootCommand.commands);
  if (!userMcpCommand && normalizedTerms[0] === 'mcp') {
    const transportArg = normalizedTerms[1];
    const transport = transportArg === 'stdio' || transportArg === 'http' ? transportArg : undefined;
    const portArg = args.find((p) => p.type === 'named' && keyIs(p.key, 'port'));
    const port = typeof portArg?.value === 'string' ? parseInt(portArg.value, 10) : undefined;
    const hostArg = args.find((p) => p.type === 'named' && keyIs(p.key, 'host'));
    const host = typeof hostArg?.value === 'string' ? hostArg.value : undefined;
    const basePathArg = args.find((p) => p.type === 'named' && keyIs(p.key, 'base-path'));
    const mcpBasePath = typeof basePathArg?.value === 'string' ? basePathArg.value : undefined;
    return { type: 'mcp', transport, port: port && !Number.isNaN(port) ? port : undefined, host, basePath: mcpBasePath };
  }

  // Check for 'serve' command (only if user hasn't defined one)
  const userServeCommand = findCommandByName('serve', rootCommand.commands);
  if (!userServeCommand && normalizedTerms[0] === 'serve') {
    const portArg = args.find((p) => p.type === 'named' && keyIs(p.key, 'port'));
    const port = typeof portArg?.value === 'string' ? parseInt(portArg.value, 10) : undefined;
    const hostArg = args.find((p) => p.type === 'named' && keyIs(p.key, 'host'));
    const host = typeof hostArg?.value === 'string' ? hostArg.value : undefined;
    const basePathArg = args.find((p) => p.type === 'named' && keyIs(p.key, 'base-path'));
    const basePath = typeof basePathArg?.value === 'string' ? basePathArg.value : undefined;
    return { type: 'serve', port: port && !Number.isNaN(port) ? port : undefined, host, basePath };
  }

  // Check for --repl flag
  const hasReplFlag = args.some((p) => p.type === 'named' && keyIs(p.key, 'repl'));
  if (hasReplFlag) {
    const scope = normalizedTerms.length > 0 ? normalizedTerms.join(' ') : undefined;
    return { type: 'repl', scope };
  }

  return null;
}

/**
 * Extract the config file path from --config=<path> or -c <path> flags.
 */
export function extractConfigPath(input: string | undefined): string | undefined {
  if (!input) return undefined;

  const parts = parseCliInputToParts(input);
  const args = parts.filter((p) => p.type === 'named' || p.type === 'alias');

  for (const arg of args) {
    if (arg.type === 'named' && arg.key.length === 1 && arg.key[0] === 'config' && typeof arg.value === 'string') {
      return arg.value;
    }
    if (arg.type === 'alias' && arg.key.length === 1 && arg.key[0] === 'c' && typeof arg.value === 'string') {
      return arg.value;
    }
  }
  return undefined;
}

/**
 * Extract --color flag from input.
 * - `--color` or `--color=true` → use default theme
 * - `--color=false` or `--no-color` → disable colors (text format)
 * - `--color=<theme>` → use the named theme
 * Returns `undefined` if no --color flag is present.
 */
export function extractColorFlag(input: string | undefined): { theme?: ColorTheme | ColorConfig; disableColor?: boolean } | undefined {
  if (!input) return undefined;

  const parts = parseCliInputToParts(input);
  const args = parts.filter((p) => p.type === 'named');
  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

  for (const arg of args) {
    if (arg.type === 'named' && keyIs(arg.key, 'no-color')) {
      return { disableColor: true };
    }
    if (arg.type === 'named' && keyIs(arg.key, 'color')) {
      if (arg.negated) return { disableColor: true };
      if (arg.value === undefined || arg.value === 'true') return { theme: 'default' };
      if (arg.value === 'false') return { disableColor: true };
      if (typeof arg.value === 'string' && arg.value in colorThemes) return { theme: arg.value as ColorTheme };
      return undefined;
    }
  }
  return undefined;
}

/**
 * Resolves an inherited field by walking up the parent chain.
 * Returns the value from the nearest ancestor that defines it, or undefined.
 */
export function resolveInherited<K extends keyof AnyPadroneCommand>(cmd: AnyPadroneCommand, key: K): AnyPadroneCommand[K] {
  let current: AnyPadroneCommand | undefined = cmd;
  while (current) {
    if (current[key] !== undefined) return current[key];
    current = current.parent;
  }
  return undefined;
}
