import { findCommandByName, getCommandRuntime, resolveAllCommands } from '../core/commands.ts';
import { parseCliInputToParts } from '../core/parse.ts';
import { withDrain } from '../core/results.ts';
import { generateHelp } from '../output/help.ts';
import type { PadroneBuilder, PadroneProgram } from '../types/builder.ts';
import type { AnyPadroneCommand, CommandTypesBase, InterceptorStartContext, PadroneCommand } from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { ReplaceOrAppendCommand } from '../util/type-utils.ts';
import { getRootCommand } from '../util/utils.ts';
import { findCommandInTree, passthroughSchema } from './utils.ts';

// ── Types ────────────────────────────────────────────────────────────────

type HelpArgs = { command?: string[]; detail?: string; format?: string; all?: boolean };

type HelpCommand = PadroneCommand<
  'help',
  '',
  PadroneSchema<HelpArgs>,
  string,
  [],
  [],
  PadroneSchema<HelpArgs>,
  PadroneSchema<HelpArgs>,
  false
>;

export type WithHelp<T> = T extends {
  '~types': {
    programName: infer PN extends string;
    name: infer N extends string;
    parentName: infer PaN extends string;
    argsSchema: infer A extends PadroneSchema;
    result: infer R;
    commands: infer C extends [...AnyPadroneCommand[]];
    async: infer AS extends boolean;
    context: infer CTX;
  };
}
  ? T extends { run: any }
    ? PadroneProgram<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'help', HelpCommand>, any, any, any, AS, CTX>
    : PadroneBuilder<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'help', HelpCommand>, any, any, any, AS, CTX>
  : T;

// ── Helpers ──────────────────────────────────────────────────────────────

type DetailLevel = 'minimal' | 'standard' | 'full';
type FormatLevel = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json' | 'auto';

function getDetailLevel(args: { type: string; key: string[]; value?: string | string[] }[]): DetailLevel | undefined {
  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;
  for (const arg of args) {
    if (arg.type === 'named' && keyIs(arg.key, 'detail')) {
      if (typeof arg.value === 'string' && (arg.value === 'minimal' || arg.value === 'standard' || arg.value === 'full')) return arg.value;
      return 'full';
    }
    if (arg.type === 'alias' && keyIs(arg.key, 'd')) {
      if (typeof arg.value === 'string' && (arg.value === 'minimal' || arg.value === 'standard' || arg.value === 'full')) return arg.value;
      return 'full';
    }
  }
  return undefined;
}

function getFormatLevel(args: { type: string; key: string[]; value?: string | string[] }[]): FormatLevel | undefined {
  const validFormats: FormatLevel[] = ['text', 'ansi', 'console', 'markdown', 'html', 'json', 'auto'];
  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;
  for (const arg of args) {
    if (arg.type === 'named' && keyIs(arg.key, 'format') && typeof arg.value === 'string') {
      if (validFormats.includes(arg.value as FormatLevel)) return arg.value as FormatLevel;
    }
    if (arg.type === 'alias' && keyIs(arg.key, 'f') && typeof arg.value === 'string') {
      if (validFormats.includes(arg.value as FormatLevel)) return arg.value as FormatLevel;
    }
  }
  return undefined;
}

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that adds help support:
 * - `help` command with aliases `h` and `` (empty = executes on root when no subcommand matches)
 * - `--help` / `-h` flags
 * - `<cmd> help` reverse syntax
 * - Default help display when a command has no action
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneHelp())
 * ```
 */
export function padroneHelp(): <T extends CommandTypesBase>(builder: T) => WithHelp<T> {
  return ((builder: any) => {
    let result = builder;

    // Add `help` command with aliases
    result = result.command(['help', 'h'], (c: any) =>
      c
        .configure({ description: 'Display help for a command', hidden: true, autoOutput: true })
        .arguments(passthroughSchema({ command: 'string[]', detail: 'string', format: 'string', all: 'boolean' }), {
          positional: ['...command'],
        })
        .action((args: any, ctx: any) => {
          const rootCommand = getRootCommand(ctx.command);
          resolveAllCommands(rootCommand);
          const commandName = args.command?.join(' ');
          const targetCommand = commandName ? findCommandInTree(commandName, rootCommand) : rootCommand;
          const runtime = getCommandRuntime(ctx.command);
          return generateHelp(rootCommand, targetCommand ?? rootCommand, {
            detail: args.detail,
            format: args.format ?? runtime.format,
            theme: runtime.theme,
            all: args.all,
          });
        }),
    );

    // Interceptor for --help/-h flags, `<cmd> help` reverse syntax, and default help display
    result = result.intercept({
      id: 'padrone:help',
      name: 'padrone:help',
      order: -1000,
      start(ctx: InterceptorStartContext, next: () => unknown) {
        const flag = checkHelpFlags(ctx.input, ctx.command);
        if (!flag) return next();

        const runtime = getCommandRuntime(ctx.command);
        const rootCommand = ctx.command;
        resolveAllCommands(rootCommand);

        const helpText = generateHelp(rootCommand, flag.command ?? rootCommand, {
          detail: flag.detail,
          format: flag.format ?? runtime.format,
          theme: runtime.theme,
          all: flag.all,
        });
        runtime.output(helpText);
        return withDrain({ command: rootCommand, args: undefined, result: helpText });
      },
      parse(ctx: any, next: () => any) {
        const parsed = next();
        // Default help only applies during exec, not parse-only calls
        if (!ctx.state._execMode) return parsed;
        // Default help: command with no action → show its help
        const handleDefaultHelp = (result: any) => {
          const { command } = result;
          const hasSubcommands = command.commands && command.commands.length > 0;
          const hasSchema = command.argsSchema != null;
          const hasUnmatchedTerms = result.positionalArgs?.length > 0 && !command.meta?.positional?.length;
          if (!command.action && (hasSubcommands || !hasSchema) && !hasUnmatchedTerms) {
            const rootCommand = getRootCommand(command);
            resolveAllCommands(rootCommand);
            const runtime = getCommandRuntime(rootCommand);
            const helpText = generateHelp(rootCommand, command, { format: runtime.format, theme: runtime.theme });
            runtime.output(helpText);
            return { command, rawArgs: { '~help': helpText }, positionalArgs: [] };
          }
          return result;
        };
        if (parsed instanceof Promise) return parsed.then(handleDefaultHelp);
        return handleDefaultHelp(parsed);
      },
    });

    return result;
  }) as any;
}

/** Check for --help/-h flags and `<cmd> help` reverse syntax. */
function checkHelpFlags(
  input: string | undefined,
  rootCommand: AnyPadroneCommand,
): { command?: AnyPadroneCommand; detail?: DetailLevel; format?: FormatLevel; all?: boolean } | null {
  if (!input) return null;

  const parts = parseCliInputToParts(input);
  const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
  const args = parts.filter((p) => p.type === 'named' || p.type === 'alias');
  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

  const hasHelpFlag = args.some((p) => (p.type === 'named' && keyIs(p.key, 'help')) || (p.type === 'alias' && keyIs(p.key, 'h')));

  const normalizedTerms = [...terms];
  if (normalizedTerms[0] === rootCommand.name) normalizedTerms.shift();

  // `<cmd> help` reverse syntax (e.g. `greet help` → help for `greet`)
  if (normalizedTerms.length > 0 && normalizedTerms[normalizedTerms.length - 1] === 'help') {
    const commandTerms = normalizedTerms.slice(0, -1);
    if (commandTerms.length > 0) {
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
      return {
        command: targetCommand,
        detail: getDetailLevel(args),
        format: getFormatLevel(args),
        all: args.some((p) => p.type === 'named' && keyIs(p.key, 'all')) || undefined,
      };
    }
  }

  // --help / -h flag
  if (hasHelpFlag) {
    const commandTerms = normalizedTerms.filter((t) => t !== 'help');
    const commandName = commandTerms.join(' ');
    const targetCommand = commandName ? findCommandByName(commandName, rootCommand.commands) : undefined;
    return {
      command: targetCommand,
      detail: getDetailLevel(args),
      format: getFormatLevel(args),
      all: args.some((p) => p.type === 'named' && keyIs(p.key, 'all')) || undefined,
    };
  }

  return null;
}
