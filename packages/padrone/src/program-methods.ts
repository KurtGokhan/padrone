import type { Schema } from 'ai';
import { parsePositionalConfig } from './args.ts';
import { checkBuiltinCommands } from './builtins.ts';
import {
  errorResult,
  findCommandByName,
  getCommandRuntime,
  makeThenable,
  noopIndicator,
  resolveAllCommands,
  runPluginChain,
  thenMaybe,
  warnIfUnexpectedAsync,
  withDrain,
  withPromiseDrain,
} from './command-utils.ts';
import type { ShellType } from './completion.ts';
import { RoutingError } from './errors.ts';
import type { ExecContext } from './exec.ts';
import { collectPlugins, errorResultWithSignal, execCommand } from './exec.ts';
import { generateHelp } from './help.ts';
import { parseCliInputToParts } from './parse.ts';
import { createReplIterator } from './repl-loop.ts';
import type {
  AnyPadroneCommand,
  AnyPadroneProgram,
  PadroneActionContext,
  PadroneAPI,
  PadroneReplPreferences,
  PluginExecuteContext,
  PluginExecuteResult,
} from './types.ts';
import { getVersion } from './utils.ts';
import { coreValidateForParse } from './validate.ts';

type ProgramContext = ExecContext & {
  evalCommand: AnyPadroneProgram['eval'];
};

export function createProgramMethods(ctx: ProgramContext) {
  const { rootCommand, builder, evalCommand } = ctx;

  // A never-aborted signal for contexts that don't need signal handling (parse, run).
  const inertSignal = new AbortController().signal;

  const createActionContext = (cmd: AnyPadroneCommand): Omit<PadroneActionContext, 'signal'> => ({
    runtime: getCommandRuntime(cmd),
    command: cmd,
    program: builder as any,
    progress: noopIndicator,
  });

  const stringify: AnyPadroneProgram['stringify'] = (command = '' as any, args) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, rootCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new RoutingError(`Command "${command ?? ''}" not found`);

    const parts: string[] = [];

    if (commandObj.path) parts.push(commandObj.path);

    const positionalConfig = commandObj.meta?.positional ? parsePositionalConfig(commandObj.meta.positional) : [];
    const positionalNames = new Set(positionalConfig.map((p) => p.name));

    if (args && typeof args === 'object') {
      for (const { name, variadic } of positionalConfig) {
        const value = (args as Record<string, unknown>)[name];
        if (value === undefined) continue;

        if (variadic && Array.isArray(value)) {
          for (const v of value) {
            const vStr = String(v);
            if (vStr.includes(' ')) parts.push(`"${vStr}"`);
            else parts.push(vStr);
          }
        } else {
          const argStr = String(value);
          if (argStr.includes(' ')) parts.push(`"${argStr}"`);
          else parts.push(argStr);
        }
      }

      const stringifyValue = (key: string, value: unknown) => {
        if (value === undefined) return;

        if (typeof value === 'boolean') {
          if (value) parts.push(`--${key}`);
          else parts.push(`--no-${key}`);
        } else if (Array.isArray(value)) {
          for (const v of value) {
            const vStr = String(v);
            if (vStr.includes(' ')) parts.push(`--${key}="${vStr}"`);
            else parts.push(`--${key}=${vStr}`);
          }
        } else if (typeof value === 'object' && value !== null) {
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            stringifyValue(`${key}.${nestedKey}`, nestedValue);
          }
        } else if (typeof value === 'string') {
          if (value.includes(' ')) parts.push(`--${key}="${value}"`);
          else parts.push(`--${key}=${value}`);
        } else {
          parts.push(`--${key}=${value}`);
        }
      };

      for (const [key, value] of Object.entries(args)) {
        if (value === undefined || positionalNames.has(key)) continue;
        stringifyValue(key, value);
      }
    }

    return parts.join(' ');
  };

  const run: AnyPadroneProgram['run'] = (command, args) => {
    try {
      const commandObj = typeof command === 'string' ? findCommandByName(command, rootCommand.commands) : (command as AnyPadroneCommand);
      if (!commandObj) throw new RoutingError(`Command "${command ?? ''}" not found`);
      if (!commandObj.action) throw new RoutingError(`Command "${commandObj.path}" has no action`, { command: commandObj.path });

      const state: Record<string, unknown> = {};
      const executeCtx: PluginExecuteContext = { command: commandObj, args, state, signal: inertSignal };

      const coreExecute = (): PluginExecuteResult => {
        const actionCtx = createActionContext(commandObj);
        const result = commandObj.action!(executeCtx.args as any, { ...actionCtx, signal: inertSignal });
        return { result };
      };

      const commandObjPlugins = collectPlugins(commandObj, rootCommand);
      const executedOrPromise = runPluginChain('execute', commandObjPlugins, executeCtx, coreExecute);

      const toResult = (e: PluginExecuteResult) => withDrain({ command: commandObj as any, args: args as any, result: e.result });

      if (executedOrPromise instanceof Promise) {
        return executedOrPromise.then(toResult).catch((err: unknown) => errorResult(err, { command: commandObj, args })) as any;
      }
      return toResult(executedOrPromise);
    } catch (err) {
      return errorResult(err) as any;
    }
  };

  const tool: AnyPadroneProgram['tool'] = () => {
    resolveAllCommands(rootCommand);
    const helpText = generateHelp(rootCommand, undefined, { format: 'text' });

    const description = `Run a command. Pass the full command string including arguments. Use "help <command>" for detailed usage.\n\n${helpText}`;

    return {
      type: 'function',
      name: rootCommand.name,
      strict: true,
      title: rootCommand.description,
      description,
      inputExamples: [{ input: { command: '<command> [positionals...] [arguments...]' } }],
      inputSchema: {
        [Symbol.for('vercel.ai.schema') as keyof Schema & symbol]: true,
        jsonSchema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          additionalProperties: false,
        },
        _type: undefined as unknown as { command: string },
        validate: (value) => {
          const command = (value as any)?.command;
          if (typeof command === 'string') return { success: true, value: { command } };
          return { success: false, error: new Error('Expected an object with command property as string.') };
        },
      } satisfies Schema<{ command: string }> as Schema<{ command: string }>,
      needsApproval: async (input) => {
        const parsed = await parse(input.command);
        if (typeof parsed.command.needsApproval === 'function') return parsed.command.needsApproval(parsed.args);
        if (parsed.command.needsApproval != null) return !!parsed.command.needsApproval;
        return !!parsed.command.mutation;
      },
      execute: async (input) => {
        const output: string[] = [];
        const errors: string[] = [];
        const result = await evalCommand(input.command, {
          autoOutput: false,
          runtime: {
            output: (...args) => output.push(args.map(String).join(' ')),
            error: (text) => errors.push(text),
            interactive: 'unsupported',
            format: 'text',
          },
        });
        return { result: result.result, logs: output.join('\n'), error: errors.join('\n') };
      },
    };
  };

  const replActiveRef = { value: false };
  const replFn = (options?: PadroneReplPreferences) =>
    createReplIterator({ existingCommand: rootCommand, evalCommand, replActiveRef }, options);

  const cli: AnyPadroneProgram['cli'] = (cliOptions) => {
    try {
      const runtime = getCommandRuntime(rootCommand);
      const resolvedInput = (runtime.argv().join(' ') || undefined) as string | undefined;

      const builtin = checkBuiltinCommands(resolvedInput, rootCommand);

      if (cliOptions?.repl !== false && builtin?.type === 'repl') {
        const replPrefs: PadroneReplPreferences = {
          ...(typeof cliOptions?.repl === 'object' ? cliOptions.repl : {}),
          scope: builtin.scope,
          autoOutput: (typeof cliOptions?.repl === 'object' ? cliOptions.repl.autoOutput : undefined) ?? cliOptions?.autoOutput,
        };
        const repl = replFn(replPrefs);
        const drainRepl = async () => {
          const { value } = await repl.drain();
          return withDrain({ command: rootCommand, args: undefined, result: value }) as any;
        };
        return withPromiseDrain(drainRepl()) as any;
      }

      if (cliOptions?.mcp !== false && builtin?.type === 'mcp') {
        const basePrefs = typeof cliOptions?.mcp === 'object' ? cliOptions.mcp : {};
        const mcpPrefs = {
          ...basePrefs,
          transport: builtin.transport ?? basePrefs.transport,
          port: builtin.port ?? basePrefs.port,
          host: builtin.host ?? basePrefs.host,
          basePath: builtin.basePath ?? basePrefs.basePath,
        };
        const startMcp = async () => {
          const { startMcpServer } = await import('./mcp.ts');
          await startMcpServer(builder as any, rootCommand, evalCommand, mcpPrefs);
          return withDrain({ command: rootCommand, args: undefined, result: undefined }) as any;
        };
        return withPromiseDrain(startMcp()) as any;
      }

      if (cliOptions?.serve !== false && builtin?.type === 'serve') {
        const basePrefs = typeof cliOptions?.serve === 'object' ? cliOptions.serve : {};
        const servePrefs = {
          ...basePrefs,
          port: builtin.port ?? basePrefs.port,
          host: builtin.host ?? basePrefs.host,
          basePath: builtin.basePath ?? basePrefs.basePath,
        };
        const startServe = async () => {
          const { startServeServer } = await import('./serve.ts');
          await startServeServer(builder as any, rootCommand, evalCommand, servePrefs);
          return withDrain({ command: rootCommand, args: undefined, result: undefined }) as any;
        };
        return withPromiseDrain(startServe()) as any;
      }

      // Start background update check (non-blocking)
      let updateCheckPromise: Promise<(() => void) | undefined> | undefined;
      if (rootCommand.updateCheck) {
        const hasNoUpdateCheckFlag =
          resolvedInput &&
          parseCliInputToParts(resolvedInput).some((p) => p.type === 'named' && p.key.length === 1 && p.key[0] === 'no-update-check');
        if (!hasNoUpdateCheckFlag) {
          const currentVersion = getVersion(rootCommand.version);
          updateCheckPromise = import('./update-check.ts').then(({ createUpdateChecker }) =>
            createUpdateChecker(rootCommand.name, currentVersion, rootCommand.updateCheck!, runtime),
          );
        }
      }

      const result = execCommand(resolvedInput, ctx, cliOptions, 'hard');

      if (updateCheckPromise) {
        if (result instanceof Promise) {
          return withPromiseDrain(
            result
              .then(async (r) => {
                const showUpdateNotification = await updateCheckPromise;
                showUpdateNotification?.();
                return r;
              })
              .catch((err: unknown) => errorResultWithSignal(err)),
          ) as any;
        }
        updateCheckPromise.then((show) => show?.());
      }

      if (result instanceof Promise) return withPromiseDrain(result.catch((err: unknown) => errorResultWithSignal(err))) as any;
      return makeThenable(result);
    } catch (err) {
      return makeThenable(errorResultWithSignal(err)) as any;
    }
  };

  const find: AnyPadroneProgram['find'] = (command) => {
    if (typeof command !== 'string') return findCommandByName(command.path, rootCommand.commands) as any;
    return findCommandByName(command, rootCommand.commands) as any;
  };

  const parse: AnyPadroneProgram['parse'] = (input) => {
    const state: Record<string, unknown> = {};

    const parseCtx = { input: input as string | undefined, command: rootCommand, state, signal: inertSignal };
    const coreParse = () => {
      const { command, rawArgs, args } = ctx.parseCommandFn(parseCtx.input);
      return { command, rawArgs, positionalArgs: args };
    };

    const rootPlugins = rootCommand.plugins ?? [];
    const parsedOrPromise = runPluginChain('parse', rootPlugins, parseCtx, coreParse);

    const continueAfterParse = (parsed: any) => {
      const { command } = parsed;
      const commandPlugins = collectPlugins(command, rootCommand);
      const validateCtx = {
        command,
        rawArgs: parsed.rawArgs,
        positionalArgs: parsed.positionalArgs,
        state,
        signal: inertSignal,
      };

      const coreValidate = () => coreValidateForParse(command, validateCtx.rawArgs, validateCtx.positionalArgs, rootCommand);
      const validatedOrPromise = runPluginChain('validate', commandPlugins, validateCtx, coreValidate);

      return warnIfUnexpectedAsync(
        thenMaybe(validatedOrPromise, (v: any) => ({ command: command as any, args: v.args, argsResult: v.argsResult })),
        command,
      );
    };

    return makeThenable(thenMaybe(parsedOrPromise, continueAfterParse)) as any;
  };

  const help: AnyPadroneProgram['help'] = (command, prefs) => {
    resolveAllCommands(rootCommand);
    const commandObj = !command
      ? rootCommand
      : typeof command === 'string'
        ? findCommandByName(command, rootCommand.commands)
        : (command as AnyPadroneCommand);
    if (!commandObj) throw new RoutingError(`Command "${command ?? ''}" not found`);
    const runtime = getCommandRuntime(rootCommand);
    return generateHelp(rootCommand, commandObj, {
      ...prefs,
      format: prefs?.format ?? runtime.format,
      theme: prefs?.theme ?? runtime.theme,
    });
  };

  const api: AnyPadroneProgram['api'] = () => {
    resolveAllCommands(rootCommand);
    function buildApi(command: AnyPadroneCommand) {
      const runCommand = ((args) => run(command, args).result) as PadroneAPI<AnyPadroneCommand>;
      if (!command.commands) return runCommand;
      for (const cmd of command.commands) runCommand[cmd.name] = buildApi(cmd);
      return runCommand;
    }
    return buildApi(rootCommand);
  };

  const completion: AnyPadroneProgram['completion'] = async (shell) => {
    resolveAllCommands(rootCommand);
    const { generateCompletionOutput } = await import('./completion.ts');
    return generateCompletionOutput(rootCommand, shell as ShellType | undefined);
  };

  const mcp: AnyPadroneProgram['mcp'] = async (prefs) => {
    resolveAllCommands(rootCommand);
    const { startMcpServer } = await import('./mcp.ts');
    return startMcpServer(builder as any, rootCommand, evalCommand, prefs);
  };

  const serve: AnyPadroneProgram['serve'] = async (prefs) => {
    resolveAllCommands(rootCommand);
    const { startServeServer } = await import('./serve.ts');
    return startServeServer(builder as any, rootCommand, evalCommand, prefs);
  };

  return {
    find,
    parse,
    stringify,
    run,
    eval: evalCommand,
    cli,
    tool,
    repl: replFn,
    api,
    help,
    completion,
    mcp,
    serve,
  };
}
