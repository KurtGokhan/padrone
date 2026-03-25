import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AnyPadroneCommand, PluginValidateResult } from '../types/index.ts';
import { createStdinStream } from '../util/stream.ts';
import {
  coerceArgs,
  detectUnknownArgs,
  extractSchemaMetadata,
  frameworkReservedKeys,
  isArrayField,
  isAsyncStreamField,
  JSON_SCHEMA_OPTS,
  parsePositionalConfig,
  parseStdinConfig,
  preprocessArgs,
} from './args.ts';
import { resolveInherited } from './builtins.ts';
import { getCommandRuntime, suggestSimilar } from './commands.ts';
import { getNestedValue, parseCliInputToParts, setNestedValue } from './parse.ts';
import { thenMaybe } from './results.ts';
import { resolveStdin, resolveStdinAlways } from './runtime.ts';
import { formatSuggestions } from './suggestions.ts';

/**
 * Parses CLI input to find the command and extract raw arguments without validation.
 */
export function parseCommand(input: string | undefined, rootCommand: AnyPadroneCommand, findCommandByName: FindCommandFn) {
  input ??= getCommandRuntime(rootCommand).argv().join(' ') || undefined;
  if (!input) {
    const defaultCommand = findCommandByName('', rootCommand.commands);
    if (defaultCommand) {
      return { command: defaultCommand, rawArgs: {} as Record<string, unknown>, args: [] as string[], unmatchedTerms: [] as string[] };
    }
    return { command: rootCommand, rawArgs: {} as Record<string, unknown>, args: [] as string[], unmatchedTerms: [] as string[] };
  }

  const parts = parseCliInputToParts(input);

  const terms = parts.filter((p) => p.type === 'term').map((p) => p.value);
  const argTokens = parts.filter((p) => p.type === 'arg').map((p) => p.value);

  let curCommand: AnyPadroneCommand | undefined = rootCommand;
  let unmatchedTerms: string[] = [];

  if (terms[0] === rootCommand.name) terms.shift();

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i] || '';
    const found = findCommandByName(term, curCommand.commands);

    if (found) {
      curCommand = found;
    } else {
      unmatchedTerms = terms.slice(i);
      argTokens.unshift(...unmatchedTerms);
      break;
    }
  }

  if (unmatchedTerms.length === 0 && curCommand.commands?.length) {
    const defaultCommand = findCommandByName('', curCommand.commands);
    if (defaultCommand) curCommand = defaultCommand;
  }

  if (!curCommand) return { command: rootCommand, rawArgs: {} as Record<string, unknown>, args: argTokens, unmatchedTerms };

  const argsMeta = curCommand.meta?.fields;
  const schemaMetadata = curCommand.argsSchema
    ? extractSchemaMetadata(curCommand.argsSchema, argsMeta, curCommand.meta?.autoAlias)
    : { flags: {}, aliases: {} };
  const { flags, aliases } = schemaMetadata;

  const arrayArguments = new Set<string>();
  if (curCommand.argsSchema) {
    try {
      const jsonSchema = curCommand.argsSchema['~standard'].jsonSchema.input(JSON_SCHEMA_OPTS) as Record<string, any>;
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
    let key: string[];
    if (arg.type === 'alias' && arg.key.length === 1 && flags[arg.key[0]!]) {
      key = [flags[arg.key[0]!]!];
    } else if (arg.type === 'named' && arg.key.length === 1 && aliases[arg.key[0]!]) {
      key = [aliases[arg.key[0]!]!];
    } else {
      key = arg.key;
    }

    const rootKey = key[0]!;

    if (arg.type === 'named' && arg.negated) {
      setNestedValue(rawArgs, key, false);
      continue;
    }

    const value = arg.value ?? true;

    if (arrayArguments.has(rootKey)) {
      const existing = getNestedValue(rawArgs, key);
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          if (Array.isArray(value)) existing.push(...value);
          else existing.push(value);
        } else {
          if (Array.isArray(value)) setNestedValue(rawArgs, key, [existing, ...value]);
          else setNestedValue(rawArgs, key, [existing, value]);
        }
      } else {
        setNestedValue(rawArgs, key, Array.isArray(value) ? value : [value]);
      }
    } else {
      const existing = getNestedValue(rawArgs, key);
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          if (Array.isArray(value)) existing.push(...value);
          else existing.push(value);
        } else {
          if (Array.isArray(value)) setNestedValue(rawArgs, key, [existing, ...value]);
          else setNestedValue(rawArgs, key, [existing, value]);
        }
      } else {
        setNestedValue(rawArgs, key, value);
      }
    }
  }

  return { command: curCommand, rawArgs, args: argTokens, unmatchedTerms };
}

type FindCommandFn = (name: string, commands?: AnyPadroneCommand[]) => AnyPadroneCommand | undefined;

/**
 * Preprocesses raw arguments: applies env/config values and maps positional arguments.
 * Also performs auto-coercion (string→number/boolean) and unknown arg detection.
 */
export function buildCommandArgs(
  command: AnyPadroneCommand,
  rawArgs: Record<string, unknown>,
  positionalArgs: string[],
  context?: { stdinData?: Record<string, unknown>; envData?: Record<string, unknown>; configData?: Record<string, unknown> },
): Record<string, unknown> {
  let preprocessedArgs = preprocessArgs(rawArgs, {
    flags: {},
    aliases: {},
    stdinData: context?.stdinData,
    envData: context?.envData,
    configData: context?.configData,
  });

  const positionalConfig = command.meta?.positional ? parsePositionalConfig(command.meta.positional) : [];

  if (positionalConfig.length > 0) {
    let argIndex = 0;
    for (let i = 0; i < positionalConfig.length; i++) {
      const { name, variadic } = positionalConfig[i]!;
      if (argIndex >= positionalArgs.length) break;

      if (variadic) {
        const remainingPositionals = positionalConfig.slice(i + 1);
        const nonVariadicAfter = remainingPositionals.filter((p) => !p.variadic).length;
        const variadicEnd = positionalArgs.length - nonVariadicAfter;
        preprocessedArgs[name] = positionalArgs.slice(argIndex, variadicEnd);
        argIndex = variadicEnd;
      } else if (i === positionalConfig.length - 1 && positionalArgs.length > argIndex + 1) {
        preprocessedArgs[name] = positionalArgs.slice(argIndex).join(' ');
        argIndex = positionalArgs.length;
      } else {
        preprocessedArgs[name] = positionalArgs[argIndex];
        argIndex++;
      }
    }
  }

  if (command.argsSchema) {
    preprocessedArgs = coerceArgs(preprocessedArgs, command.argsSchema);
  }

  return preprocessedArgs;
}

/**
 * Detects unknown options in args that aren't defined in the schema.
 * Returns unknown key info with suggestions, or empty array if schema is loose.
 */
export function checkUnknownArgs(
  command: AnyPadroneCommand,
  preprocessedArgs: Record<string, unknown>,
): { key: string; suggestions: string[] }[] {
  if (!command.argsSchema) {
    const unknowns: { key: string; suggestions: string[] }[] = [];
    for (const key of Object.keys(preprocessedArgs)) {
      if (!frameworkReservedKeys.has(key)) unknowns.push({ key, suggestions: [] });
    }
    return unknowns;
  }

  const argsMeta = command.meta?.fields;
  const { flags, aliases } = extractSchemaMetadata(command.argsSchema, argsMeta, command.meta?.autoAlias);

  return detectUnknownArgs(preprocessedArgs, command.argsSchema, flags, aliases, suggestSimilar);
}

/**
 * Validates preprocessed arguments against the command's schema.
 * First checks for unknown args (strict by default), then runs schema validation.
 * Returns sync or async result depending on the schema's validate method.
 */
export function validateCommandArgs(command: AnyPadroneCommand, preprocessedArgs: Record<string, unknown>) {
  const unknownArgs = checkUnknownArgs(command, preprocessedArgs);
  if (unknownArgs.length > 0) {
    const issues: StandardSchemaV1.Issue[] = unknownArgs.map(({ key, suggestions }) => {
      const hint = formatSuggestions(suggestions, '--');
      return { path: [key], message: hint ? `Unknown option: "${key}". ${hint}` : `Unknown option: "${key}"` };
    });
    return { args: undefined, argsResult: { issues } as any };
  }

  const argsParsed = command.argsSchema ? command.argsSchema['~standard'].validate(preprocessedArgs) : { value: {} };

  const buildResult = (parsed: StandardSchemaV1.Result<unknown>) => ({
    args: parsed.issues ? undefined : (parsed.value as any),
    argsResult: parsed as any,
  });

  return thenMaybe(argsParsed, buildResult);
}

/**
 * Preprocesses and validates raw arguments against the command's schema.
 * Returns sync or async result depending on the schema's validate method.
 */
export function validateArgs(
  command: AnyPadroneCommand,
  rawArgs: Record<string, unknown>,
  positionalArgs: string[],
  context?: { stdinData?: Record<string, unknown>; envData?: Record<string, unknown>; configData?: Record<string, unknown> },
) {
  const preprocessedArgs = buildCommandArgs(command, rawArgs, positionalArgs, context);
  return validateCommandArgs(command, preprocessedArgs);
}

/**
 * Reads stdin data for a command if configured and the field was not already provided.
 * Returns a record with the stdin field populated, or empty object.
 */
export function readStdinData(
  command: AnyPadroneCommand,
  rawArgs: Record<string, unknown>,
  rootCommand: AnyPadroneCommand,
): Record<string, unknown> | Promise<Record<string, unknown>> {
  const stdinConfig = command.meta?.stdin;
  if (!stdinConfig) return {};

  const field = parseStdinConfig(stdinConfig);

  // Skip if the field was already provided via CLI flags
  if (field in rawArgs && rawArgs[field] !== undefined) return {};

  const runtime = getCommandRuntime(rootCommand);

  const streamInfo = isAsyncStreamField(command.argsSchema, field);
  if (streamInfo) {
    const stdinForStream = resolveStdinAlways(runtime as any);
    return { [field]: createStdinStream(stdinForStream, streamInfo.itemSchema) };
  }

  const stdin = resolveStdin(runtime as any);
  if (!stdin) return {};

  if (isArrayField(command.argsSchema, field)) {
    return (async () => {
      const lines: string[] = [];
      for await (const line of stdin.lines()) {
        lines.push(line);
      }
      return { [field]: lines };
    })();
  }
  return stdin.text().then((text) => (text ? { [field]: text } : {}));
}

/**
 * Validates env vars against the inherited env schema, returning validated data or undefined.
 */
export function validateEnvData(
  command: AnyPadroneCommand,
  rootCommand: AnyPadroneCommand,
): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> {
  const envSchema = resolveInherited(command, 'envSchema');
  if (!envSchema) return undefined;

  const runtime = getCommandRuntime(rootCommand);
  const rawEnv = runtime.env();
  const envValidated = envSchema['~standard'].validate(rawEnv);

  return thenMaybe(envValidated, (result) => {
    if (!result.issues) return result.value as unknown as Record<string, unknown>;
    return undefined;
  });
}

/**
 * Returns the list of known option names from a command's schema (for fuzzy suggestion).
 */
export function getKnownOptionNames(command: AnyPadroneCommand): string[] {
  if (!command.argsSchema) return [];
  try {
    const js = command.argsSchema['~standard'].jsonSchema.input(JSON_SCHEMA_OPTS) as Record<string, any>;
    if (js.type === 'object' && js.properties) return Object.keys(js.properties);
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Formats validation issue messages with "Did you mean?" hints for unknown keys.
 */
export function formatIssueMessages(issues: readonly StandardSchemaV1.Issue[], command: AnyPadroneCommand): string {
  let knownOptions: string[] | undefined;
  const getKnown = () => {
    if (knownOptions) return knownOptions;
    knownOptions = getKnownOptionNames(command);
    return knownOptions;
  };

  return issues
    .map((i: StandardSchemaV1.Issue) => {
      const base = `  - ${i.path?.join('.') || 'root'}: ${i.message}`;
      const issueAny = i as any;
      const unrecognizedKeys: string[] | undefined = issueAny.keys ?? i.message?.match(/[Uu]nrecognized key(?:s)?[^"]*"([^"]+)"/)?.slice(1);
      if (unrecognizedKeys?.length) {
        const hints = unrecognizedKeys.flatMap((k: string) => {
          const similar = suggestSimilar(k, getKnown());
          return similar.length ? [formatSuggestions(similar, '--')] : [];
        });
        if (hints.length) return `${base}\n    ${hints.join('\n    ')}`;
      }
      return base;
    })
    .join('\n');
}

/**
 * Core validate function for parse() — handles env + stdin + schema validation.
 * Used by the parse program method (lighter weight than the full exec pipeline).
 */
export function coreValidateForParse(
  command: AnyPadroneCommand,
  rawArgs: Record<string, unknown>,
  positionalArgs: string[],
  rootCommand: AnyPadroneCommand,
): PluginValidateResult | Promise<PluginValidateResult> {
  const envDataOrPromise = validateEnvData(command, rootCommand);

  return thenMaybe(envDataOrPromise, (envData) => {
    const stdinDataOrPromise = readStdinData(command, rawArgs, rootCommand);
    return thenMaybe(stdinDataOrPromise, (stdinData) => {
      const hasStdinData = Object.keys(stdinData).length > 0;
      const validated = validateArgs(command, rawArgs, positionalArgs, {
        stdinData: hasStdinData ? stdinData : undefined,
        envData,
      });
      return thenMaybe(validated, (v) => v as PluginValidateResult);
    });
  });
}
