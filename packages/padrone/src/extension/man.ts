import { resolveAllCommands } from '../core/commands.ts';
import type { PadroneBuilder, PadroneProgram } from '../types/builder.ts';
import type { AnyPadroneCommand, CommandTypesBase, PadroneCommand } from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { ReplaceOrAppendCommand } from '../util/type-utils.ts';
import { getRootCommand } from '../util/utils.ts';
import { passthroughSchema } from './utils.ts';

// ── Types ────────────────────────────────────────────────────────────────

type ManArgs = { setup?: boolean; remove?: boolean };

type ManCommand = PadroneCommand<'man', '', PadroneSchema<ManArgs>, string, [], [], PadroneSchema<ManArgs>, PadroneSchema<ManArgs>, true>;

export type WithMan<T> = T extends {
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
    ? PadroneProgram<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'man', ManCommand>, any, any, any, AS, CTX>
    : PadroneBuilder<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'man', ManCommand>, any, any, any, AS, CTX>
  : T;

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that adds the `man` command for man page generation.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneMan())
 * ```
 */
export function padroneMan(): <T extends CommandTypesBase>(builder: T) => WithMan<T> {
  return ((builder: any) =>
    builder.command('man', (c: any) =>
      c
        .configure({ description: 'Generate man pages', hidden: true, autoOutput: true })
        .arguments(passthroughSchema({ setup: 'boolean', remove: 'boolean' }))
        .async()
        .action(async (args: any, ctx: any) => {
          const rootCommand = getRootCommand(ctx.command);
          resolveAllCommands(rootCommand);
          const { setupManPages, removeManPages, generateDocs } = await import('../docs/index.ts');
          if (args.setup) {
            const setupResult = setupManPages(rootCommand);
            return `${setupResult.updated ? 'Updated' : 'Installed'} ${setupResult.written.length} man page(s) in ${setupResult.dir}`;
          }
          if (args.remove) {
            const removeResult = removeManPages(rootCommand);
            return removeResult.removed.length > 0
              ? `Removed ${removeResult.removed.length} man page(s) from ${removeResult.dir}`
              : 'No man pages found to remove.';
          }
          const docsResult = generateDocs(rootCommand, { format: 'man' });
          return docsResult.pages[0]?.content ?? '';
        }),
    )) as any;
}
