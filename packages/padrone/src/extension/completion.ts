import type { ShellType } from '#src/util/shell-utils.ts';
import { resolveAllCommands } from '../core/commands.ts';
import type { AnyPadroneBuilder, CommandTypesBase, PadroneCommand } from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { WithCommand } from '../util/type-utils.ts';
import { getRootCommand } from '../util/utils.ts';
import { passthroughSchema } from './utils.ts';

// ── Types ────────────────────────────────────────────────────────────────

type CompletionArgs = { shell?: string; setup?: boolean };

type CompletionCommand = PadroneCommand<
  'completion',
  '',
  PadroneSchema<CompletionArgs>,
  string,
  [],
  [],
  PadroneSchema<CompletionArgs>,
  PadroneSchema<CompletionArgs>,
  true
>;

export type WithCompletion<T> = WithCommand<T, 'completion', CompletionCommand>;

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that adds the `completion` command for shell completion script generation.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneCompletion())
 * ```
 */
export function padroneCompletion(): <T extends CommandTypesBase>(builder: T) => WithCompletion<T> {
  return ((builder: AnyPadroneBuilder) =>
    builder.command('completion', (c) =>
      c
        .configure({ description: 'Generate shell completion scripts', hidden: true })
        .arguments(passthroughSchema({ shell: 'string', setup: 'boolean' }), { positional: ['shell'] })
        .async()
        .action(async (args, ctx) => {
          const rootCommand = getRootCommand(ctx.command);
          resolveAllCommands(rootCommand);
          const { detectShell, generateCompletionOutput, setupCompletions } = await import('../feature/completion.ts');
          const shell = args.shell as ShellType;
          const setup = args.setup;
          if (setup) {
            const resolvedShell = shell ?? detectShell();
            if (!resolvedShell) throw new Error('Could not detect shell. Specify one: completion bash --setup');
            const setupResult = setupCompletions(rootCommand.name, resolvedShell);
            return `${setupResult.updated ? 'Updated' : 'Added'} ${rootCommand.name} completions in ${setupResult.file}`;
          }
          return generateCompletionOutput(rootCommand, shell);
        }),
    )) as any;
}
