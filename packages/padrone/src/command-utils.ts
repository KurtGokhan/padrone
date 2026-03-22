import { extractSchemaMetadata } from './args.ts';
import { type PadroneProgressIndicator, type ResolvedPadroneRuntime, resolveRuntime } from './runtime.ts';
import type { Thenable } from './type-utils.ts';
import type {
  AnyPadroneCommand,
  PadronePlugin,
  PadroneSchema,
  PluginErrorContext,
  PluginErrorResult,
  PluginShutdownContext,
  PluginStartContext,
} from './types.ts';

/**
 * Brands a schema as async, signaling that its `validate()` may return a Promise.
 * When an async-branded schema is passed to `.arguments()`, `.configFile()`, or `.env()`,
 * the command's `parse()` and `cli()` will return Promises.
 *
 * @example
 * ```ts
 * const schema = asyncSchema(z.object({
 *   name: z.string(),
 * }).check(async (data) => {
 *   // async validation logic
 * }));
 *
 * const program = createPadrone('app')
 *   .command('greet', (c) => c.arguments(schema).action((args) => args.name));
 *
 * // parse() now returns Promise<PadroneParseResult>
 * const result = await program.parse('greet --name world');
 * ```
 */
export function asyncSchema<T extends PadroneSchema>(schema: T): T & { '~async': true } {
  return Object.assign(schema, { '~async': true as const });
}

export const commandSymbol = Symbol('padrone_command');

export const noop = <TRes>() => undefined as TRes;

/** Config keys that are merged when overriding a command. */
export const configKeys = [
  'title',
  'description',
  'version',
  'deprecated',
  'hidden',
  'needsApproval',
  'autoOutput',
  'updateCheck',
] as const;

/**
 * Merges an existing command with an override.
 * - Config fields are shallow-merged (new overrides old).
 * - Action, arguments, meta, config schema, env schema are taken from the override if set.
 * - Subcommands are recursively merged by name.
 */
export function mergeCommands(existing: AnyPadroneCommand, override: AnyPadroneCommand): AnyPadroneCommand {
  const merged: AnyPadroneCommand = { ...existing };

  // Merge config fields
  for (const key of configKeys) {
    if (override[key] !== undefined) (merged as any)[key] = override[key];
  }

  // Override fields: take from override if explicitly set (not inherited from existing via spread)
  if (override.action !== existing.action) merged.action = override.action;
  if (override.argsSchema !== existing.argsSchema) merged.argsSchema = override.argsSchema;
  if (override.meta !== existing.meta) merged.meta = override.meta;
  if (override.configSchema !== existing.configSchema) merged.configSchema = override.configSchema;
  if (override.envSchema !== existing.envSchema) merged.envSchema = override.envSchema;
  if (override.configFiles !== existing.configFiles) merged.configFiles = override.configFiles;
  if (override.isAsync !== existing.isAsync) merged.isAsync = override.isAsync || existing.isAsync;
  if (override.runtime !== existing.runtime) merged.runtime = override.runtime;
  if (override.plugins !== existing.plugins) merged.plugins = override.plugins;
  if (override.aliases !== existing.aliases) merged.aliases = override.aliases;
  if (override.progress !== existing.progress) merged.progress = override.progress;

  // Recursively merge subcommands by name
  if (override.commands) {
    const baseCommands = [...(existing.commands || [])];
    for (const overrideChild of override.commands) {
      const existingIndex = baseCommands.findIndex((c) => c.name === overrideChild.name);
      if (existingIndex >= 0) {
        baseCommands[existingIndex] = mergeCommands(baseCommands[existingIndex]!, overrideChild);
      } else {
        baseCommands.push(overrideChild);
      }
    }
    merged.commands = baseCommands;
  }

  return merged;
}

/**
 * Maps over a value that may or may not be a Promise.
 * If the value is a Promise, chains with `.then()`. Otherwise, calls the function synchronously.
 * This preserves sync behavior for sync schemas and async behavior for async schemas.
 */
export function thenMaybe<T, U>(value: T | Promise<T>, fn: (v: T) => U | Promise<U>): U | Promise<U> {
  if (value instanceof Promise) return value.then(fn);
  return fn(value);
}

/**
 * Makes a sync result object thenable by adding `.then()`, `.catch()`, and `.finally()` methods.
 * If the value is already a Promise, returns it as-is.
 * This allows users to write `await program.cli()` or `program.cli().then(...)` regardless of sync/async.
 *
 * The `.then()` resolves with a plain copy (without thenable methods) to avoid infinite
 * recursive unwrapping by the Promise resolution algorithm.
 */
export function makeThenable<T>(value: T | Promise<T>): Thenable<T> {
  if (value instanceof Promise) return value as any;
  if (value !== null && typeof value === 'object' && !('then' in value)) {
    const toPlain = () => {
      const plain = { ...value } as any;
      delete plain.then;
      delete plain.catch;
      delete plain.finally;
      return plain as T;
    };
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable shim for sync results
    (value as any).then = (onfulfilled?: (v: T) => any, onrejected?: (reason: any) => any) => {
      try {
        const result = onfulfilled ? onfulfilled(toPlain()) : toPlain();
        return Promise.resolve(result);
      } catch (err) {
        if (onrejected) return Promise.resolve(onrejected(err));
        return Promise.reject(err);
      }
    };
    (value as any).catch = (onrejected?: (reason: any) => any) => (value as any).then(undefined, onrejected);
    (value as any).finally = (onfinally?: () => void) =>
      (value as any).then(
        (v: any) => {
          onfinally?.();
          return v;
        },
        (err: any) => {
          onfinally?.();
          throw err;
        },
      );
  }
  return value as any;
}

/**
 * Wraps a Promise to include a `drain()` method at the top level.
 * This allows `await promise.drain()` without first awaiting the promise.
 * Since cli/eval never reject, this just delegates to the resolved result's `drain()`.
 */
export function withPromiseDrain<T extends Promise<any>>(promise: T): T & { drain: () => Promise<any> } {
  (promise as any).drain = async () => {
    const resolved = await promise;
    return resolved.drain();
  };
  return promise as any;
}

export function isIterator(value: unknown): value is Iterator<unknown> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value && typeof (value as any)[Symbol.iterator] === 'function';
}

export function isAsyncIterator(value: unknown): value is AsyncIterator<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as any)[Symbol.asyncIterator] === 'function'
  );
}

/**
 * Writes a command's return value to output, handling promises, iterators, and async iterators.
 * Values are passed directly to the output function without stringification —
 * runtimes like Node/Bun already format objects via console.log.
 * Returns void or a Promise depending on whether async consumption is needed.
 */
export function outputValue(value: unknown, output: (...args: unknown[]) => void): void | Promise<void> {
  if (value == null) return;

  // Async iterator — consume and output each yielded value
  if (isAsyncIterator(value)) {
    return (async () => {
      const iter = (value as any)[Symbol.asyncIterator]();
      while (true) {
        const { done, value: item } = await iter.next();
        if (done) break;
        if (item != null) output(item);
      }
    })();
  }

  // Sync iterator (but not a plain string/array which also have Symbol.iterator)
  if (typeof value !== 'string' && !Array.isArray(value) && isIterator(value)) {
    const iter = (value as any)[Symbol.iterator]();
    while (true) {
      const { done, value: item } = iter.next();
      if (done) break;
      if (item != null) output(item);
    }
    return;
  }

  // Promise — await then output
  if (value instanceof Promise) {
    return value.then((resolved) => outputValue(resolved, output));
  }

  // Pass value directly — runtime handles formatting
  output(value);
}

/**
 * Resolves a result value by unwrapping Promises and collecting iterables into arrays.
 * This is the runtime counterpart of the `Drained<T>` type.
 */
export async function drainValue(value: unknown): Promise<unknown> {
  // Unwrap promises first
  if (value instanceof Promise) {
    return drainValue(await value);
  }

  // Async iterator — collect into array
  if (isAsyncIterator(value)) {
    const items: unknown[] = [];
    const iter = (value as any)[Symbol.asyncIterator]();
    while (true) {
      const { done, value: item } = await iter.next();
      if (done) break;
      items.push(item);
    }
    return items;
  }

  // Sync iterator (but not string/array)
  if (typeof value !== 'string' && !Array.isArray(value) && isIterator(value)) {
    const items: unknown[] = [];
    const iter = (value as any)[Symbol.iterator]();
    while (true) {
      const { done, value: item } = iter.next();
      if (done) break;
      items.push(item);
    }
    return items;
  }

  return value;
}

/**
 * Attaches a `drain()` method to a command result object.
 * If the result has an `error` field, `drain()` returns `{ error }`.
 * Otherwise, resolves the result (unwrapping Promises, collecting iterables), catches errors,
 * and returns a discriminated union `{ value } | { error }` that never throws.
 */
export function withDrain<T extends Record<string, unknown>>(obj: T): T & { drain: () => Promise<any> } {
  (obj as any).drain = async () => {
    if ('error' in obj && obj.error !== undefined) {
      return { error: obj.error };
    }
    try {
      const value = await drainValue(obj.result);
      return { value };
    } catch (err) {
      return { error: err };
    }
  };
  return obj as any;
}

/**
 * Creates an error command result with a `drain()` that returns the error.
 */
export function errorResult(error: unknown, partial?: { command?: unknown; args?: unknown; argsResult?: unknown }) {
  return withDrain({
    error,
    result: undefined,
    command: partial?.command,
    args: partial?.args,
    argsResult: partial?.argsResult,
  });
}

/**
 * Runs a plugin chain for a given phase using the onion/middleware pattern.
 * Plugins are sorted by `order` (ascending, stable), then composed so that
 * the first plugin in sorted order is the outermost wrapper.
 * If no plugins handle this phase, `core` is called directly.
 */
export function runPluginChain<TCtx, TResult>(
  phase: 'start' | 'parse' | 'validate' | 'execute' | 'error' | 'shutdown',
  plugins: PadronePlugin[],
  ctx: TCtx,
  core: () => TResult | Promise<TResult>,
): TResult | Promise<TResult> {
  // Filter to plugins that have a handler for this phase, preserve insertion order
  const phasePlugins = plugins.filter((p) => p[phase]);
  if (phasePlugins.length === 0) return core();

  // Stable sort by order (lower = outermost). Equal order preserves registration order.
  phasePlugins.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Build chain from inside out: last plugin wraps core, first plugin is outermost
  let next = core;
  for (let i = phasePlugins.length - 1; i >= 0; i--) {
    const handler = phasePlugins[i]![phase]! as unknown as (
      ctx: TCtx,
      next: () => TResult | Promise<TResult>,
    ) => TResult | Promise<TResult>;
    const prevNext = next;
    next = () => handler(ctx, prevNext);
  }

  return next();
}

/**
 * Wraps a pipeline with start → error → shutdown lifecycle hooks.
 * - `start` plugins wrap the pipeline (onion pattern, root plugins only).
 * - On error: `error` plugins run (can transform/suppress the error).
 * - Always: `shutdown` plugins run (success or failure).
 */
export function wrapWithLifecycle<T>(
  plugins: PadronePlugin[],
  command: AnyPadroneCommand,
  state: Record<string, unknown>,
  input: string | undefined,
  pipeline: () => T | Promise<T>,
  wrapErrorResult?: (result: unknown) => T,
): T | Promise<T> {
  const hasStart = plugins.some((p) => p.start);
  const hasError = plugins.some((p) => p.error);
  const hasShutdown = plugins.some((p) => p.shutdown);

  const cleanupProgress = (error?: unknown, result?: unknown) => {
    const indicator = state._progress as PadroneProgressIndicator | undefined;
    if (indicator) {
      // If there's no progress config (lazy/manual indicator), just stop it silently
      const hasProgressConfig = '_progressMsg' in state;
      if (!hasProgressConfig) {
        indicator.stop();
      } else if (error !== undefined) {
        const fallback = error instanceof Error ? error.message : String(error);
        const { message: errorMsg, indicator: errorIcon } = resolveProgressMessage(state._progressError, error, fallback);
        indicator.fail(errorMsg, errorIcon !== undefined ? { indicator: errorIcon } : undefined);
      } else {
        const { message: successMsg, indicator: successIcon } = resolveProgressMessage(state._progressSuccess, result);
        indicator.succeed(successMsg, successIcon !== undefined ? { indicator: successIcon } : undefined);
      }
      (state._restoreOutput as (() => void) | undefined)?.();
      state._progress = undefined;
      state._restoreOutput = undefined;
    }
  };

  // Fast path: no lifecycle plugins — still need progress cleanup
  if (!hasStart && !hasError && !hasShutdown) {
    let result: T | Promise<T>;
    try {
      result = pipeline();
    } catch (e) {
      cleanupProgress(e);
      throw e;
    }
    if (result instanceof Promise) {
      return result.then(
        (r) => {
          cleanupProgress();
          return r;
        },
        (e) => {
          cleanupProgress(e);
          throw e;
        },
      );
    }
    cleanupProgress();
    return result;
  }

  const runShutdown = (error?: unknown, result?: unknown) => {
    cleanupProgress(error);
    if (!hasShutdown) return;
    const ctx: PluginShutdownContext = { command, state, error, result };
    return runPluginChain('shutdown', plugins, ctx, () => {});
  };

  const runError = (error: unknown): T | Promise<T> => {
    if (!hasError) {
      const s = runShutdown(error);
      if (s instanceof Promise)
        return s.then(() => {
          throw error;
        });
      throw error;
    }
    const ctx: PluginErrorContext = { command, state, error };
    const errorResult = runPluginChain('error', plugins, ctx, (): PluginErrorResult => ({ error }));
    return thenMaybe(errorResult, (er) => {
      if (er.error !== undefined) {
        const s = runShutdown(er.error);
        return thenMaybe(s as void | Promise<void>, () => {
          throw er.error;
        });
      }
      const wrapped = wrapErrorResult ? wrapErrorResult(er.result) : (er.result as T);
      const s = runShutdown(undefined, wrapped);
      return thenMaybe(s as void | Promise<void>, () => wrapped);
    });
  };

  const handleSuccess = (result: T): T | Promise<T> => {
    const s = runShutdown(undefined, result);
    if (s instanceof Promise) return s.then(() => result);
    return result;
  };

  // Run start phase wrapping the pipeline
  const startCtx: PluginStartContext = { command, state, input };
  let result: T | Promise<T>;
  try {
    result = (hasStart ? runPluginChain('start', plugins, startCtx, pipeline) : pipeline()) as T | Promise<T>;
  } catch (e) {
    return runError(e);
  }

  if (result instanceof Promise) {
    return result.then(handleSuccess, runError);
  }

  return handleSuccess(result);
}

/**
 * Resolves the runtime for a command by walking up the parent chain.
 * Returns a fully resolved runtime with all defaults filled in.
 */
export function getCommandRuntime(cmd: AnyPadroneCommand): ResolvedPadroneRuntime {
  let current: AnyPadroneCommand | undefined = cmd;
  while (current) {
    if (current.runtime) return resolveRuntime(current.runtime);
    current = current.parent;
  }
  return resolveRuntime();
}

/** No-op progress indicator returned when the runtime doesn't provide a `progress` factory. */
const noopIndicator: PadroneProgressIndicator = {
  update() {},
  succeed() {},
  fail() {},
  stop() {},
  pause() {},
  resume() {},
};

/** Creates a progress indicator from the runtime, or returns a no-op if unavailable. */
export function createProgress(
  runtime: ResolvedPadroneRuntime,
  message: string,
  options?: import('./runtime.ts').PadroneProgressOptions,
): PadroneProgressIndicator {
  return runtime.progress?.(message, options) ?? noopIndicator;
}

/**
 * Creates a lazy progress indicator that defers real indicator creation until first use.
 * This allows `ctx.progress` to work even without `.progress()` config, as long as the
 * runtime provides a progress factory.
 */
export function createLazyIndicator(runtime: ResolvedPadroneRuntime, state: Record<string, unknown>): PadroneProgressIndicator {
  if (!runtime.progress) return noopIndicator;

  let real: PadroneProgressIndicator | undefined;
  const ensure = (message?: string) => {
    if (!real) {
      real = runtime.progress!(message ?? '', undefined);
      state._progress = real;
    }
    return real;
  };

  return {
    update(msg) {
      ensure(msg).update(msg);
    },
    succeed(msg) {
      if (real) real.succeed(msg);
    },
    fail(msg) {
      if (real) real.fail(msg);
    },
    stop() {
      if (real) real.stop();
    },
    pause() {
      if (real) real.pause();
    },
    resume() {
      if (real) real.resume();
    },
  };
}

/**
 * Resolves a progress message field (static or callback) into the arguments for succeed/fail.
 * Handles string, null, `{ message, indicator }` objects, and callback functions.
 */
export function resolveProgressMessage(
  field: unknown,
  value: unknown,
  fallback?: string,
): { message: string | null | undefined; indicator?: string } {
  const raw = typeof field === 'function' ? (field as (v: unknown) => unknown)(value) : field;
  if (raw === undefined) return { message: fallback };
  if (raw === null || typeof raw === 'string') return { message: raw };
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { message?: string | null; indicator?: string };
    return { message: obj.message, indicator: obj.indicator };
  }
  return { message: fallback };
}

export { noopIndicator };

export function isAsyncBranded(schema: unknown): boolean {
  return !!schema && typeof schema === 'object' && '~async' in schema && (schema as any)['~async'] === true;
}

export function hasInteractiveConfig(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;
  return m.interactive === true || Array.isArray(m.interactive) || m.optionalInteractive === true || Array.isArray(m.optionalInteractive);
}

export function warnIfUnexpectedAsync<T>(value: T, command: AnyPadroneCommand): T {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return value;
  if (value instanceof Promise && !command.isAsync) {
    const runtime = getCommandRuntime(command);
    runtime.error(
      `[padrone] Command "${command.path || command.name}" returned a Promise from validation, ` +
        `but was not marked as async. Use \`.async()\` on the builder or \`asyncSchema()\` to brand your schema. ` +
        `Without this, TypeScript will infer a sync return type and the result will be a Promise at runtime.`,
    );
  }
  return value;
}

/**
 * Recursively re-paths a command tree under a new parent path, updating parent references.
 */
export function repathCommandTree(
  cmd: AnyPadroneCommand,
  newName: string,
  parentPath: string,
  parent: AnyPadroneCommand,
): AnyPadroneCommand {
  const newPath = parentPath ? `${parentPath} ${newName}` : newName;
  const remounted: AnyPadroneCommand = {
    ...cmd,
    name: newName,
    path: newPath,
    parent,
    version: undefined,
  };

  if (cmd.commands?.length) {
    remounted.commands = cmd.commands.map((child) => repathCommandTree(child, child.name, newPath, remounted));
  }

  return remounted;
}

/**
 * Builds a completer function for the REPL from the command tree.
 * Completes command names, subcommand names, option names (--foo), and aliases (-f).
 * Also includes dot-prefixed built-in REPL commands (.exit, .clear, .scope, .help, .history).
 */
export function buildReplCompleter(
  rootCommand: AnyPadroneCommand,
  builtins: {
    inScope?: boolean;
  },
): (line: string) => [string[], string] {
  return (line: string): [string[], string] => {
    const trimmed = line.trimStart();
    const parts = trimmed.split(/\s+/);
    const lastPart = parts[parts.length - 1] ?? '';

    // If we're completing a dot-command
    if (lastPart.startsWith('.')) {
      const dotCmds = ['.exit', '.clear', '.help', '.history'];
      if (rootCommand.commands?.some((c) => c.commands?.length) || builtins.inScope) dotCmds.push('.scope');
      const hits = dotCmds.filter((c) => c.startsWith(lastPart));
      return [hits.length ? hits : dotCmds, lastPart];
    }

    // If we're completing an option (starts with -)
    if (lastPart.startsWith('-')) {
      // Find which command we're in
      const commandParts = parts.slice(0, -1).filter((p) => !p.startsWith('-'));
      let targetCommand = rootCommand;
      for (const part of commandParts) {
        const sub = targetCommand.commands?.find((c) => c.name === part || c.aliases?.includes(part));
        if (sub) targetCommand = sub;
        else break;
      }

      // Get options for this command
      const options: string[] = [];
      if (targetCommand.argsSchema) {
        try {
          const argsMeta = targetCommand.meta?.fields;
          const { flags, aliases } = extractSchemaMetadata(targetCommand.argsSchema, argsMeta, targetCommand.meta?.autoAlias);
          const jsonSchema = targetCommand.argsSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
          if (jsonSchema.type === 'object' && jsonSchema.properties) {
            for (const key of Object.keys(jsonSchema.properties)) {
              options.push(`--${key}`);
            }
            for (const flag of Object.keys(flags)) {
              options.push(`-${flag}`);
            }
            for (const alias of Object.keys(aliases)) {
              options.push(`--${alias}`);
            }
          }
        } catch {
          // Ignore schema parsing errors
        }
      }
      // Add global flags
      options.push('--help', '-h');

      const hits = options.filter((o) => o.startsWith(lastPart));
      return [hits.length ? hits : options, lastPart];
    }

    // Completing command names
    const commandParts = parts.filter((p) => !p.startsWith('-'));
    // Walk into subcommands for all but the last token
    let targetCommand = rootCommand;
    for (let i = 0; i < commandParts.length - 1; i++) {
      const sub = targetCommand.commands?.find((c) => c.name === commandParts[i] || c.aliases?.includes(commandParts[i]!));
      if (sub) targetCommand = sub;
      else break;
    }

    const candidates: string[] = [];

    // Add subcommand names and aliases
    if (targetCommand.commands) {
      for (const cmd of targetCommand.commands) {
        if (!cmd.hidden) {
          candidates.push(cmd.name);
          if (cmd.aliases) candidates.push(...cmd.aliases);
        }
      }
    }

    // Add dot-commands and `..` shorthand at the root level (relative to current scope)
    if (targetCommand === rootCommand) {
      candidates.push('.help', '.exit', '.clear', '.history');
      if (rootCommand.commands?.some((c) => c.commands?.length) || builtins.inScope) candidates.push('.scope');
      if (builtins.inScope) candidates.push('..');
    }

    const hits = candidates.filter((c) => c.startsWith(lastPart));
    return [hits.length ? hits : candidates, lastPart];
  };
}

/**
 * Computes the Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }

  return dp[n]!;
}

/**
 * Finds the closest match from a list of candidates using Levenshtein distance.
 * Returns the suggestion string (e.g. 'Did you mean "deploy"?') or empty string if no good match.
 * Threshold: distance must be at most 40% of the longer string's length (min 1, max 3).
 */
export function suggestSimilar(input: string, candidates: string[]): string {
  if (candidates.length === 0) return '';

  const lower = input.toLowerCase();
  let bestDist = Infinity;
  let bestMatch = '';

  for (const candidate of candidates) {
    const dist = levenshtein(lower, candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = candidate;
    }
  }

  const maxLen = Math.max(input.length, bestMatch.length);
  const threshold = Math.min(3, Math.max(1, Math.ceil(maxLen * 0.4)));

  if (bestDist > 0 && bestDist <= threshold) {
    return `Did you mean "${bestMatch}"?`;
  }

  return '';
}

export function findCommandByName(name: string, commands?: AnyPadroneCommand[]): AnyPadroneCommand | undefined {
  if (!commands) return undefined;

  const foundByName = commands.find((cmd) => cmd.name === name);
  if (foundByName) return foundByName;

  // Check for aliases
  const foundByAlias = commands.find((cmd) => cmd.aliases?.includes(name));
  if (foundByAlias) return foundByAlias;

  for (const cmd of commands) {
    if (cmd.commands && name.startsWith(`${cmd.name} `)) {
      const subCommandName = name.slice(cmd.name.length + 1);
      const subCommand = findCommandByName(subCommandName, cmd.commands);
      if (subCommand) return subCommand;
    }
    // Check aliases for nested commands
    if (cmd.commands && cmd.aliases) {
      for (const alias of cmd.aliases) {
        if (name.startsWith(`${alias} `)) {
          const subCommandName = name.slice(alias.length + 1);
          const subCommand = findCommandByName(subCommandName, cmd.commands);
          if (subCommand) return subCommand;
        }
      }
    }
  }
  return undefined;
}
