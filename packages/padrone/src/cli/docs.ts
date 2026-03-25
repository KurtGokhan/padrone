import { resolve } from 'node:path';
import { isPadroneProgram } from '../core/commands.ts';
import { type DocsFormat, generateDocs } from '../docs/index.ts';
import type { PadroneActionContext } from '../types/index.ts';

interface DocsArgs {
  entry: string;
  output?: string;
  format?: DocsFormat;
  includeHidden?: boolean;
  dryRun?: boolean;
}

export async function runDocs(args: DocsArgs, _ctx: PadroneActionContext) {
  const entryPath = resolve(args.entry);

  let mod: Record<string, unknown>;
  try {
    mod = (await import(entryPath)) as Record<string, unknown>;
  } catch (err) {
    console.error(`Failed to import entry file: ${entryPath}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Look for a padrone program export (default export or named export with .cli method)
  const program = findProgram(mod);
  if (!program) {
    console.error('No Padrone program found in the entry file.');
    console.error('The entry file must export a Padrone program (default or named export).');
    process.exit(1);
  }

  const result = generateDocs(program, {
    format: args.format,
    output: args.output,
    includeHidden: args.includeHidden,
    dryRun: args.dryRun,
  });

  if (args.dryRun) {
    console.log('Dry run — files that would be generated:');
    for (const page of result.pages) {
      console.log(`  ${page.path}`);
    }
    return;
  }

  if (result.written.length > 0) {
    console.log(`Generated ${result.written.length} documentation file(s):`);
    for (const file of result.written) {
      console.log(`  ${file}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} existing file(s).`);
  }

  if (result.errors.length > 0) {
    console.error(`Failed to write ${result.errors.length} file(s):`);
    for (const { file, error } of result.errors) {
      console.error(`  ${file}: ${error.message}`);
    }
    process.exit(1);
  }
}

function findProgram(mod: Record<string, unknown>): any {
  // Check default export first
  const defaultExport = mod.default;
  if (isPadroneProgram(defaultExport)) return defaultExport;

  // Then check named exports
  for (const value of Object.values(mod)) {
    if (isPadroneProgram(value)) return value;
  }

  return null;
}
