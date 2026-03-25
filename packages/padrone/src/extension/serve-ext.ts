import { resolveAllCommands } from '../core/commands.ts';
import type { PadroneServePreferences } from '../feature/serve.ts';
import type { PadroneBuilder, PadroneProgram } from '../types/builder.ts';
import type { AnyPadroneCommand, CommandTypesBase, PadroneCommand } from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { ReplaceOrAppendCommand } from '../util/type-utils.ts';
import { getRootCommand } from '../util/utils.ts';
import { passthroughSchema } from './utils.ts';

// ── Types ────────────────────────────────────────────────────────────────

type ServeArgs = { port?: string; host?: string; basePath?: string };

type ServeCommand = PadroneCommand<
  'serve',
  '',
  PadroneSchema<ServeArgs>,
  void,
  [],
  [],
  PadroneSchema<ServeArgs>,
  PadroneSchema<ServeArgs>,
  true
>;

export type WithServe<T> = T extends {
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
    ? PadroneProgram<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'serve', ServeCommand>, any, any, any, AS, CTX>
    : PadroneBuilder<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'serve', ServeCommand>, any, any, any, AS, CTX>
  : T;

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that adds the `serve` command for starting a REST HTTP server.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneServe())
 * ```
 */
export function padroneServe(defaults?: PadroneServePreferences): <T extends CommandTypesBase>(builder: T) => WithServe<T> {
  return ((builder: any) =>
    builder.command('serve', (c: any) =>
      c
        .configure({ description: 'Start a REST HTTP server', hidden: true })
        .arguments(passthroughSchema({ port: 'string', host: 'string', 'base-path': 'string' }))
        .async()
        .action(async (args: any, ctx: any) => {
          const rootCommand = getRootCommand(ctx.command);
          resolveAllCommands(rootCommand);
          const { startServeServer } = await import('../feature/serve.ts');
          const port = args.port ? parseInt(args.port, 10) : undefined;
          const prefs: PadroneServePreferences = {
            ...defaults,
            port: port && !Number.isNaN(port) ? port : defaults?.port,
            host: args.host ?? defaults?.host,
            basePath: args['base-path'] ?? defaults?.basePath,
          };
          await startServeServer(ctx.program, rootCommand, ctx.program.eval, prefs);
        }),
    )) as any;
}
