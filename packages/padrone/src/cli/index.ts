import { createPadrone } from 'padrone';
import pkg from 'padrone/package.json' with { type: 'json' };
import * as z from 'zod/v4';
import { runDocs } from './docs.ts';
import { runDoctor } from './doctor.ts';
import { runInit } from './init.ts';

const PadroneCLI = createPadrone('padrone')
  .configure({
    version: pkg.version,
    title: 'Padrone CLI',
    description: 'The Padrone CLI',
  })
  .command('init', (cmd) =>
    cmd
      .configure({
        description: 'Scaffold a new Padrone CLI project',
      })
      .arguments(
        z.object({
          name: z.string().optional().describe('Project name (defaults to directory name)'),
          description: z.string().optional().describe('Project description'),
          version: z.string().optional().default('0.1.0').describe('Initial version'),
          dir: z.string().optional().describe('Target directory (defaults to current directory)'),
        }),
        {
          positional: ['dir'],
        },
      )
      .async()
      .action(runInit),
  )
  .command('docs', (cmd) =>
    cmd
      .configure({
        description: 'Generate documentation for a Padrone CLI program',
      })
      .arguments(
        z.object({
          entry: z.string().describe('Entry file that exports a Padrone program'),
          output: z.string().optional().default('./docs/cli').describe('Output directory'),
          format: z.enum(['markdown', 'html', 'man', 'json']).optional().default('markdown').describe('Output format'),
          includeHidden: z.boolean().optional().default(false).describe('Include hidden commands and options'),
          dryRun: z.boolean().optional().default(false).describe('Print what would be generated without writing'),
        }),
        {
          positional: ['entry'],
        },
      )
      .async()
      .action(runDocs),
  )
  .command('doctor', (cmd) =>
    cmd
      .configure({
        description: 'Lint and validate a Padrone CLI program definition',
      })
      .arguments(
        z.object({
          entry: z.string().describe('Entry file that exports a Padrone program'),
        }),
        {
          positional: ['entry'],
        },
      )
      .async()
      .action(runDoctor),
  );

if (import.meta.main) {
  try {
    const cliRes = await PadroneCLI.cli();
    await cliRes.result;
  } catch (error) {
    console.error('Error running Padrone CLI:', error);
    process.exit(1);
  }
}

export default PadroneCLI;
export { PadroneCLI };
