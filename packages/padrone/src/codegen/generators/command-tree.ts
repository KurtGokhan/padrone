import { fieldMetaToCode } from '../schema-to-code.ts';
import type { CommandMeta, GeneratorContext } from '../types.ts';
import type { CommandFileOptions } from './command-file.ts';
import { generateCommandFile, toCommandFunctionName } from './command-file.ts';

export interface CommandTreeOptions {
  /** When set, generates .wrap() calls instead of .action(). */
  wrap?: {
    /** The external command being wrapped (e.g. 'gh'). */
    command: string;
  };
}

/**
 * Walk a CommandMeta tree and emit one file per command plus a root program file.
 * Maps nested subcommands to a directory structure.
 */
export function generateCommandTree(root: CommandMeta, ctx: GeneratorContext, options?: CommandTreeOptions): void {
  const rootImports: { name: string; varName: string; path: string; aliases?: string[] }[] = [];

  // Recursively generate command files (depth-first so children exist before parents)
  function walkCommands(cmd: CommandMeta, dirPath: string, parentArgs: string[]): void {
    if (cmd === root) {
      for (const sub of cmd.subcommands || []) {
        walkCommands(sub, 'commands', []);
      }
      return;
    }

    const filePath = `${dirPath}/${cmd.name}.ts`;

    // Recurse into subcommands first so we can reference them
    const childRefs: { name: string; varName: string; importPath: string; aliases?: string[] }[] = [];
    if (cmd.subcommands && cmd.subcommands.length > 0) {
      for (const sub of cmd.subcommands) {
        walkCommands(sub, `${dirPath}/${cmd.name}`, [...parentArgs, cmd.name]);
        childRefs.push({
          name: sub.name,
          varName: toCommandFunctionName(sub.name),
          importPath: `./${cmd.name}/${sub.name}.ts`,
          aliases: sub.aliases,
        });
      }
    }

    const fileOptions: CommandFileOptions = {};
    if (options?.wrap) {
      fileOptions.wrap = { command: options.wrap.command, args: [...parentArgs, cmd.name] };
    }
    if (childRefs.length > 0) {
      fileOptions.subcommands = childRefs;
    }

    const code = generateCommandFile(cmd, ctx, Object.keys(fileOptions).length > 0 ? fileOptions : undefined);
    ctx.emitter.addFile(filePath, code.build());

    rootImports.push({
      name: cmd.name,
      varName: toCommandFunctionName(cmd.name),
      path: `./${filePath.replace(/\.ts$/, '.ts')}`,
      aliases: cmd.aliases,
    });
  }

  walkCommands(root, '', []);

  // Generate root program.ts
  const program = ctx.createCodeBuilder();

  const rootHasArgs = (root.arguments && root.arguments.length > 0) || (root.positionals && root.positionals.length > 0);
  if (rootHasArgs) {
    program.import('z', 'zod/v4');
  }
  program.import(['createPadrone'], 'padrone');

  // Only import direct children of root
  const directChildren = rootImports.filter((imp) => imp.path.split('/').length <= 3);
  for (const imp of directChildren) {
    program.import([imp.varName], imp.path);
  }

  program.line();
  program.line(`const program = createPadrone(${JSON.stringify(root.name)})`);

  // .configure()
  const configParts: string[] = [];
  if (root.description) {
    configParts.push(`description: ${JSON.stringify(root.description)}`);
  }
  if (configParts.length > 0) {
    program.line(`  .configure({ ${configParts.join(', ')} })`);
  }

  // Root arguments (for programs that have options at the root level)
  if (rootHasArgs) {
    const allFields = [...(root.arguments || []), ...(root.positionals || [])];
    const schemaCode = fieldMetaToCode(allFields);
    program.line(`  .arguments(${schemaCode.code})`);
  }

  // Chain .command() calls for direct children
  for (const imp of directChildren) {
    const nameArg =
      imp.aliases && imp.aliases.length > 0
        ? `[${JSON.stringify(imp.name)}, ${imp.aliases.map((a) => JSON.stringify(a)).join(', ')}]`
        : JSON.stringify(imp.name);
    program.line(`  .command(${nameArg}, ${imp.varName})`);
  }

  // If root has no subcommands, add .wrap() or .action()
  if (directChildren.length === 0 && options?.wrap) {
    program.line(`  .wrap({ command: ${JSON.stringify(options.wrap.command)} })`);
  }

  program.line();
  program.line(`export default program`);

  ctx.emitter.addFile('program.ts', program.build());

  // Generate index.ts
  const index = ctx.createCodeBuilder();
  index.line(`export { default } from './program.ts'`);
  ctx.emitter.addFile('index.ts', index.build());
}
