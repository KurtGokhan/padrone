import { checkBuiltinFlags } from '../core/builtins.ts';
import { getCommandRuntime, resolveAllCommands } from '../core/commands.ts';
import { withDrain } from '../core/results.ts';
import { generateHelp } from '../output/help.ts';
import type { PadroneBuilder, PadroneProgram } from '../types/builder.ts';
import type { AnyPadroneCommand, CommandTypesBase, InterceptorStartContext, PadroneCommand } from '../types/index.ts';
import type { PadroneSchema } from '../types/schema.ts';
import type { ReplaceOrAppendCommand } from '../util/type-utils.ts';
import { getRootCommand, getVersion } from '../util/utils.ts';

/**
 * Options for the built-in commands extension.
 */
export type PadroneBuiltinsOptions = {
  /** Enable `help` command, `--help` / `-h` flags, and default help for commands without actions. Defaults to `true`. */
  help?: boolean;
  /** Enable `version` command and `--version` / `-v` / `-V` flags. Defaults to `true`. */
  version?: boolean;
  /** Enable `completion` command for shell completion generation. Defaults to `true`. */
  completion?: boolean;
  /** Enable `man` command for man page generation. Defaults to `true`. */
  man?: boolean;
};

// ── Builtin command types ──────────────────────────────────────────────

type HelpArgs = { command?: string[]; detail?: string; format?: string; all?: boolean };
type CompletionArgs = { shell?: string; setup?: boolean };
type ManArgs = { setup?: boolean; remove?: boolean };

type BuiltinCommand<TName extends string, TArgs = void, TAsync extends boolean = false> = PadroneCommand<
  TName,
  '',
  PadroneSchema<TArgs>,
  string,
  [],
  [],
  PadroneSchema<TArgs>,
  PadroneSchema<TArgs>,
  TAsync
>;

// ── Type-level augmentation ────────────────────────────────────────────

type MaybeAppend<
  TCommands extends [...AnyPadroneCommand[]],
  TEnabled extends boolean | undefined,
  TName extends string,
  TArgs,
  TAsync extends boolean = false,
> = [TEnabled] extends [false] ? TCommands : ReplaceOrAppendCommand<TCommands, TName, BuiltinCommand<TName, TArgs, TAsync>>;

// biome-ignore format: cleaner this way
type AppendBuiltins<TCommands extends [...AnyPadroneCommand[]], TOptions extends PadroneBuiltinsOptions> =
  MaybeAppend<
    MaybeAppend<
      MaybeAppend<
        MaybeAppend<
            TCommands, TOptions['help'], 'help', HelpArgs>,
          TOptions['version'], 'version', void>,
      TOptions['completion'], 'completion', CompletionArgs, true>,
    TOptions['man'], 'man', ManArgs, true>;

/** Augments a PadroneBuilder or PadroneProgram with builtin commands appended to its TCommands. */
export type WithPadroneBuiltins<T, TOptions extends PadroneBuiltinsOptions = PadroneBuiltinsOptions> = T extends {
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
    ? PadroneProgram<PN, N, PaN, A, R, AppendBuiltins<C, TOptions>, any, any, any, AS, CTX>
    : PadroneBuilder<PN, N, PaN, A, R, AppendBuiltins<C, TOptions>, any, any, any, AS, CTX>
  : T;

// ── Runtime schemas ────────────────────────────────────────────────────

/** Minimal Standard Schema that passes through known fields, ignoring unknown ones. */
function passthroughSchema(fields: Record<string, 'string' | 'string[]' | 'boolean'>) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'padrone' as const,
      validate: (value: unknown) => {
        const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
        const result: Record<string, unknown> = {};
        for (const [name, type] of Object.entries(fields)) {
          const v = input[name];
          if (v === undefined) continue;
          if (type === 'string[]') {
            if (Array.isArray(v)) result[name] = v.map(String);
            else if (typeof v === 'string') result[name] = [v];
          } else if (type === 'string') {
            if (typeof v === 'string') result[name] = v;
            else if (Array.isArray(v) && v.length > 0) result[name] = String(v[0]);
          } else if (type === 'boolean') {
            result[name] = v === true || v === 'true';
          }
        }
        return { value: result };
      },
    },
  };
}

// ── Extension ──────────────────────────────────────────────────────────

/**
 * Extension that adds Padrone's built-in commands and flags:
 * - `help` command, `--help` / `-h` flags, and default help display
 * - `version` command, `--version` / `-v` / `-V` flags
 * - `completion` command for shell completions
 * - `man` command for man page generation
 *
 * Usage:
 * ```ts
 * const program = createPadrone('my-cli')
 *   .extend(padroneBuiltins())
 * ```
 *
 * Individual builtins can be disabled:
 * ```ts
 * createPadrone('my-cli')
 *   .extend(padroneBuiltins({ completion: false, man: false }))
 * ```
 */
export function padroneBuiltins<const TOptions extends PadroneBuiltinsOptions = PadroneBuiltinsOptions>(
  options?: TOptions,
): <T extends CommandTypesBase>(builder: T) => WithPadroneBuiltins<T, TOptions> {
  const enableHelp = options?.help !== false;
  const enableVersion = options?.version !== false;
  const enableCompletion = options?.completion !== false;
  const enableMan = options?.man !== false;

  return ((builder: any) => {
    let result = builder;

    if (enableHelp) {
      result = result.command('help', (c: any) =>
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
            const runtime = getCommandRuntime(ctx.command);
            return generateHelp(rootCommand, targetCommand ?? rootCommand, {
              detail: args.detail,
              format: args.format ?? runtime.format,
              theme: runtime.theme,
              all: args.all,
            });
          }),
      );
    }

    if (enableVersion) {
      result = result.command('version', (c: any) =>
        c.configure({ description: 'Display the version number', hidden: true, autoOutput: true }).action((_args: any, ctx: any) => {
          const rootCommand = getRootCommand(ctx.command);
          return getVersion(rootCommand.version);
        }),
      );
    }

    if (enableCompletion) {
      result = result.command('completion', (c: any) =>
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
      );
    }

    if (enableMan) {
      result = result.command('man', (c: any) =>
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
      );
    }

    // Interceptor for flag forms: --help/-h, --version/-v/-V, `<cmd> help` reverse syntax
    result = result.intercept({
      name: 'padrone:builtins',
      order: -1000,
      start(ctx: InterceptorStartContext, next: () => unknown) {
        const flag = checkBuiltinFlags(ctx.input, ctx.command);
        if (!flag) return next();

        if (flag.type === 'help' && !enableHelp) return next();
        if (flag.type === 'version' && !enableVersion) return next();

        const runtime = getCommandRuntime(ctx.command);
        const rootCommand = ctx.command;

        if (flag.type === 'help') {
          resolveAllCommands(rootCommand);
          const helpText = generateHelp(rootCommand, flag.command ?? rootCommand, {
            detail: flag.detail,
            format: flag.format ?? runtime.format,
            theme: runtime.theme,
            all: flag.all,
          });
          runtime.output(helpText);
          return withDrain({ command: rootCommand, args: undefined, result: helpText });
        }

        if (flag.type === 'version') {
          const version = getVersion(rootCommand.version);
          runtime.output(version);
          return withDrain({ command: rootCommand, args: undefined, result: version });
        }

        return next();
      },
    });

    return result;
  }) as any;
}

/** Find a command by space-separated name in the command tree. */
function findCommandInTree(name: string, rootCommand: AnyPadroneCommand): AnyPadroneCommand | undefined {
  const parts = name.split(' ').filter(Boolean);
  let current = rootCommand;
  for (const part of parts) {
    const found = current.commands?.find((c) => c.name === part || c.aliases?.includes(part));
    if (!found) return undefined;
    current = found;
  }
  return current;
}
