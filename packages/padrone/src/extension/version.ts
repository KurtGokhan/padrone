import { thenMaybe } from '#src/core/results.ts';
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
import { getRootCommand, getVersion } from '../util/utils.ts';

// ── Types ────────────────────────────────────────────────────────────────

type VersionCommand = PadroneCommand<'version', '', PadroneSchema<void>, string, [], [], PadroneSchema<void>, PadroneSchema<void>, false>;

export type WithVersion<T> = T extends {
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
    ? PadroneProgram<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'version', VersionCommand>, any, any, any, AS, CTX>
    : PadroneBuilder<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'version', VersionCommand>, any, any, any, AS, CTX>
  : T;

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that adds version support:
 * - `version` command
 * - `--version` / `-v` / `-V` flags (root command only)
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneVersion())
 * ```
 */
export function padroneVersion(): <T extends CommandTypesBase>(builder: T) => WithVersion<T> {
  return ((builder: AnyPadroneBuilder) => {
    let result = builder as any;

    result = result.command('version', (c: any) =>
      c.configure({ description: 'Display the version number', hidden: true, autoOutput: true }).action((_args: any, ctx: any) => {
        const rootCommand = getRootCommand(ctx.command);
        return getVersion(rootCommand.version);
      }),
    );

    result = result.intercept({
      id: 'padrone:version',
      name: 'padrone:version',
      order: -1000,
      parse(ctx: InterceptorParseContext, next: () => InterceptorParseResult) {
        return thenMaybe(next(), (res) => {
          if (!ctx.state._execMode) return res;

          const hasVersionFlag = res.rawArgs.version || res.rawArgs.v || res.rawArgs.V;

          // Only show version for root command (no subcommand matched)
          if (hasVersionFlag && !res.command.parent) {
            delete res.rawArgs.version;
            delete res.rawArgs.v;
            delete res.rawArgs.V;

            const version = getVersion(res.command.version);
            ctx.runtime.output(version);
            ctx.state._drain = version;
            return res;
          }

          return res;
        });
      },
    });

    return result;
  }) as any;
}
