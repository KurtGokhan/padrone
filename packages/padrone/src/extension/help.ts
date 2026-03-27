import { resolveAllCommands } from '../core/commands.ts';
import { defineInterceptor } from '../core/interceptors.ts';
import { thenMaybe } from '../core/results.ts';
import type { HelpDetail, HelpFormat } from '../output/formatter.ts';
import { generateHelp } from '../output/help.ts';
import type { AnyPadroneBuilder, CommandTypesBase, PadroneCommand } from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { WithCommand } from '../util/type-utils.ts';
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
  ['h', ''],
  PadroneSchema<HelpArgs>,
  PadroneSchema<HelpArgs>,
  false
>;

export type WithHelp<T> = WithCommand<T, 'help', HelpCommand>;

// ── Interceptor ─────────────────────────────────────────────────────────

const helpInterceptor = defineInterceptor({ id: 'padrone:help', name: 'padrone:help', order: -1000 }, () => {
  let helpText: string | undefined;
  let showDefaultHelp = false;

  return {
    parse(ctx, next) {
      return thenMaybe(next(), (res) => {
        const hasHelpFlag = res.rawArgs.help || res.rawArgs.h;
        const reverseHelp = !hasHelpFlag && res.positionalArgs?.length > 0 && res.positionalArgs[res.positionalArgs.length - 1] === 'help';

        if (hasHelpFlag || reverseHelp) {
          delete res.rawArgs.help;
          delete res.rawArgs.h;

          const detail = res.rawArgs.detail as HelpDetail | undefined;
          const format = res.rawArgs.format as HelpFormat | undefined;
          const all = res.rawArgs.all as boolean | undefined;
          delete res.rawArgs.detail;
          delete res.rawArgs.format;
          delete res.rawArgs.all;
          delete res.rawArgs.d;
          delete res.rawArgs.f;

          const rootCommand = getRootCommand(res.command);
          resolveAllCommands(rootCommand);

          helpText = generateHelp(rootCommand, res.command, {
            detail,
            format: format ?? ctx.runtime.format,
            theme: ctx.runtime.theme,
            all,
          });
          return res;
        }

        // Track whether the parsed command has no action (for default help in execute phase)
        if (helpText === undefined) {
          const { command } = res;
          const hasSubcommands = command.commands && command.commands.length > 0;
          const hasSchema = command.argsSchema != null;
          const hasUnmatchedTerms = res.positionalArgs?.length > 0 && !command.meta?.positional?.length;
          if (!command.action && (hasSubcommands || !hasSchema) && !hasUnmatchedTerms) {
            showDefaultHelp = true;
          }
        }

        return res;
      });
    },
    validate(_ctx, next) {
      if (helpText !== undefined) return { args: undefined as any, argsResult: { value: undefined } as any };
      return next();
    },
    execute(ctx, next) {
      if (helpText !== undefined) return { result: helpText };
      if (showDefaultHelp) {
        const rootCommand = getRootCommand(ctx.command);
        resolveAllCommands(rootCommand);
        return { result: generateHelp(rootCommand, ctx.command, { format: ctx.runtime.format, theme: ctx.runtime.theme }) };
      }
      return next();
    },
  };
});

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
  return ((builder: AnyPadroneBuilder) =>
    builder
      .command(['help', 'h'], (c) =>
        c
          .configure({ description: 'Display help for a command', hidden: true })
          .arguments(passthroughSchema({ command: 'string[]', detail: 'string', format: 'string', all: 'boolean' }), {
            positional: ['...command'],
          })
          .action((args, ctx) => {
            const rootCommand = getRootCommand(ctx.command);
            resolveAllCommands(rootCommand);
            const commandName = args.command?.join(' ');
            const targetCommand = commandName ? findCommandInTree(commandName, rootCommand) : rootCommand;
            return generateHelp(rootCommand, targetCommand ?? rootCommand, {
              detail: args.detail as HelpDetail,
              format: (args.format as HelpFormat) ?? ctx.runtime.format,
              theme: ctx.runtime.theme,
              all: args.all,
            });
          }),
      )
      .intercept(helpInterceptor)) as any;
}
