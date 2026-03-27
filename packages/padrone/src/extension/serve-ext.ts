import { resolveAllCommands } from '../core/commands.ts';
import type { PadroneServePreferences } from '../feature/serve.ts';
import type { AnyPadroneBuilder, CommandTypesBase, PadroneCommand } from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { WithCommand } from '../util/type-utils.ts';
import { getRootCommand } from '../util/utils.ts';
import { passthroughSchema } from './utils.ts';

// ── Types ────────────────────────────────────────────────────────────────

type ServeArgs = { port?: string; host?: string; basePath?: string };

type ServeCommand = PadroneCommand<'serve', '', PadroneSchema<ServeArgs>, void, [], [], true>;

export type WithServe<T> = WithCommand<T, 'serve', ServeCommand>;

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
  return ((builder: AnyPadroneBuilder) =>
    builder.command('serve', (c) =>
      c
        .configure({ description: 'Start a REST HTTP server', hidden: true })
        .arguments(passthroughSchema({ port: 'string', host: 'string', 'base-path': 'string' }))
        .async()
        .action(async (args, ctx) => {
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
