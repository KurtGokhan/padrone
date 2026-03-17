import { fieldMetaToCode } from '../schema-to-code.ts';
import type { CodeBuilder, CommandMeta, FieldMeta, GeneratorContext } from '../types.ts';

export interface CommandFileOptions {
  /** Wrap config: generates .wrap() instead of .action(). */
  wrap?: {
    /** The external command to wrap (e.g. 'gh'). */
    command: string;
    /** Fixed args preceding the options (e.g. ['pr', 'list']). */
    args?: string[];
  };
}

/**
 * Generate a single Padrone command file from a CommandMeta.
 * Produces a builder function that chains .configure(), .arguments(), and .wrap() or .action().
 */
export function generateCommandFile(command: CommandMeta, ctx: GeneratorContext, options?: CommandFileOptions): CodeBuilder {
  const code = ctx.createCodeBuilder();

  const hasArgs = (command.arguments && command.arguments.length > 0) || (command.positionals && command.positionals.length > 0);

  if (hasArgs) {
    code.import('z', 'zod');
  }
  code.importType(['PadroneBuilder'], 'padrone');

  code.line();

  if (command.deprecated) {
    const msg = typeof command.deprecated === 'string' ? command.deprecated : 'This command is deprecated';
    code.comment(`@deprecated ${msg}`);
  }

  code.line(`export default (cmd: PadroneBuilder) => cmd`);

  // .configure()
  const configParts: string[] = [];
  if (command.description) {
    configParts.push(`description: ${JSON.stringify(command.description)}`);
  }
  if (command.aliases && command.aliases.length > 0) {
    configParts.push(`aliases: [${command.aliases.map((a) => JSON.stringify(a)).join(', ')}]`);
  }
  if (command.deprecated) {
    configParts.push(`deprecated: ${typeof command.deprecated === 'string' ? JSON.stringify(command.deprecated) : 'true'}`);
  }
  if (configParts.length > 0) {
    code.line(`  .configure({ ${configParts.join(', ')} })`);
  }

  // .arguments()
  if (hasArgs) {
    const allFields = [...(command.arguments || []), ...(command.positionals || [])];
    const schemaCode = fieldMetaToCode(allFields);

    const positionalNames = (command.positionals || []).map((p) => (p.type === 'array' ? `'...${p.name}'` : `'${p.name}'`));
    const aliasMap = buildAliasMap(allFields);
    const hasMetaOptions = positionalNames.length > 0 || aliasMap;

    if (hasMetaOptions) {
      code.line(`  .arguments(${schemaCode.code}, {`);
      if (positionalNames.length > 0) {
        code.line(`    positional: [${positionalNames.join(', ')}],`);
      }
      if (aliasMap) {
        code.line(`    aliases: ${aliasMap},`);
      }
      code.line(`  })`);
    } else {
      code.line(`  .arguments(${schemaCode.code})`);
    }
  }

  // .wrap() or .action()
  if (options?.wrap) {
    const wrapParts: string[] = [];
    wrapParts.push(`command: ${JSON.stringify(options.wrap.command)}`);
    if (options.wrap.args && options.wrap.args.length > 0) {
      wrapParts.push(`args: [${options.wrap.args.map((a) => JSON.stringify(a)).join(', ')}]`);
    }
    code.line(`  .wrap({ ${wrapParts.join(', ')} })`);
  } else {
    code.line(`  .action((args) => { /* TODO */ })`);
  }

  return code;
}

function buildAliasMap(fields: FieldMeta[]): string | null {
  const entries: string[] = [];
  for (const field of fields) {
    if (field.aliases && field.aliases.length > 0) {
      const values = field.aliases.map((a) => JSON.stringify(a)).join(', ');
      entries.push(`${field.name}: [${values}]`);
    }
  }
  if (entries.length === 0) return null;
  return `{ ${entries.join(', ')} }`;
}
