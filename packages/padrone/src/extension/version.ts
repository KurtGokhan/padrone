import { parseCliInputToParts } from '../core/parse.ts';
import { withDrain } from '../core/results.ts';
import type { PadroneBuilder, PadroneProgram } from '../types/builder.ts';
import type { AnyPadroneCommand, CommandTypesBase, InterceptorStartContext, PadroneCommand } from '../types/index.ts';
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
 * - `--version` / `-v` / `-V` flags
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneVersion())
 * ```
 */
export function padroneVersion(): <T extends CommandTypesBase>(builder: T) => WithVersion<T> {
  return ((builder: any) => {
    let result = builder;

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
      start(ctx: InterceptorStartContext, next: () => unknown) {
        const flag = checkVersionFlags(ctx.input, ctx.command);
        if (!flag) return next();

        const rootCommand = ctx.command;
        const runtime = ctx.runtime;
        const version = getVersion(rootCommand.version);
        runtime.output(version);
        return withDrain({ command: rootCommand, args: undefined, result: version });
      },
    });

    return result;
  }) as any;
}

/** Check for --version/-v/-V flags (only for root command, no subcommand terms). */
function checkVersionFlags(input: string | undefined, rootCommand: AnyPadroneCommand): boolean {
  if (!input) return false;

  const parts = parseCliInputToParts(input);
  const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
  const args = parts.filter((p) => p.type === 'named' || p.type === 'alias');
  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

  const hasVersionFlag = args.some(
    (p) => (p.type === 'named' && keyIs(p.key, 'version')) || (p.type === 'alias' && (keyIs(p.key, 'v') || keyIs(p.key, 'V'))),
  );

  const normalizedTerms = [...terms];
  if (normalizedTerms[0] === rootCommand.name) normalizedTerms.shift();

  return hasVersionFlag && normalizedTerms.length === 0;
}
