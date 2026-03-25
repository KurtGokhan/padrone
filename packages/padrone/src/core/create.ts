import { createWrapHandler } from '../feature/wrap.ts';
import type { AnyPadroneCommand, AnyPadroneProgram, PadroneCommand, PadroneInterceptor, PadroneProgram } from '../types/index.ts';
import { commandSymbol, findCommandByName, lazyResolver, mergeCommands, repathCommandTree, resolveCommand } from './commands.ts';
import { RoutingError } from './errors.ts';
import type { ExecContext } from './exec.ts';
import { collectInterceptors, errorResultWithSignal, execCommand } from './exec.ts';
import { createProgramMethods } from './program-methods.ts';
import { hasInteractiveConfig, isAsyncBranded, makeThenable, noop, withPromiseDrain } from './results.ts';
import { parseCommand } from './validate.ts';

export { buildReplCompleter } from './commands.ts';
export { asyncSchema } from './results.ts';

export function createPadrone<TProgramName extends string>(name: TProgramName): PadroneProgram<TProgramName, '', ''> {
  return createPadroneBuilder({ name, path: '', commands: [] } as any) as unknown as PadroneProgram<TProgramName, '', ''>;
}

export function createPadroneBuilder<TBuilder extends PadroneProgram = PadroneProgram>(
  inputCommand: AnyPadroneCommand,
): TBuilder & { [commandSymbol]: AnyPadroneCommand } {
  // Re-parent direct subcommands so getCommandRuntime walks to the current root,
  // not a stale parent from before .runtime()/.configure()/etc.
  const existingCommand =
    inputCommand.commands?.length && inputCommand.commands.some((c) => c.parent && c.parent !== inputCommand)
      ? {
          ...inputCommand,
          commands: inputCommand.commands.map((c) => (c.parent && c.parent !== inputCommand ? { ...c, parent: inputCommand } : c)),
        }
      : inputCommand;

  const parseCommandFn = (input: string | undefined) => parseCommand(input, existingCommand, findCommandByName);
  const collectInterceptorsFn = (cmd: AnyPadroneCommand) => collectInterceptors(cmd, existingCommand);

  // Execution context shared by exec and program methods.
  // `builder` is assigned after the builder object is created (forward ref resolved at runtime only).
  const execCtx: ExecContext = {
    rootCommand: existingCommand,
    builder: undefined as any,
    parseCommandFn,
    collectInterceptorsFn,
  };

  const evalCommand: AnyPadroneProgram['eval'] = (input, evalOptions) => {
    try {
      const result = execCommand(input as string, execCtx, evalOptions, 'soft');
      if (result instanceof Promise) return withPromiseDrain(result.catch((err: unknown) => errorResultWithSignal(err))) as any;
      return makeThenable(result);
    } catch (err) {
      return makeThenable(errorResultWithSignal(err)) as any;
    }
  };

  const programMethods = createProgramMethods({
    ...execCtx,
    evalCommand,
  });

  const builder = {
    extend(extension: (builder: any) => any) {
      return extension(builder);
    },
    configure(config) {
      return createPadroneBuilder({ ...existingCommand, ...config }) as any;
    },
    runtime(runtimeConfig) {
      return createPadroneBuilder({ ...existingCommand, runtime: { ...existingCommand.runtime, ...runtimeConfig } }) as any;
    },
    async() {
      return createPadroneBuilder({ ...existingCommand, isAsync: true }) as any;
    },
    context(transform?: (ctx: unknown) => unknown) {
      if (!transform) return createPadroneBuilder({ ...existingCommand }) as any;
      const existing = existingCommand.contextTransform;
      const composed = existing ? (ctx: unknown) => transform(existing(ctx)) : transform;
      return createPadroneBuilder({ ...existingCommand, contextTransform: composed }) as any;
    },
    arguments(schema, meta) {
      const resolvedArgs = typeof schema === 'function' ? schema(existingCommand.argsSchema as any) : schema;
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedArgs) || hasInteractiveConfig(meta);
      return createPadroneBuilder({ ...existingCommand, argsSchema: resolvedArgs, meta, isAsync }) as any;
    },
    configFile(file, schema) {
      const configFiles = file === undefined ? undefined : Array.isArray(file) ? file : [file];
      const resolvedConfig = typeof schema === 'function' ? schema(existingCommand.argsSchema) : (schema ?? existingCommand.argsSchema);
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedConfig);
      return createPadroneBuilder({ ...existingCommand, configFiles, configSchema: resolvedConfig as any, isAsync }) as any;
    },
    env(schema) {
      const resolvedEnv = typeof schema === 'function' ? schema(existingCommand.argsSchema) : schema;
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedEnv);
      return createPadroneBuilder({ ...existingCommand, envSchema: resolvedEnv as any, isAsync }) as any;
    },
    progress(config = true) {
      const progress = typeof config === 'boolean' || typeof config === 'string' ? config : { ...config };
      return createPadroneBuilder({ ...existingCommand, progress }) as any;
    },
    action(handler = noop) {
      const baseHandler = existingCommand.action ?? noop;
      return createPadroneBuilder({
        ...existingCommand,
        action: (args: any, ctx: any) => (handler as any)(args, ctx, baseHandler),
      }) as any;
    },
    wrap(config) {
      const handler = createWrapHandler(config, existingCommand.argsSchema as any, existingCommand.meta?.positional);
      return createPadroneBuilder({ ...existingCommand, action: handler }) as any;
    },
    command(nameOrNames, builderFn) {
      const name = Array.isArray(nameOrNames) ? nameOrNames[0] : nameOrNames;
      const aliases = Array.isArray(nameOrNames) && nameOrNames.length > 1 ? (nameOrNames.slice(1) as string[]) : undefined;

      const existingSubcommand = existingCommand.commands?.find((c) => c.name === name) as AnyPadroneCommand | undefined;
      if (existingSubcommand) resolveCommand(existingSubcommand);

      const initialCommand: AnyPadroneCommand = existingSubcommand
        ? { ...existingSubcommand, aliases: aliases ?? existingSubcommand.aliases, parent: existingCommand }
        : ({
            name,
            path: existingCommand.path ? `${existingCommand.path} ${name}` : name,
            aliases,
            parent: existingCommand,
            '~types': {} as any,
          } satisfies PadroneCommand);

      if (builderFn) {
        const lazyCmd: AnyPadroneCommand = { ...initialCommand };
        (lazyCmd as any)[lazyResolver] = (target: AnyPadroneCommand) => {
          const b = createPadroneBuilder(target);
          const commandObj = ((builderFn(b as any) as unknown as typeof b)?.[commandSymbol] as AnyPadroneCommand) ?? target;
          const mergedCommandObj = existingSubcommand ? mergeCommands(existingSubcommand, commandObj) : commandObj;
          Object.assign(target, mergedCommandObj);
        };

        const commands = existingCommand.commands || [];
        const existingIndex = commands.findIndex((c) => c.name === name);
        const updatedCommands =
          existingIndex >= 0
            ? [...commands.slice(0, existingIndex), lazyCmd, ...commands.slice(existingIndex + 1)]
            : [...commands, lazyCmd];

        return createPadroneBuilder({ ...existingCommand, commands: updatedCommands }) as any;
      }

      const commands = existingCommand.commands || [];
      const existingIndex = commands.findIndex((c) => c.name === name);
      const updatedCommands =
        existingIndex >= 0
          ? [...commands.slice(0, existingIndex), initialCommand, ...commands.slice(existingIndex + 1)]
          : [...commands, initialCommand];

      return createPadroneBuilder({ ...existingCommand, commands: updatedCommands }) as any;
    },

    mount(nameOrNames: string | readonly string[], program: unknown, options?: { context?: (ctx: unknown) => unknown }) {
      const name = Array.isArray(nameOrNames) ? nameOrNames[0] : nameOrNames;
      const aliases = Array.isArray(nameOrNames) && nameOrNames.length > 1 ? (nameOrNames.slice(1) as string[]) : undefined;

      const programCommand = (program as any)[commandSymbol] as AnyPadroneCommand | undefined;
      if (!programCommand) throw new RoutingError('Cannot mount: not a valid Padrone program');

      const remounted = repathCommandTree(programCommand, name, existingCommand.path || '', existingCommand);
      remounted.aliases = aliases;

      if (options?.context) {
        const existing = remounted.contextTransform;
        remounted.contextTransform = existing ? (ctx: unknown) => existing(options.context!(ctx)) : options.context;
      }

      const existingSubcommand = existingCommand.commands?.find((c) => c.name === name) as AnyPadroneCommand | undefined;
      const mergedCommandObj = existingSubcommand ? mergeCommands(existingSubcommand, remounted) : remounted;

      const commands = existingCommand.commands || [];
      const existingIndex = commands.findIndex((c) => c.name === name);
      const updatedCommands =
        existingIndex >= 0
          ? [...commands.slice(0, existingIndex), mergedCommandObj, ...commands.slice(existingIndex + 1)]
          : [...commands, mergedCommandObj];

      return createPadroneBuilder({ ...existingCommand, commands: updatedCommands }) as any;
    },

    intercept(interceptor: PadroneInterceptor<any, any>) {
      return createPadroneBuilder({
        ...existingCommand,
        interceptors: [...(existingCommand.interceptors ?? []), interceptor],
      }) as any;
    },

    updateCheck(config = {}) {
      return createPadroneBuilder({ ...existingCommand, updateCheck: config }) as any;
    },

    ...programMethods,

    '~types': {} as any,

    [commandSymbol]: existingCommand,
  } satisfies AnyPadroneProgram & { [commandSymbol]: AnyPadroneCommand } as any;

  // Fix forward reference: execCtx.builder needs to reference the builder after it's created
  execCtx.builder = builder;

  return builder as TBuilder & { [commandSymbol]: AnyPadroneCommand };
}
