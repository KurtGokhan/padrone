import { resolveAllCommands } from '../core/commands.ts';
import type { PadroneBuilder, PadroneProgram } from '../types/builder.ts';
import type { AnyPadroneCommand, CommandTypesBase, PadroneCommand } from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { ReplaceOrAppendCommand } from '../util/type-utils.ts';
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

export type WithCompletion<T> = T extends {
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
    ? PadroneProgram<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'completion', CompletionCommand>, any, any, any, AS, CTX>
    : PadroneBuilder<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'completion', CompletionCommand>, any, any, any, AS, CTX>
  : T;

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
  return ((builder: any) =>
    builder.command('completion', (c: any) =>
      c
        .configure({ description: 'Generate shell completion scripts', hidden: true, autoOutput: true })
        .arguments(passthroughSchema({ shell: 'string', setup: 'boolean' }), { positional: ['shell'] })
        .async()
        .action(async (args: any, ctx: any) => {
          const rootCommand = getRootCommand(ctx.command);
          resolveAllCommands(rootCommand);
          const { detectShell, generateCompletionOutput, setupCompletions } = await import('../feature/completion.ts');
          const shell = args.shell;
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
