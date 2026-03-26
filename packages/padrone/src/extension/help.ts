import { resolveAllCommands } from '../core/commands.ts';
import { thenMaybe } from '../core/results.ts';
import type { HelpDetail, HelpFormat } from '../output/formatter.ts';
import { generateHelp } from '../output/help.ts';
import type { PadroneBuilder, PadroneProgram } from '../types/builder.ts';
import type {
  AnyPadroneBuilder,
  AnyPadroneCommand,
  CommandTypesBase,
  InterceptorParseContext,
  InterceptorParseResult,
  PadroneCommand,
} from '../types/index.ts';
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
  return ((builder: AnyPadroneBuilder) => {
    let result = builder as any;

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
          return generateHelp(rootCommand, targetCommand ?? rootCommand, {
            detail: args.detail,
            format: args.format ?? ctx.runtime.format,
            theme: ctx.runtime.theme,
            all: args.all,
          });
        }),
    );

    result = result.intercept({
      id: 'padrone:help',
      name: 'padrone:help',
      order: -1000,
      parse(ctx: InterceptorParseContext, next: () => InterceptorParseResult) {
        return thenMaybe(next(), (res) => {
          if (!ctx.state._execMode) return res;

          const hasHelpFlag = res.rawArgs.help || res.rawArgs.h;
          const reverseHelp =
            !hasHelpFlag && res.positionalArgs?.length > 0 && res.positionalArgs[res.positionalArgs.length - 1] === 'help';

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

            const helpText = generateHelp(rootCommand, res.command, {
              detail,
              format: format ?? ctx.runtime.format,
              theme: ctx.runtime.theme,
              all,
            });
            ctx.runtime.output(helpText);
            ctx.state._drain = helpText;
            return res;
          }

          // Default help: command with no action → show its help (only during exec, not parse-only calls)
          if (ctx.state._execMode && !ctx.state._drain) {
            const { command } = res;
            const hasSubcommands = command.commands && command.commands.length > 0;
            const hasSchema = command.argsSchema != null;
            const hasUnmatchedTerms = res.positionalArgs?.length > 0 && !command.meta?.positional?.length;
            if (!command.action && (hasSubcommands || !hasSchema) && !hasUnmatchedTerms) {
              const rootCommand = getRootCommand(command);
              resolveAllCommands(rootCommand);
              const helpText = generateHelp(rootCommand, command, { format: ctx.runtime.format, theme: ctx.runtime.theme });
              ctx.runtime.output(helpText);
              ctx.state._drain = helpText;
              return res;
            }
          }

          return res;
        });
      },
    });

    return result;
  }) as any;
}
