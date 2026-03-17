import { fieldMetaToCode } from '../schema-to-code.ts';
import type { CodeBuilder, CommandMeta, GeneratorContext } from '../types.ts';

/**
 * Generate a single Padrone command file from a CommandMeta.
 * Produces a builder function that chains .configure(), .arguments(), and .action().
 */
export function generateCommandFile(command: CommandMeta, ctx: GeneratorContext): CodeBuilder {
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

    if (positionalNames.length > 0) {
      code.line(`  .arguments(${schemaCode.code}, {`);
      code.line(`    positional: [${positionalNames.join(', ')}],`);
      code.line(`  })`);
    } else {
      code.line(`  .arguments(${schemaCode.code})`);
    }
  }

  // .action()
  code.line(`  .action((args) => { /* TODO */ })`);

  return code;
}
