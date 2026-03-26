import { defineInterceptor } from '../core/interceptors.ts';
import { parseCliInputToParts } from '../core/parse.ts';
import { withDrain } from '../core/results.ts';
import type { PadroneBuilder, PadroneProgram } from '../types/builder.ts';
import type {
  AnyPadroneCommand,
  AnyPadroneProgram,
  CommandTypesBase,
  InterceptorStartContext,
  PadroneCommand,
  PadroneReplPreferences,
} from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { ReplaceOrAppendCommand } from '../util/type-utils.ts';
import { passthroughSchema } from './utils.ts';

// ── Types ────────────────────────────────────────────────────────────────

type ReplArgs = { scope?: string };

type ReplCommand = PadroneCommand<
  'repl',
  '',
  PadroneSchema<ReplArgs>,
  void,
  [],
  [],
  PadroneSchema<ReplArgs>,
  PadroneSchema<ReplArgs>,
  true
>;

export type WithRepl<T> = T extends {
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
    ? PadroneProgram<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'repl', ReplCommand>, any, any, any, AS, CTX>
    : PadroneBuilder<PN, N, PaN, A, R, ReplaceOrAppendCommand<C, 'repl', ReplCommand>, any, any, any, AS, CTX>
  : T;

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that adds REPL support:
 * - `repl` command that starts an interactive REPL
 * - `--repl` flag that starts the REPL from any invocation
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneRepl())
 * ```
 */
export function padroneRepl(defaults?: PadroneReplPreferences): <T extends CommandTypesBase>(builder: T) => WithRepl<T> {
  return ((builder: any) => {
    let result = builder;

    result = result.command('repl', (c: any) =>
      c
        .configure({ description: 'Start an interactive REPL', hidden: true })
        .arguments(passthroughSchema({ scope: 'string' }), { positional: ['scope'] })
        .async()
        .action(async (args: any, ctx: any) => {
          const prefs: PadroneReplPreferences = { ...defaults, scope: args.scope ?? defaults?.scope };
          const repl = ctx.program.repl(prefs);
          const { value } = await repl.drain();
          return value;
        }),
    );

    // --repl flag interceptor: starts REPL directly, bypassing normal command routing
    result = result.intercept(createReplInterceptor(defaults));

    return result;
  }) as any;
}

function createReplInterceptor(defaults?: PadroneReplPreferences) {
  return defineInterceptor({ id: 'padrone:repl', name: 'padrone:repl', order: -1000 }, () => ({
    start(ctx: InterceptorStartContext, next: () => unknown) {
      // If repl is disabled via cli preferences, skip
      if (ctx.state._replPrefs === false) return next();

      const replInfo = checkReplFlag(ctx.input, ctx.command);
      if (!replInfo) return next();

      // Start REPL directly using the program from exec state
      const program = ctx.state._program as AnyPadroneProgram | undefined;
      if (!program?.repl) return next();

      const cliPrefs = typeof ctx.state._replPrefs === 'object' ? (ctx.state._replPrefs as PadroneReplPreferences) : undefined;
      const prefs: PadroneReplPreferences = { ...defaults, ...cliPrefs, scope: replInfo.scope ?? cliPrefs?.scope ?? defaults?.scope };

      // Return a Promise so the pipeline awaits the REPL result
      return program
        .repl(prefs)
        .drain()
        .then((r: any) => withDrain({ command: ctx.command, args: undefined, result: r.value }));
    },
  }));
}

/** Check for --repl flag in input. */
function checkReplFlag(input: string | undefined, rootCommand: AnyPadroneCommand): { scope?: string } | null {
  if (!input) return null;

  const parts = parseCliInputToParts(input);
  const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
  const args = parts.filter((p) => p.type === 'named');
  const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

  const hasReplFlag = args.some((p) => p.type === 'named' && keyIs(p.key, 'repl'));
  if (!hasReplFlag) return null;

  const normalizedTerms = [...terms];
  if (normalizedTerms[0] === rootCommand.name) normalizedTerms.shift();

  const scope = normalizedTerms.length > 0 ? normalizedTerms.join(' ') : undefined;
  return { scope };
}
