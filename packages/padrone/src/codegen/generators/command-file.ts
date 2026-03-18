import { fieldMetaToCode } from '../schema-to-code.ts';
import type { CodeBuilder, CommandMeta, FieldMeta, GeneratorContext } from '../types.ts';

const JS_RESERVED = new Set([
  'break',
  'case',
  'catch',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'class',
  'const',
  'enum',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'await',
  'async',
]);

/** Convert a command name to a safe JS identifier (camelCase, reserved-word-safe). */
export function toSafeIdentifier(name: string): string {
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  if (/^\d/.test(camel)) return `_${camel}`;
  if (JS_RESERVED.has(camel)) return `_${camel}`;
  return camel;
}

/** Build the exported function name for a command (e.g. 'repo' → 'repoCommand'). */
export function toCommandFunctionName(name: string): string {
  return `${toSafeIdentifier(name)}Command`;
}

export interface CommandFileOptions {
  /** Wrap config: generates .wrap() instead of .action(). */
  wrap?: {
    /** The external command to wrap (e.g. 'gh'). */
    command: string;
    /** Fixed args preceding the options (e.g. ['pr', 'list']). */
    args?: string[];
  };
  /** Subcommand references to wire into this command via .command() calls. */
  subcommands?: { name: string; varName: string; importPath: string; aliases?: string[] }[];
}

/**
 * Generate a single Padrone command file from a CommandMeta.
 * Produces a named function that chains .configure(), .arguments(), and .wrap() or .action().
 */
export function generateCommandFile(command: CommandMeta, ctx: GeneratorContext, options?: CommandFileOptions): CodeBuilder {
  const code = ctx.createCodeBuilder();

  const hasArgs = (command.arguments && command.arguments.length > 0) || (command.positionals && command.positionals.length > 0);

  if (hasArgs) {
    code.import('z', 'zod/v4');
  }

  code.importType('AnyPadroneBuilder', 'padrone');

  // Import subcommand modules
  if (options?.subcommands) {
    for (const sub of options.subcommands) {
      code.import([sub.varName], sub.importPath);
    }
  }

  code.line();

  if (command.deprecated) {
    const msg = typeof command.deprecated === 'string' ? command.deprecated : 'This command is deprecated';
    code.comment(`@deprecated ${msg}`);
  }

  const fnName = toCommandFunctionName(command.name);
  code.line(`export function ${fnName}<T extends AnyPadroneBuilder>(cmd: T) {`);
  code.line(`  return cmd`);

  // .configure()
  const configParts: string[] = [];
  if (command.description) {
    configParts.push(`description: ${JSON.stringify(command.description)}`);
  }
  if (command.deprecated) {
    configParts.push(`deprecated: ${typeof command.deprecated === 'string' ? JSON.stringify(command.deprecated) : 'true'}`);
  }
  if (configParts.length > 0) {
    code.line(`    .configure({ ${configParts.join(', ')} })`);
  }

  // .arguments()
  if (hasArgs) {
    const allFields = [...(command.arguments || []), ...(command.positionals || [])];
    const schemaCode = fieldMetaToCode(allFields);

    const positionalNames = (command.positionals || []).map((p) => (p.type === 'array' ? `'...${p.name}'` : `'${p.name}'`));
    const fieldsMap = buildFieldsMap(allFields);
    const hasMetaOptions = positionalNames.length > 0 || fieldsMap;

    if (hasMetaOptions) {
      code.line(`    .arguments(${schemaCode.code}, {`);
      if (positionalNames.length > 0) {
        code.line(`      positional: [${positionalNames.join(', ')}],`);
      }
      if (fieldsMap) {
        code.line(`      fields: ${fieldsMap},`);
      }
      code.line(`    })`);
    } else {
      code.line(`    .arguments(${schemaCode.code})`);
    }
  }

  // .command() calls for subcommands
  if (options?.subcommands) {
    for (const sub of options.subcommands) {
      const nameArg =
        sub.aliases && sub.aliases.length > 0
          ? `[${JSON.stringify(sub.name)}, ${sub.aliases.map((a) => JSON.stringify(a)).join(', ')}]`
          : JSON.stringify(sub.name);
      code.line(`    .command(${nameArg}, ${sub.varName})`);
    }
  }

  // .wrap() or .action()
  if (options?.wrap) {
    const wrapParts: string[] = [];
    wrapParts.push(`command: ${JSON.stringify(options.wrap.command)}`);
    if (options.wrap.args && options.wrap.args.length > 0) {
      wrapParts.push(`args: [${options.wrap.args.map((a) => JSON.stringify(a)).join(', ')}]`);
    }
    code.line(`    .wrap({ ${wrapParts.join(', ')} })`);
  } else {
    code.line(`    .action((args) => { /* TODO */ })`);
  }

  code.line(`}`);

  return code;
}

function buildFieldsMap(fields: FieldMeta[]): string | null {
  const entries: string[] = [];
  for (const field of fields) {
    if (field.aliases && field.aliases.length > 0) {
      const alias =
        field.aliases.length === 1 ? JSON.stringify(field.aliases[0]) : `[${field.aliases.map((a) => JSON.stringify(a)).join(', ')}]`;
      const key = /^[a-zA-Z_$][\w$]*$/.test(field.name) ? field.name : JSON.stringify(field.name);
      entries.push(`${key}: { alias: ${alias} }`);
    }
  }
  if (entries.length === 0) return null;
  return `{ ${entries.join(', ')} }`;
}
