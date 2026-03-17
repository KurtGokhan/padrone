import type { CodeBuilder, GeneratorContext } from '../types.ts';

/**
 * Generate an index.ts barrel file that re-exports all given files.
 */
export function generateBarrelFile(files: string[], ctx: GeneratorContext): CodeBuilder {
  const code = ctx.createCodeBuilder();

  for (const file of files) {
    // Strip .ts extension for the import path and ensure relative path
    const importPath = file.startsWith('./') ? file : `./${file}`;
    code.line(`export * from '${importPath}'`);
  }

  return code;
}
