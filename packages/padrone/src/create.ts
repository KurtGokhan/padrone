import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Schema } from 'ai';
import { extractSchemaMetadata, parsePositionalConfig, preprocessArgs } from './args.ts';
import { generateCompletionOutput, type ShellType } from './completion.ts';
import { generateHelp } from './help.ts';
import { getNestedValue, parseCliInputToParts, setNestedValue } from './parse.ts';
import {
  createTerminalReplSession,
  type InteractivePromptConfig,
  REPL_SIGINT,
  type ReplSessionConfig,
  type ResolvedPadroneRuntime,
  resolveRuntime,
} from './runtime.ts';
import type {
  AnyPadroneCommand,
  AnyPadroneProgram,
  PadroneAPI,
  PadroneCommand,
  PadroneEvalPreferences,
  PadronePlugin,
  PadroneProgram,
  PadroneReplPreferences,
  PadroneSchema,
  PluginExecuteContext,
  PluginExecuteResult,
  PluginParseContext,
  PluginParseResult,
  PluginValidateContext,
  PluginValidateResult,
} from './types.ts';
import { getVersion } from './utils.ts';
import { createWrapHandler } from './wrap.ts';

const commandSymbol = Symbol('padrone_command');

const noop = <TRes>() => undefined as TRes;

/** Config keys that are merged when overriding a command. */
const configKeys = ['title', 'description', 'version', 'deprecated', 'hidden', 'needsApproval'] as const;

/**
 * Merges an existing command with an override.
 * - Config fields are shallow-merged (new overrides old).
 * - Handler, arguments, meta, config schema, env schema are taken from the override if set.
 * - Subcommands are recursively merged by name.
 */
function mergeCommands(existing: AnyPadroneCommand, override: AnyPadroneCommand): AnyPadroneCommand {
  const merged: AnyPadroneCommand = { ...existing };

  // Merge config fields
  for (const key of configKeys) {
    if (override[key] !== undefined) (merged as any)[key] = override[key];
  }

  // Override fields: take from override if explicitly set (not inherited from existing via spread)
  if (override.handler !== existing.handler) merged.handler = override.handler;
  if (override.arguments !== existing.arguments) merged.arguments = override.arguments;
  if (override.meta !== existing.meta) merged.meta = override.meta;
  if (override.config !== existing.config) merged.config = override.config;
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
function thenMaybe<T, U>(value: T | Promise<T>, fn: (v: T) => U | Promise<U>): U | Promise<U> {
  if (value instanceof Promise) return value.then(fn);
  return fn(value);
}

/**
 * Runs a plugin chain for a given phase using the onion/middleware pattern.
 * Plugins are sorted by `order` (ascending, stable), then composed so that
 * the first plugin in sorted order is the outermost wrapper.
 * If no plugins handle this phase, `core` is called directly.
 */
function runPluginChain<TCtx, TResult>(
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

/**
 * Resolves the runtime for a command by walking up the parent chain.
 * Returns a fully resolved runtime with all defaults filled in.
 */
function getCommandRuntime(cmd: AnyPadroneCommand): ResolvedPadroneRuntime {
  let current: AnyPadroneCommand | undefined = cmd;
  while (current) {
    if (current.runtime) return resolveRuntime(current.runtime);
    current = current.parent;
  }
  return resolveRuntime();
}

function isAsyncBranded(schema: unknown): boolean {
  return !!schema && typeof schema === 'object' && '~async' in schema && (schema as any)['~async'] === true;
}

function hasInteractiveConfig(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;
  return m.interactive === true || Array.isArray(m.interactive) || m.optionalInteractive === true || Array.isArray(m.optionalInteractive);
}

/**
 * Auto-detect the prompt type for a field based on its JSON schema property definition.
 */
function detectPromptConfig(name: string, propSchema: Record<string, any> | undefined, description?: string): InteractivePromptConfig {
  const message = description || propSchema?.description || name;

  if (!propSchema) return { name, message, type: 'input' };

  if (propSchema.type === 'boolean') {
    return { name, message, type: 'confirm', default: propSchema.default };
  }

  if (propSchema.enum) {
    return {
      name,
      message,
      type: 'select',
      choices: propSchema.enum.map((v: unknown) => ({ label: String(v), value: v })),
      default: propSchema.default,
    };
  }

  if (propSchema.type === 'array' && propSchema.items?.enum) {
    return {
      name,
      message,
      type: 'multiselect',
      choices: propSchema.items.enum.map((v: unknown) => ({ label: String(v), value: v })),
      default: propSchema.default,
    };
  }

  if (propSchema.format === 'password') {
    return { name, message, type: 'password', default: propSchema.default };
  }

  return { name, message, type: 'input', default: propSchema.default };
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
      if (targetCommand.arguments) {
        try {
          const argsMeta = targetCommand.meta?.fields;
          const { aliases } = extractSchemaMetadata(targetCommand.arguments, argsMeta);
          const jsonSchema = targetCommand.arguments['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
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

/**
 * Prompt for missing interactive fields.
 * Runs after env/config preprocessing and before schema validation.
 *
 * When `force` is true, all configured interactive fields are prompted even if they already
 * have values. The current values are used as defaults in the prompts.
 */
async function promptInteractiveFields(
  data: Record<string, unknown>,
  command: AnyPadroneCommand,
  runtime: ResolvedPadroneRuntime,
  force?: boolean,
): Promise<Record<string, unknown>> {
  if (!runtime.prompt) return data;

  const meta = command.meta;
  const interactiveConfig = meta?.interactive;
  const optionalInteractiveConfig = meta?.optionalInteractive;
  if (!interactiveConfig && !optionalInteractiveConfig) return data;

  // Extract JSON schema properties for prompt type detection
  let jsonProperties: Record<string, any> = {};
  let requiredFields: Set<string> = new Set();
  if (command.arguments) {
    try {
      const jsonSchema = command.arguments['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
      if (jsonSchema.type === 'object' && jsonSchema.properties) {
        jsonProperties = jsonSchema.properties;
      }
      if (Array.isArray(jsonSchema.required)) {
        requiredFields = new Set(jsonSchema.required);
      }
    } catch {
      // Ignore schema parsing errors
    }
  }

  const fieldDescriptions: Record<string, string | undefined> = {};
  if (meta?.fields) {
    for (const [key, value] of Object.entries(meta.fields)) {
      if (value?.description) fieldDescriptions[key] = value.description;
    }
  }

  const result = { ...data };

  // Determine which required interactive fields to prompt
  let fieldsToPrompt: string[] = [];
  if (interactiveConfig === true) {
    if (force) {
      // When forced, prompt all required fields regardless of current value
      fieldsToPrompt = [...requiredFields];
    } else {
      // All required fields that are missing
      fieldsToPrompt = [...requiredFields].filter((name) => result[name] === undefined);
    }
  } else if (Array.isArray(interactiveConfig)) {
    if (force) {
      fieldsToPrompt = [...interactiveConfig];
    } else {
      fieldsToPrompt = interactiveConfig.filter((name) => result[name] === undefined);
    }
  }

  // Prompt each required interactive field
  for (const field of fieldsToPrompt) {
    const config = detectPromptConfig(field, jsonProperties[field], fieldDescriptions[field]);
    // When forced, use the current value as the default
    if (force && result[field] !== undefined) {
      config.default = result[field];
    }
    result[field] = await runtime.prompt(config);
  }

  // Determine optional interactive fields
  let optionalFields: string[] = [];
  if (optionalInteractiveConfig === true) {
    if (force) {
      // When forced, include all non-required fields (even those with values)
      const allKeys = Object.keys(jsonProperties);
      optionalFields = allKeys.filter((name) => !requiredFields.has(name));
    } else {
      // All non-required fields that are still missing
      const allKeys = Object.keys(jsonProperties);
      optionalFields = allKeys.filter((name) => !requiredFields.has(name) && result[name] === undefined);
    }
  } else if (Array.isArray(optionalInteractiveConfig)) {
    if (force) {
      optionalFields = [...optionalInteractiveConfig];
    } else {
      optionalFields = optionalInteractiveConfig.filter((name) => result[name] === undefined);
    }
  }

  // Show multiselect for optional fields, then prompt selected ones
  if (optionalFields.length > 0) {
    const selected = (await runtime.prompt({
      name: '_optionalFields',
      message: 'Would you also like to configure:',
      type: 'multiselect',
      choices: optionalFields.map((f) => {
        const label = fieldDescriptions[f] || jsonProperties[f]?.description || f;
        const currentValue = result[f];
        // When forced, show current value next to the label for fields that already have values
        const displayLabel = force && currentValue !== undefined ? `${label} (current: ${currentValue})` : label;
        return { label: displayLabel, value: f };
      }),
    })) as string[];

    if (Array.isArray(selected)) {
      for (const field of selected) {
        const config = detectPromptConfig(field, jsonProperties[field], fieldDescriptions[field]);
        // When forced, use the current value as the default
        if (force && result[field] !== undefined) {
          config.default = result[field];
        }
        result[field] = await runtime.prompt(config);
      }
    }
  }

  return result;
}

function warnIfUnexpectedAsync<T>(value: T, command: AnyPadroneCommand): T {
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
function repathCommandTree(cmd: AnyPadroneCommand, newName: string, parentPath: string, parent: AnyPadroneCommand): AnyPadroneCommand {
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
  function findCommandByName(name: string, commands?: AnyPadroneCommand[]): AnyPadroneCommand | undefined {
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

  const find: AnyPadroneProgram['find'] = (command) => {
    if (typeof command !== 'string') return findCommandByName(command.path, existingCommand.commands) as any;
    return findCommandByName(command, existingCommand.commands) as any;
  };

  /**
   * Parses CLI input to find the command and extract raw arguments without validation.
   */
  const parseCommand = (input: string | undefined) => {
    input ??= getCommandRuntime(existingCommand).argv().join(' ') || undefined;
    if (!input) {
      // No input: check for default '' command
      const defaultCommand = findCommandByName('', existingCommand.commands);
      if (defaultCommand) {
        return { command: defaultCommand, rawArgs: {} as Record<string, unknown>, args: [] as string[], unmatchedTerms: [] as string[] };
      }
      return { command: existingCommand, rawArgs: {} as Record<string, unknown>, args: [] as string[], unmatchedTerms: [] as string[] };
    }

    const parts = parseCliInputToParts(input);

    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'arg').map((p) => p.value);

    let curCommand: AnyPadroneCommand | undefined = existingCommand;
    let unmatchedTerms: string[] = [];

    // If the first term is the program name, skip it
    if (terms[0] === existingCommand.name) terms.shift();

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i] || '';
      const found = findCommandByName(term, curCommand.commands);

      if (found) {
        curCommand = found;
      } else {
        unmatchedTerms = terms.slice(i);
        args.unshift(...unmatchedTerms);
        break;
      }
    }

    // If no unmatched terms remain, check for a default '' subcommand.
    // This handles both the root level (no input) and nested commands (e.g., "advanced" with a '' subcommand).
    if (unmatchedTerms.length === 0 && curCommand.commands?.length) {
      const defaultCommand = findCommandByName('', curCommand.commands);
      if (defaultCommand) {
        curCommand = defaultCommand;
      }
    }

    if (!curCommand) return { command: existingCommand, rawArgs: {} as Record<string, unknown>, args, unmatchedTerms };

    // Extract argument metadata from the nested arguments object in meta
    const argsMeta = curCommand.meta?.fields;
    const schemaMetadata = curCommand.arguments ? extractSchemaMetadata(curCommand.arguments, argsMeta) : { aliases: {} };
    const { aliases } = schemaMetadata;

    // Get array arguments from schema (arrays are always variadic)
    const arrayArguments = new Set<string>();
    if (curCommand.arguments) {
      try {
        const jsonSchema = curCommand.arguments['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;
        if (jsonSchema.type === 'object' && jsonSchema.properties) {
          for (const [key, prop] of Object.entries(jsonSchema.properties as Record<string, any>)) {
            if (prop?.type === 'array') arrayArguments.add(key);
          }
        }
      } catch {
        // Ignore schema parsing errors
      }
    }

    const argParts = parts.filter((p) => p.type === 'named' || p.type === 'alias');
    const rawArgs: Record<string, unknown> = {};

    for (const arg of argParts) {
      // For aliases, resolve to the full key name (aliases map single char to full key name)
      // arg.key is now a string[] - for aliases it's always single element like ['v']
      const key: string[] = arg.type === 'alias' && arg.key.length === 1 && aliases[arg.key[0]!] ? [aliases[arg.key[0]!]!] : arg.key;

      const rootKey = key[0]!;

      // Handle negated boolean arguments (--no-verbose)
      if (arg.type === 'named' && arg.negated) {
        setNestedValue(rawArgs, key, false);
        continue;
      }

      const value = arg.value ?? true;

      // Handle array arguments - accumulate values into arrays (arrays are always variadic)
      if (arrayArguments.has(rootKey)) {
        const existing = getNestedValue(rawArgs, key);
        if (existing !== undefined) {
          if (Array.isArray(existing)) {
            if (Array.isArray(value)) {
              existing.push(...value);
            } else {
              existing.push(value);
            }
          } else {
            if (Array.isArray(value)) {
              setNestedValue(rawArgs, key, [existing, ...value]);
            } else {
              setNestedValue(rawArgs, key, [existing, value]);
            }
          }
        } else {
          setNestedValue(rawArgs, key, Array.isArray(value) ? value : [value]);
        }
      } else {
        setNestedValue(rawArgs, key, value);
      }
    }

    return { command: curCommand, rawArgs, args, unmatchedTerms };
  };

  /**
   * Preprocesses raw arguments: applies env/config values and maps positional arguments.
   * This is the first half of argument processing, before validation.
   */
  const buildCommandArgs = (
    command: AnyPadroneCommand,
    rawArgs: Record<string, unknown>,
    args: string[],
    context?: { envData?: Record<string, unknown>; configData?: Record<string, unknown> },
  ): Record<string, unknown> => {
    // Apply preprocessing (env and config bindings)
    const preprocessedArgs = preprocessArgs(rawArgs, {
      aliases: {}, // Already resolved aliases in parseCommand
      envData: context?.envData,
      configData: context?.configData,
    });

    // Parse positional configuration
    const positionalConfig = command.meta?.positional ? parsePositionalConfig(command.meta.positional) : [];

    // Map positional arguments to their named arguments
    if (positionalConfig.length > 0) {
      let argIndex = 0;
      for (const { name, variadic } of positionalConfig) {
        if (argIndex >= args.length) break;

        if (variadic) {
          // Collect remaining args (but leave room for non-variadic args after)
          const remainingPositionals = positionalConfig.slice(positionalConfig.indexOf({ name, variadic }) + 1);
          const nonVariadicAfter = remainingPositionals.filter((p) => !p.variadic).length;
          const variadicEnd = args.length - nonVariadicAfter;
          preprocessedArgs[name] = args.slice(argIndex, variadicEnd);
          argIndex = variadicEnd;
        } else {
          preprocessedArgs[name] = args[argIndex];
          argIndex++;
        }
      }
    }

    return preprocessedArgs;
  };

  /**
   * Validates preprocessed arguments against the command's schema.
   * Returns sync or async result depending on the schema's validate method.
   */
  const validateCommandArgs = (command: AnyPadroneCommand, preprocessedArgs: Record<string, unknown>) => {
    const argsParsed = command.arguments ? command.arguments['~standard'].validate(preprocessedArgs) : { value: preprocessedArgs };

    // Return undefined for args when there's no schema and no meaningful args
    const hasArgs = command.arguments || Object.keys(preprocessedArgs).length > 0;

    const buildResult = (parsed: StandardSchemaV1.Result<unknown>) => ({
      args: parsed.issues ? undefined : hasArgs ? (parsed.value as any) : undefined,
      argsResult: parsed as any,
    });

    return thenMaybe(argsParsed, buildResult);
  };

  /**
   * Preprocesses and validates raw arguments against the command's schema.
   * Returns sync or async result depending on the schema's validate method.
   */
  const validateArgs = (
    command: AnyPadroneCommand,
    rawArgs: Record<string, unknown>,
    args: string[],
    context?: { envData?: Record<string, unknown>; configData?: Record<string, unknown> },
  ) => {
    const preprocessedArgs = buildCommandArgs(command, rawArgs, args, context);
    return validateCommandArgs(command, preprocessedArgs);
  };

  const parse: AnyPadroneProgram['parse'] = (input) => {
    const state: Record<string, unknown> = {};

    // Parse phase (with plugins)
    const parseCtx: PluginParseContext = { input: input as string | undefined, command: existingCommand, state };
    const coreParse = (): PluginParseResult => {
      const { command, rawArgs, args } = parseCommand(parseCtx.input);
      return { command, rawArgs, positionalArgs: args };
    };

    // Parse phase: root plugins only
    const rootPlugins = existingCommand.plugins ?? [];
    const parsedOrPromise = runPluginChain('parse', rootPlugins, parseCtx, coreParse);

    const continueAfterParse = (parsed: PluginParseResult) => {
      const { command } = parsed;

      // Validate phase: collected from parent chain
      const commandPlugins = collectPlugins(command);
      const validateCtx: PluginValidateContext = {
        command,
        rawArgs: parsed.rawArgs,
        positionalArgs: parsed.positionalArgs,
        state,
      };

      const coreValidate = (): PluginValidateResult | Promise<PluginValidateResult> => {
        // Resolve env schema: command's own envSchema > inherited from parent/root
        const resolveEnvSchema = (cmd: AnyPadroneCommand): AnyPadroneCommand['envSchema'] => {
          if (cmd.envSchema !== undefined) return cmd.envSchema;
          if (cmd.parent) return resolveEnvSchema(cmd.parent);
          return undefined;
        };
        const envSchema = resolveEnvSchema(command);

        const finalize = (envData: Record<string, unknown> | undefined): PluginValidateResult | Promise<PluginValidateResult> => {
          const validated = validateArgs(command, validateCtx.rawArgs, validateCtx.positionalArgs, { envData });
          return thenMaybe(validated, (v) => v as PluginValidateResult);
        };

        let envData: Record<string, unknown> | undefined;
        if (envSchema) {
          const runtime = getCommandRuntime(existingCommand);
          const rawEnv = runtime.env();
          const envValidated = envSchema['~standard'].validate(rawEnv);

          return thenMaybe(envValidated, (result) => {
            if (!result.issues) {
              envData = result.value as unknown as Record<string, unknown>;
            }
            return finalize(envData);
          });
        }

        return finalize(envData);
      };

      const validatedOrPromise = runPluginChain('validate', commandPlugins, validateCtx, coreValidate);

      return warnIfUnexpectedAsync(
        thenMaybe(validatedOrPromise, (v) => ({
          command: command as any,
          args: v.args,
          argsResult: v.argsResult,
        })),
        command,
      );
    };

    return thenMaybe(parsedOrPromise, continueAfterParse) as any;
  };

  const stringify: AnyPadroneProgram['stringify'] = (command = '' as any, args) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);

    const parts: string[] = [];

    if (commandObj.path) parts.push(commandObj.path);

    // Get positional config to determine which args are positional
    const positionalConfig = commandObj.meta?.positional ? parsePositionalConfig(commandObj.meta.positional) : [];
    const positionalNames = new Set(positionalConfig.map((p) => p.name));

    // Output positional arguments first in order
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

      // Helper to stringify a value with a given key prefix
      const stringifyValue = (key: string, value: unknown) => {
        if (value === undefined) return;

        if (typeof value === 'boolean') {
          if (value) parts.push(`--${key}`);
          else parts.push(`--no-${key}`);
        } else if (Array.isArray(value)) {
          // Handle variadic arguments - output each value separately
          for (const v of value) {
            const vStr = String(v);
            if (vStr.includes(' ')) parts.push(`--${key}="${vStr}"`);
            else parts.push(`--${key}=${vStr}`);
          }
        } else if (typeof value === 'object' && value !== null) {
          // Handle nested objects - convert to dot notation
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

      // Output remaining arguments (non-positional)
      for (const [key, value] of Object.entries(args)) {
        if (value === undefined || positionalNames.has(key)) continue;
        stringifyValue(key, value);
      }
    }

    return parts.join(' ');
  };

  type DetailLevel = 'minimal' | 'standard' | 'full';
  type FormatLevel = 'text' | 'ansi' | 'console' | 'markdown' | 'html' | 'json' | 'auto';

  /**
   * Check if help, version, or completion flags/commands are present in the input.
   * Returns the appropriate action to take, or null if normal execution should proceed.
   */
  const checkBuiltinCommands = (
    input: string | undefined,
  ):
    | { type: 'help'; command?: AnyPadroneCommand; detail?: DetailLevel; format?: FormatLevel }
    | { type: 'version' }
    | { type: 'completion'; shell?: ShellType }
    | { type: 'repl'; scope?: string }
    | null => {
    if (!input) return null;

    const parts = parseCliInputToParts(input);
    const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
    const args = parts.filter((p) => p.type === 'named' || p.type === 'alias');

    // Helper to check if a key array matches a single key string
    const keyIs = (key: string[], name: string) => key.length === 1 && key[0] === name;

    // Check for --help, -h flags (these take precedence over commands)
    const hasHelpFlag = args.some((p) => (p.type === 'named' && keyIs(p.key, 'help')) || (p.type === 'alias' && keyIs(p.key, 'h')));

    // Extract detail level from --detail=<level> or -d <level>
    const getDetailLevel = (): DetailLevel | undefined => {
      for (const arg of args) {
        if (arg.type === 'named' && keyIs(arg.key, 'detail') && typeof arg.value === 'string') {
          if (arg.value === 'minimal' || arg.value === 'standard' || arg.value === 'full') {
            return arg.value;
          }
        }
        if (arg.type === 'alias' && keyIs(arg.key, 'd') && typeof arg.value === 'string') {
          if (arg.value === 'minimal' || arg.value === 'standard' || arg.value === 'full') {
            return arg.value;
          }
        }
      }
      return undefined;
    };
    const detail = getDetailLevel();

    // Extract format from --format=<value> or -f <value>
    const getFormat = (): FormatLevel | undefined => {
      const validFormats: FormatLevel[] = ['text', 'ansi', 'console', 'markdown', 'html', 'json', 'auto'];
      for (const arg of args) {
        if (arg.type === 'named' && keyIs(arg.key, 'format') && typeof arg.value === 'string') {
          if (validFormats.includes(arg.value as FormatLevel)) {
            return arg.value as FormatLevel;
          }
        }
        if (arg.type === 'alias' && keyIs(arg.key, 'f') && typeof arg.value === 'string') {
          if (validFormats.includes(arg.value as FormatLevel)) {
            return arg.value as FormatLevel;
          }
        }
      }
      return undefined;
    };
    const format = getFormat();

    // Check for --version, -v, -V flags
    const hasVersionFlag = args.some(
      (p) => (p.type === 'named' && keyIs(p.key, 'version')) || (p.type === 'alias' && (keyIs(p.key, 'v') || keyIs(p.key, 'V'))),
    );

    // If the first term is the program name, skip it
    const normalizedTerms = [...terms];
    if (normalizedTerms[0] === existingCommand.name) normalizedTerms.shift();

    // Check if user has defined 'help', 'version', or 'completion' commands (they take precedence)
    const userHelpCommand = findCommandByName('help', existingCommand.commands);
    const userVersionCommand = findCommandByName('version', existingCommand.commands);
    const userCompletionCommand = findCommandByName('completion', existingCommand.commands);

    // Check for 'help' command (only if user hasn't defined one)
    // Supports both 'help <command>' and '<command> help' forms
    if (!userHelpCommand && normalizedTerms[0] === 'help') {
      // help <command> - get help for specific command
      const commandName = normalizedTerms.slice(1).join(' ');
      const targetCommand = commandName ? findCommandByName(commandName, existingCommand.commands) : undefined;
      return { type: 'help', command: targetCommand, detail, format };
    }
    if (!userHelpCommand && normalizedTerms.length > 0 && normalizedTerms[normalizedTerms.length - 1] === 'help') {
      // <command> help - get help for specific command (trailing form)
      const commandTerms = normalizedTerms.slice(0, -1);
      // Walk the command tree to find the deepest matching command
      let targetCommand: AnyPadroneCommand | undefined;
      let current = existingCommand;
      for (const term of commandTerms) {
        const found = findCommandByName(term, current.commands);
        if (found) {
          targetCommand = found;
          current = found;
        } else {
          break;
        }
      }
      return { type: 'help', command: targetCommand, detail, format };
    }

    // Check for 'version' command (only if user hasn't defined one)
    if (!userVersionCommand && normalizedTerms[0] === 'version') {
      return { type: 'version' };
    }

    // Check for 'completion' command (only if user hasn't defined one)
    if (!userCompletionCommand && normalizedTerms[0] === 'completion') {
      const shellArg = normalizedTerms[1] as ShellType | undefined;
      const validShells: ShellType[] = ['bash', 'zsh', 'fish', 'powershell'];
      const shell = shellArg && validShells.includes(shellArg) ? shellArg : undefined;
      return { type: 'completion', shell };
    }

    // Handle help flag - find the command being requested
    if (hasHelpFlag) {
      // Filter out help-related terms and flags to find the target command
      const commandTerms = normalizedTerms.filter((t) => t !== 'help');
      const commandName = commandTerms.join(' ');
      const targetCommand = commandName ? findCommandByName(commandName, existingCommand.commands) : undefined;
      return { type: 'help', command: targetCommand, detail, format };
    }

    // Handle version flag (only for root command, i.e., no subcommand terms)
    if (hasVersionFlag && normalizedTerms.length === 0) {
      return { type: 'version' };
    }

    // Check for --repl flag
    const hasReplFlag = args.some((p) => p.type === 'named' && keyIs(p.key, 'repl'));
    if (hasReplFlag) {
      const scope = normalizedTerms.length > 0 ? normalizedTerms.join(' ') : undefined;
      return { type: 'repl', scope };
    }

    return null;
  };

  /**
   * Extract the config file path from --config=<path> or -c <path> flags.
   */
  const extractConfigPath = (input: string | undefined): string | undefined => {
    if (!input) return undefined;

    const parts = parseCliInputToParts(input);
    const args = parts.filter((p) => p.type === 'named' || p.type === 'alias');

    for (const arg of args) {
      if (arg.type === 'named' && arg.key.length === 1 && arg.key[0] === 'config' && typeof arg.value === 'string') {
        return arg.value;
      }
      if (arg.type === 'alias' && arg.key.length === 1 && arg.key[0] === 'c' && typeof arg.value === 'string') {
        return arg.value;
      }
    }
    return undefined;
  };

  /**
   * Core execution logic shared by eval() and cli().
   * errorMode controls validation error behavior:
   * - 'soft': return result with issues (eval behavior)
   * - 'hard': print error + help and throw (cli-without-input behavior)
   */
  const execCommand = (resolvedInput: string | undefined, evalOptions?: PadroneEvalPreferences, errorMode: 'soft' | 'hard' = 'soft') => {
    const runtime = getCommandRuntime(existingCommand);

    // Check for built-in help/version/completion commands and flags (bypass plugins)
    const builtin = checkBuiltinCommands(resolvedInput);

    if (builtin) {
      if (builtin.type === 'help') {
        const helpText = generateHelp(existingCommand, builtin.command ?? existingCommand, {
          detail: builtin.detail,
          format: builtin.format ?? runtime.format,
        });
        runtime.output(helpText);
        return {
          command: existingCommand,
          args: undefined,
          result: helpText,
        } as any;
      }

      if (builtin.type === 'version') {
        const version = getVersion(existingCommand.version);
        runtime.output(version);
        return {
          command: existingCommand,
          args: undefined,
          result: version,
        } as any;
      }

      if (builtin.type === 'completion') {
        const completionScript = generateCompletionOutput(existingCommand, builtin.shell);
        runtime.output(completionScript);
        return {
          command: existingCommand,
          args: undefined,
          result: completionScript,
        } as any;
      }
    }

    // Shared plugin state for this execution
    const state: Record<string, unknown> = {};

    // ── Phase 1: Parse ──────────────────────────────────────────────────
    const parseCtx: PluginParseContext = { input: resolvedInput, command: existingCommand, state };

    const coreParse = (): PluginParseResult => {
      const { command, rawArgs, args, unmatchedTerms } = parseCommand(parseCtx.input);

      // Default help: command with subcommands but no handler → show its help.
      const hasSubcommands = command.commands && command.commands.length > 0;
      if (hasSubcommands && !command.handler && unmatchedTerms.length === 0) {
        const helpText = generateHelp(existingCommand, command, { format: runtime.format });
        runtime.output(helpText);
        return {
          command: command,
          rawArgs: { '~help': helpText } as Record<string, unknown>,
          positionalArgs: [],
        };
      }

      // Reject unmatched terms when the matched command doesn't accept positional args
      if (unmatchedTerms.length > 0) {
        const hasPositionalConfig = command.meta?.positional && command.meta.positional.length > 0;
        if (!hasPositionalConfig) {
          const isRootCommand = command === existingCommand;
          const commandDisplayName = command.name || command.aliases?.[0] || command.path || '(default)';
          const errorMsg = isRootCommand
            ? `Unknown command: ${unmatchedTerms[0]}`
            : `Unexpected arguments for '${commandDisplayName}': ${unmatchedTerms.join(' ')}`;

          if (errorMode === 'hard') {
            const helpText = generateHelp(existingCommand, isRootCommand ? existingCommand : command, { format: runtime.format });
            runtime.error(errorMsg);
            runtime.error(helpText);
            throw new Error(errorMsg);
          }

          // Soft mode: throw too — this is a routing error, not a validation issue
          throw new Error(errorMsg);
        }
      }

      return { command, rawArgs, positionalArgs: args };
    };

    // Parse phase: root plugins only
    const rootPlugins = existingCommand.plugins ?? [];
    const parsedOrPromise = runPluginChain('parse', rootPlugins, parseCtx, coreParse);

    // ── Phases 2 & 3 chained after parse ────────────────────────────────
    const continueAfterParse = (parsed: PluginParseResult) => {
      const { command } = parsed;
      // Validate/execute: collected from parent chain
      const commandPlugins = collectPlugins(command);

      // Short-circuit: parse returned a help result
      if (parsed.rawArgs['~help']) {
        return {
          command: command,
          args: undefined,
          result: parsed.rawArgs['~help'],
        } as any;
      }

      // ── Phase 2: Validate ───────────────────────────────────────────
      const validateCtx: PluginValidateContext = {
        command,
        rawArgs: parsed.rawArgs,
        positionalArgs: parsed.positionalArgs,
        state,
      };

      const coreValidate = (): PluginValidateResult | Promise<PluginValidateResult> => {
        // Determine interactivity
        let flagInteractive: boolean | undefined;
        if (hasInteractiveConfig(command.meta)) {
          if (validateCtx.rawArgs.interactive !== undefined) {
            flagInteractive = validateCtx.rawArgs.interactive !== false && validateCtx.rawArgs.interactive !== 'false';
            delete validateCtx.rawArgs.interactive;
          }
          if (validateCtx.rawArgs.i !== undefined) {
            flagInteractive = validateCtx.rawArgs.i !== false && validateCtx.rawArgs.i !== 'false';
            delete validateCtx.rawArgs.i;
          }
        }

        const runtimeDefault: boolean | undefined =
          runtime.interactive === 'forced' ? true : runtime.interactive === 'disabled' ? false : undefined;
        const effectiveInteractive: boolean | undefined = flagInteractive ?? evalOptions?.interactive ?? runtimeDefault;
        const interactivitySuppressed = runtime.interactive === 'unsupported' || effectiveInteractive === false;
        const forceInteractive = !interactivitySuppressed && effectiveInteractive === true;

        // Extract config file path from --config or -c flag
        const configPath = extractConfigPath(parseCtx.input);

        // Resolve config files: command's own configFiles > inherited from parent/root
        const resolveConfigFiles = (cmd: AnyPadroneCommand): string[] | undefined => {
          if (cmd.configFiles !== undefined) return cmd.configFiles;
          if (cmd.parent) return resolveConfigFiles(cmd.parent);
          return undefined;
        };
        const effectiveConfigFiles = resolveConfigFiles(command);

        // Resolve config schema: command's own config > inherited from parent/root
        const resolveConfigSchema = (cmd: AnyPadroneCommand): AnyPadroneCommand['config'] => {
          if (cmd.config !== undefined) return cmd.config;
          if (cmd.parent) return resolveConfigSchema(cmd.parent);
          return undefined;
        };
        const configSchema = resolveConfigSchema(command);

        // Resolve env schema: command's own envSchema > inherited from parent/root
        const resolveEnvSchema = (cmd: AnyPadroneCommand): AnyPadroneCommand['envSchema'] => {
          if (cmd.envSchema !== undefined) return cmd.envSchema;
          if (cmd.parent) return resolveEnvSchema(cmd.parent);
          return undefined;
        };
        const envSchema = resolveEnvSchema(command);

        // Determine config data: explicit --config flag > auto-discovered config
        let configData: Record<string, unknown> | undefined;
        if (configPath) {
          configData = runtime.loadConfigFile(configPath);
        } else if (effectiveConfigFiles?.length) {
          const foundConfigPath = runtime.findFile(effectiveConfigFiles);
          if (foundConfigPath) {
            configData = runtime.loadConfigFile(foundConfigPath) ?? configData;
          }
        }

        // Step 1: Validate config data against schema if provided
        const validateConfig = (): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> => {
          if (configData && configSchema) {
            const configValidated = configSchema['~standard'].validate(configData);
            return thenMaybe(configValidated, (result) => {
              if (result.issues) {
                const issueMessages = result.issues
                  .map((i: StandardSchemaV1.Issue) => `  - ${i.path?.join('.') || 'root'}: ${i.message}`)
                  .join('\n');
                throw new Error(`Invalid config file:\n${issueMessages}`);
              }
              return result.value as unknown as Record<string, unknown>;
            });
          }
          return configData;
        };

        // Step 2: Validate env vars
        const validateEnv = (): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> => {
          let envData: Record<string, unknown> | undefined;
          if (envSchema) {
            const rawEnv = runtime.env();
            const envValidated = envSchema['~standard'].validate(rawEnv);
            return thenMaybe(envValidated, (result) => {
              if (!result.issues) {
                envData = result.value as unknown as Record<string, unknown>;
              }
              return envData;
            });
          }
          return envData;
        };

        // Step 3: Preprocess, interactive prompt, and validate
        const finalizeValidation = (
          validatedConfigData: Record<string, unknown> | undefined,
          envData: Record<string, unknown> | undefined,
        ): PluginValidateResult | Promise<PluginValidateResult> => {
          const preprocessedArgs = buildCommandArgs(command, validateCtx.rawArgs, validateCtx.positionalArgs, {
            envData,
            configData: validatedConfigData,
          });

          const afterInteractive =
            !interactivitySuppressed && runtime.prompt && hasInteractiveConfig(command.meta)
              ? promptInteractiveFields(preprocessedArgs, command, runtime, forceInteractive || undefined)
              : preprocessedArgs;

          return thenMaybe(afterInteractive, (filledArgs) => {
            const validated = validateCommandArgs(command, filledArgs);
            return thenMaybe(validated, (v) => v as PluginValidateResult);
          });
        };

        // Chain: config → env → validate
        const validatedConfig = validateConfig();
        return thenMaybe(validatedConfig, (cfgData) => {
          const validatedEnv = validateEnv();
          return thenMaybe(validatedEnv, (envData) => {
            return finalizeValidation(cfgData, envData);
          });
        });
      };

      const validatedOrPromise = runPluginChain('validate', commandPlugins, validateCtx, coreValidate);

      // ── Phase 3: Execute (or handle validation errors) ──────────────
      const continueAfterValidate = (v: PluginValidateResult) => {
        // Handle validation failures
        if (v.argsResult?.issues) {
          const issueMessages = v.argsResult.issues
            .map((i: StandardSchemaV1.Issue) => `  - ${i.path?.join('.') || 'root'}: ${i.message}`)
            .join('\n');

          if (errorMode === 'hard') {
            const helpText = generateHelp(existingCommand, command, { format: runtime.format });
            runtime.error(`Validation error:\n${issueMessages}`);
            runtime.error(helpText);
            throw new Error(`Validation error:\n${issueMessages}`);
          }

          // Soft mode: return result with issues, skip the action
          return {
            command: command as any,
            args: undefined,
            argsResult: v.argsResult,
            result: undefined,
          };
        }

        const executeCtx: PluginExecuteContext = {
          command,
          args: v.args,
          state,
        };

        const coreExecute = (): PluginExecuteResult => {
          const handler = command.handler ?? noop;
          const result = handler(executeCtx.args as any, getCommandRuntime(command));
          return { result };
        };

        const executedOrPromise = runPluginChain('execute', commandPlugins, executeCtx, coreExecute);

        return thenMaybe(executedOrPromise, (e) => ({
          command: command as any,
          args: v.args,
          argsResult: v.argsResult,
          result: e.result,
        }));
      };

      return warnIfUnexpectedAsync(thenMaybe(validatedOrPromise, continueAfterValidate), command) as any;
    };

    return thenMaybe(parsedOrPromise, continueAfterParse) as any;
  };

  const evalCommand: AnyPadroneProgram['eval'] = (input, evalOptions) => {
    return execCommand(input as string, evalOptions, 'soft');
  };

  /**
   * Collects plugins from the command's parent chain (root → ... → target).
   * Root/program plugins come first (outermost), target command's plugins last (innermost).
   *
   * The `programRoot` parameter provides the current program command, because
   * subcommands' `.parent` references may be stale (builders are immutable — each
   * method returns a new builder, so a subcommand's parent was captured before
   * `.use()` was called on the program). We substitute `programRoot` for the
   * top of the chain to ensure program-level plugins are always included.
   */
  const collectPlugins = (cmd: AnyPadroneCommand): PadronePlugin[] => {
    const chain: PadronePlugin[][] = [];
    let current: AnyPadroneCommand | undefined = cmd;
    while (current) {
      // If this is the root (no parent), use existingCommand's plugins instead
      // to pick up plugins added after subcommands were defined.
      if (!current.parent) {
        if (existingCommand.plugins?.length) chain.unshift(existingCommand.plugins);
      } else {
        if (current.plugins?.length) chain.unshift(current.plugins);
      }
      current = current.parent;
    }
    return chain.flat();
  };

  // Forward declaration — assigned by the repl method in the return object, used by cli() for --repl.
  let replFn: (options?: PadroneReplPreferences) => AsyncIterable<any>;
  let replActive = false;

  const cli: AnyPadroneProgram['cli'] = (cliOptions) => {
    const runtime = getCommandRuntime(existingCommand);
    const resolvedInput = (runtime.argv().join(' ') || undefined) as string | undefined;

    // Check for --repl flag before normal execution
    if (cliOptions?.repl !== false) {
      const builtin = checkBuiltinCommands(resolvedInput);
      if (builtin?.type === 'repl') {
        const replPrefs: PadroneReplPreferences = {
          ...(typeof cliOptions?.repl === 'object' ? cliOptions.repl : {}),
          scope: builtin.scope,
        };
        const drainRepl = async () => {
          for await (const _ of replFn(replPrefs)) {
            // Results are handled by command actions
          }
          return { command: existingCommand, args: undefined, result: undefined } as any;
        };
        return drainRepl() as any;
      }
    }

    return execCommand(resolvedInput, cliOptions, 'hard');
  };

  const run: AnyPadroneProgram['run'] = (command, args) => {
    const commandObj = typeof command === 'string' ? findCommandByName(command, existingCommand.commands) : (command as AnyPadroneCommand);
    if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);
    if (!commandObj.handler) throw new Error(`Command "${commandObj.path}" has no handler`);

    const state: Record<string, unknown> = {};
    const executeCtx: PluginExecuteContext = { command: commandObj, args, state };

    const coreExecute = (): PluginExecuteResult => {
      const result = commandObj.handler!(executeCtx.args as any, getCommandRuntime(commandObj));
      return { result };
    };

    const commandObjPlugins = collectPlugins(commandObj);
    const executedOrPromise = runPluginChain('execute', commandObjPlugins, executeCtx, coreExecute);

    const toResult = (e: PluginExecuteResult) => ({
      command: commandObj as any,
      args: args as any,
      result: e.result,
    });

    if (executedOrPromise instanceof Promise) {
      return executedOrPromise.then(toResult) as any;
    }
    return toResult(executedOrPromise);
  };

  const tool: AnyPadroneProgram['tool'] = () => {
    const helpText = generateHelp(existingCommand, undefined, { format: 'text', detail: 'full' });

    const description = `\n
This is a CLI tool created with Padrone. You can run any of the defined commands described in the help text below. If you need assistance, refer to the documentation or use the help command.

<help_output>
${helpText}
</help_output>
`;

    return {
      type: 'function',
      name: existingCommand.name,
      strict: true,
      title: existingCommand.description,
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
        return !!parsed.command.needsApproval;
      },
      execute: async (input) => {
        const result = await evalCommand(input.command);
        return result.result;
      },
    };
  };

  const builder = {
    configure(config) {
      return createPadroneBuilder({ ...existingCommand, ...config }) as any;
    },
    runtime(runtimeConfig) {
      return createPadroneBuilder({ ...existingCommand, runtime: { ...existingCommand.runtime, ...runtimeConfig } }) as any;
    },
    async() {
      return createPadroneBuilder({ ...existingCommand, isAsync: true }) as any;
    },
    arguments(schema, meta) {
      // If schema is a function, call it with parent's arguments as base
      const resolvedArgs = typeof schema === 'function' ? schema(existingCommand.arguments as any) : schema;
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedArgs) || hasInteractiveConfig(meta);
      return createPadroneBuilder({ ...existingCommand, arguments: resolvedArgs, meta, isAsync }) as any;
    },
    configFile(file, schema) {
      const configFiles = file === undefined ? undefined : Array.isArray(file) ? file : [file];
      const resolvedConfig = typeof schema === 'function' ? schema(existingCommand.arguments) : (schema ?? existingCommand.arguments);
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedConfig);
      return createPadroneBuilder({ ...existingCommand, configFiles, config: resolvedConfig as any, isAsync }) as any;
    },
    env(schema) {
      const resolvedEnv = typeof schema === 'function' ? schema(existingCommand.arguments) : schema;
      const isAsync = existingCommand.isAsync || isAsyncBranded(resolvedEnv);
      return createPadroneBuilder({ ...existingCommand, envSchema: resolvedEnv as any, isAsync }) as any;
    },
    action(handler = noop) {
      const baseHandler = existingCommand.handler ?? noop;
      return createPadroneBuilder({
        ...existingCommand,
        handler: (args: any, runtime: any) => (handler as any)(args, runtime, baseHandler),
      }) as any;
    },
    wrap(config) {
      const handler = createWrapHandler(config, existingCommand.arguments as any, existingCommand.meta?.positional);
      return createPadroneBuilder({ ...existingCommand, handler }) as any;
    },
    command(nameOrNames, builderFn) {
      // Extract name and aliases from the input
      const name = Array.isArray(nameOrNames) ? nameOrNames[0] : nameOrNames;
      const aliases = Array.isArray(nameOrNames) && nameOrNames.length > 1 ? (nameOrNames.slice(1) as string[]) : undefined;

      // Check if a command with this name already exists (override case)
      const existingSubcommand = existingCommand.commands?.find((c) => c.name === name) as AnyPadroneCommand | undefined;

      const initialCommand: AnyPadroneCommand = existingSubcommand
        ? { ...existingSubcommand, aliases: aliases ?? existingSubcommand.aliases, parent: existingCommand }
        : ({
            name,
            path: existingCommand.path ? `${existingCommand.path} ${name}` : name,
            aliases,
            parent: existingCommand,
            '~types': {} as any,
          } satisfies PadroneCommand);

      const builder = createPadroneBuilder(initialCommand);

      const commandObj =
        ((builderFn?.(builder as any) as unknown as typeof builder)?.[commandSymbol] as AnyPadroneCommand) ?? initialCommand;

      // Merge subcommands when overriding: existing subcommands that aren't replaced are kept
      const mergedCommandObj = existingSubcommand ? mergeCommands(existingSubcommand, commandObj) : commandObj;

      // Replace existing command or append new one
      const commands = existingCommand.commands || [];
      const existingIndex = commands.findIndex((c) => c.name === name);
      const updatedCommands =
        existingIndex >= 0
          ? [...commands.slice(0, existingIndex), mergedCommandObj, ...commands.slice(existingIndex + 1)]
          : [...commands, mergedCommandObj];

      return createPadroneBuilder({ ...existingCommand, commands: updatedCommands }) as any;
    },

    mount(nameOrNames, program) {
      const name = Array.isArray(nameOrNames) ? nameOrNames[0] : nameOrNames;
      const aliases = Array.isArray(nameOrNames) && nameOrNames.length > 1 ? (nameOrNames.slice(1) as string[]) : undefined;

      // Extract the underlying command from the program
      const programCommand = (program as any)[commandSymbol] as AnyPadroneCommand | undefined;
      if (!programCommand) throw new Error('Cannot mount: not a valid Padrone program');

      // Re-path the command tree under the new name
      const remounted = repathCommandTree(programCommand, name, existingCommand.path || '', existingCommand);
      remounted.aliases = aliases;

      // Merge with existing command if one with the same name exists
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

    use(plugin: PadronePlugin) {
      return createPadroneBuilder({
        ...existingCommand,
        plugins: [...(existingCommand.plugins ?? []), plugin],
      }) as any;
    },

    run,
    find,
    parse,
    stringify,
    eval: evalCommand,
    cli,
    tool,

    repl: (replFn = (options?: PadroneReplPreferences) => {
      if (replActive) {
        const runtime = getCommandRuntime(existingCommand);
        runtime.error('REPL is already running. Nested REPL sessions are not supported.');
        // Return an empty async iterable so callers don't crash.
        return (async function* () {})() as any;
      }

      const runtime = getCommandRuntime(existingCommand);

      const programName = existingCommand.name || 'padrone';
      const useAnsi =
        runtime.format === 'ansi' ||
        (runtime.format === 'auto' && typeof process !== 'undefined' && !process.env.NO_COLOR && !process.env.CI && process.stdout?.isTTY);

      // Track command history for .history built-in
      const commandHistory: string[] = [];

      // Resolve the initial scope command from options.scope (command path like 'db' or 'db migrate')
      const resolveScope = (scope: string): AnyPadroneCommand[] => {
        const parts = scope.split(/\s+/);
        const stack: AnyPadroneCommand[] = [];
        let current = existingCommand;
        for (const part of parts) {
          const found = findCommandByName(part, current.commands);
          if (!found) break;
          stack.push(found);
          current = found;
        }
        return stack;
      };

      async function* replIterator() {
        replActive = true;
        const showGreeting = options?.greeting !== false;
        const showHint = options?.hint !== false;

        // Empty line before greeting/hint block
        if (showGreeting || showHint) runtime.output('');

        // Greeting: default shows program title (or name) + version, like "Welcome to My App v1.0.0"
        if (showGreeting) {
          if (options?.greeting) {
            runtime.output(options.greeting);
          } else {
            const displayName = existingCommand.title || programName;
            const version = existingCommand.version ? getVersion(existingCommand.version) : undefined;
            const greeting = version ? `Welcome to ${displayName} v${version}` : `Welcome to ${displayName}`;
            runtime.output(greeting);
          }
        }

        // Hint: dimmed text below greeting
        if (showHint) {
          const hintText =
            (typeof options?.hint === 'string' ? options.hint : undefined) ?? 'Type ".help" for more information, ".exit" to quit.';
          runtime.output(useAnsi ? `\x1b[2m${hintText}\x1b[0m` : hintText);
        }

        // Empty line after greeting/hint block
        if (showGreeting || showHint) runtime.output('');

        // Scope stack for nested/contextual REPLs.
        // `cd <subcommand>` pushes, `cd ..`/`..` pops. The scope path is prepended to all eval input.
        const scopeStack: AnyPadroneCommand[] = options?.scope ? resolveScope(options.scope) : [];

        const getScopeCommand = () => (scopeStack.length ? scopeStack[scopeStack.length - 1]! : existingCommand);
        const getScopePath = () => scopeStack.map((c) => c.name).join(' ');

        const buildPrompt = () => {
          if (options?.prompt) return typeof options.prompt === 'function' ? options.prompt() : options.prompt;
          const scopePath = getScopePath();
          const label = scopePath ? `${programName}/${scopePath.replace(/ /g, '/')}` : programName;
          return useAnsi ? `\x1b[1m${label}\x1b[0m ❯ ` : `${label} ❯ `;
        };

        // Build completer scoped to the current command
        const buildScopedCompleter = () => {
          const scopeCmd = getScopeCommand();
          const inScope = scopeStack.length > 0;
          return buildReplCompleter(scopeCmd, { inScope });
        };

        // Build session config with completer
        const sessionConfig: ReplSessionConfig = { history: options?.history };
        if (options?.completion !== false) {
          sessionConfig.completer = buildScopedCompleter();
        }

        // If the runtime provides a custom readLine, use it (stateless, no history/completion).
        // Otherwise, create a persistent terminal session with history + tab completion.
        const session = runtime.readLine ? undefined : createTerminalReplSession(sessionConfig);
        const questionFn = session ? (prompt: string) => session.question(prompt) : runtime.readLine!;

        // Update the session's completer when scope changes
        const updateCompleter = () => {
          if (options?.completion === false) return;
          const completer = buildScopedCompleter();
          if (session) session.completer = completer;
          sessionConfig.completer = completer;
        };

        // Track last SIGINT time for double Ctrl+C to exit
        let lastSigintTime = 0;

        try {
          while (true) {
            const promptStr = buildPrompt();
            const input = await questionFn(promptStr);

            // EOF (Ctrl+D, closed connection)
            if (input === null) break;

            // Handle Ctrl+C (SIGINT sentinel from terminal session)
            if (input === REPL_SIGINT) {
              const now = Date.now();
              if (now - lastSigintTime < 2000) break; // Double Ctrl+C within 2s → exit
              lastSigintTime = now;
              runtime.output('(press Ctrl+C again to exit, or Ctrl+D)');
              continue;
            }

            const trimmed = input.trim();
            if (!trimmed) continue;

            // Reset SIGINT timer on any real input
            lastSigintTime = 0;

            // Track command history for .history
            commandHistory.push(trimmed);

            // Dot-prefixed built-in REPL commands
            if (trimmed === '.exit' || trimmed === '.quit') break;
            if (trimmed === '.clear') {
              runtime.output('\x1B[2J\x1B[H');
              continue;
            }
            if (trimmed === '.help') {
              const lines = [
                'REPL Commands:',
                '  .                 Execute the current scoped command',
                '  .help             Print this help message',
                '  .exit             Exit the REPL',
                '  .clear            Clear the screen',
                '  .history          Show command history',
                '  .scope <cmd>      Scope into a subcommand',
                '  .scope ..         Go up one scope level',
              ];
              lines.push(
                '',
                'Keybindings:',
                '  Ctrl+C       Cancel current line (press twice to exit)',
                '  Ctrl+D       Exit the REPL',
                '  Up/Down      Navigate history',
                '  Tab          Auto-complete',
                '',
                'Type "help" to see available commands.',
              );
              runtime.output(lines.join('\n'));
              continue;
            }
            if (trimmed === '.history') {
              // Show all previous entries (excluding the .history command itself)
              const entries = commandHistory.slice(0, -1);
              if (entries.length === 0) {
                runtime.output('No history.');
              } else {
                runtime.output(entries.map((entry, i) => `${i + 1}  ${entry}`).join('\n'));
              }
              continue;
            }

            // `.scope <subcommand>` — scope the REPL to a command subtree
            // `.scope ..` or `..` — go up one scope level
            if (trimmed.startsWith('.scope ') || trimmed === '.scope') {
              const target = trimmed.slice(6).trim();
              if (target === '..' || target === '') {
                if (scopeStack.length > 0) {
                  scopeStack.pop();
                  updateCompleter();
                }
              } else {
                const scopeCmd = getScopeCommand();
                const found = findCommandByName(target, scopeCmd.commands);
                if (found) {
                  if (found.commands?.length) {
                    scopeStack.push(found);
                    updateCompleter();
                  } else {
                    runtime.error(`"${target}" has no subcommands to scope into.`);
                  }
                } else {
                  runtime.error(`Unknown command: ${target}`);
                }
              }
              continue;
            }

            // `..` shorthand for `.scope ..`
            if (trimmed === '..') {
              if (scopeStack.length > 0) {
                scopeStack.pop();
                updateCompleter();
              }
              continue;
            }

            // `.` (bare dot) — execute the current command (scoped or root)
            let evalInput = trimmed;
            if (trimmed === '.') {
              evalInput = '';
            }

            const prefix = options?.outputPrefix;
            const prefixLines = prefix
              ? (text: string) =>
                  text
                    .split('\n')
                    .map((l) => prefix + l)
                    .join('\n')
              : undefined;

            // Temporarily patch runtime on all commands so handler output gets prefixed.
            // Commands store parent refs from build time, so we patch each command directly.
            const savedRuntimes: { cmd: AnyPadroneCommand; runtime: typeof existingCommand.runtime }[] = [];
            if (prefixLines) {
              const prefixedRuntime = {
                ...existingCommand.runtime,
                output: (text: string) => runtime.output(prefixLines(text)),
                error: (text: string) => runtime.error(prefixLines(text)),
              };
              const patchAll = (cmd: AnyPadroneCommand) => {
                savedRuntimes.push({ cmd, runtime: cmd.runtime });
                cmd.runtime = prefixedRuntime;
                cmd.commands?.forEach(patchAll);
              };
              patchAll(existingCommand);
            }

            // Resolve before/after spacing from the shorthand or object form
            const sp = options?.spacing;
            const isSpacingObject = typeof sp === 'object' && sp !== null && !Array.isArray(sp);
            const spacingBefore = isSpacingObject ? sp.before : sp;
            const spacingAfter = isSpacingObject ? sp.after : sp;

            const emitSpacingLine = (value: boolean | string) => {
              if (typeof value === 'string') {
                const sep =
                  value.length === 1
                    ? value.repeat(typeof process !== 'undefined' && process.stdout?.columns ? process.stdout.columns : 80)
                    : value;
                runtime.output(sep);
              } else if (value) {
                runtime.output('');
              }
            };
            const emitSpacing = (value: typeof spacingBefore) => {
              if (!value) return;
              if (Array.isArray(value)) {
                for (const line of value) emitSpacingLine(line);
              } else {
                emitSpacingLine(value);
              }
            };

            emitSpacing(spacingBefore);

            // Prepend scope path so evalCommand resolves relative to root
            const scopePath = getScopePath();
            const scopedInput = scopePath ? (evalInput ? `${scopePath} ${evalInput}` : scopePath) : evalInput;

            try {
              const result = await evalCommand(scopedInput);
              if (result.argsResult?.issues) {
                const issueMessages = result.argsResult.issues
                  .map((i: StandardSchemaV1.Issue) => `  - ${i.path?.join('.') || 'root'}: ${i.message}`)
                  .join('\n');
                const msg = `Validation error:\n${issueMessages}`;
                runtime.error(prefixLines ? prefixLines(msg) : msg);
              }
              yield result as any;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              runtime.error(prefixLines ? prefixLines(msg) : msg);
            } finally {
              for (const { cmd, runtime: saved } of savedRuntimes) cmd.runtime = saved;
              emitSpacing(spacingAfter);
            }
          }
        } finally {
          replActive = false;
          session?.close();
        }
      }

      return replIterator() as any;
    }),

    api() {
      function buildApi(command: AnyPadroneCommand) {
        const runCommand = ((args) => run(command, args).result) as PadroneAPI<AnyPadroneCommand>;
        if (!command.commands) return runCommand;
        for (const cmd of command.commands) runCommand[cmd.name] = buildApi(cmd);
        return runCommand;
      }

      return buildApi(existingCommand);
    },

    help(command, prefs) {
      const commandObj = !command
        ? existingCommand
        : typeof command === 'string'
          ? findCommandByName(command, existingCommand.commands)
          : (command as AnyPadroneCommand);
      if (!commandObj) throw new Error(`Command "${command ?? ''}" not found`);
      const runtime = getCommandRuntime(existingCommand);
      return generateHelp(existingCommand, commandObj, { ...prefs, format: prefs?.format ?? runtime.format });
    },

    completion(shell) {
      return generateCompletionOutput(existingCommand, shell as ShellType | undefined);
    },

    '~types': {} as any,

    [commandSymbol]: existingCommand,
  } satisfies AnyPadroneProgram & { [commandSymbol]: AnyPadroneCommand } as any;
  return builder as TBuilder & { [commandSymbol]: AnyPadroneCommand };
}
