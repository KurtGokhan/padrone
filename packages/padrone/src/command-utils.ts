import { extractSchemaMetadata } from './args.ts';
import { type ResolvedPadroneRuntime, resolveRuntime } from './runtime.ts';
import type { AnyPadroneCommand, PadronePlugin, PadroneSchema } from './types.ts';

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
export const configKeys = ['title', 'description', 'version', 'deprecated', 'hidden', 'needsApproval', 'autoOutput'] as const;

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
 * Runs a plugin chain for a given phase using the onion/middleware pattern.
 * Plugins are sorted by `order` (ascending, stable), then composed so that
 * the first plugin in sorted order is the outermost wrapper.
 * If no plugins handle this phase, `core` is called directly.
 */
export function runPluginChain<TCtx, TResult>(
  phase: 'parse' | 'validate' | 'execute',
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
          const { aliases } = extractSchemaMetadata(targetCommand.argsSchema, argsMeta);
          const jsonSchema = targetCommand.argsSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
          if (jsonSchema.type === 'object' && jsonSchema.properties) {
            for (const key of Object.keys(jsonSchema.properties)) {
              options.push(`--${key}`);
            }
            for (const alias of Object.keys(aliases)) {
              options.push(`-${alias}`);
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
