import type { CommandMeta, GeneratorContext } from '../types.ts';
import type { CommandFileOptions } from './command-file.ts';
import { generateCommandFile } from './command-file.ts';

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
  const commandImports: { name: string; path: string }[] = [];

  // Recursively generate command files
  function walkCommands(cmd: CommandMeta, dirPath: string, parentArgs: string[]): void {
    if (cmd === root) {
      // Root's subcommands are the top-level commands
      for (const sub of cmd.subcommands || []) {
        walkCommands(sub, 'commands', []);
      }
      return;
    }

    const filePath = `${dirPath}/${cmd.name}.ts`;

    const fileOptions: CommandFileOptions | undefined = options?.wrap
      ? { wrap: { command: options.wrap.command, args: [...parentArgs, cmd.name] } }
      : undefined;

    const code = generateCommandFile(cmd, ctx, fileOptions);
    ctx.emitter.addFile(filePath, code.build());

    commandImports.push({ name: cmd.name, path: `./${filePath.replace(/\.ts$/, '.ts')}` });

    // Recurse into subcommands
    if (cmd.subcommands && cmd.subcommands.length > 0) {
      for (const sub of cmd.subcommands) {
        walkCommands(sub, `${dirPath}/${cmd.name}`, [...parentArgs, cmd.name]);
      }
    }
  }

  walkCommands(root, '', []);

  // Generate root program.ts
  const program = ctx.createCodeBuilder();
  program.import(['createPadrone'], 'padrone');

  for (const imp of commandImports) {
    // Only import direct children of root
    if (imp.path.split('/').length <= 3) {
      program.import(imp.name, imp.path);
    }
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

  // Chain .command() calls for direct children
  for (const imp of commandImports) {
    if (imp.path.split('/').length <= 3) {
      program.line(`  .command(${JSON.stringify(imp.name)}, ${imp.name})`);
    }
  }

  program.line();
  program.line(`export default program`);

  ctx.emitter.addFile('program.ts', program.build());

  // Generate index.ts
  const index = ctx.createCodeBuilder();
  index.line(`export { default } from './program.ts'`);
  ctx.emitter.addFile('index.ts', index.build());
}
