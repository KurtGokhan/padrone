import { createPadrone } from 'padrone';
import pkg from 'padrone/package.json' with { type: 'json' };
import * as z from 'zod/v4';
import { runCompletions } from './completions.ts';
import { runDocs } from './docs.ts';
import { runDoctor } from './doctor.ts';
import { runInit } from './init.ts';
import { runLink, runUnlink } from './link.ts';
import { runWrap } from './wrap.ts';

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
  )
  .command('completions', (cmd) =>
    cmd
      .configure({
        description: 'Show shell completion install instructions for a Padrone CLI program',
      })
      .arguments(
        z.object({
          appPath: z.string().optional().describe('Path or name of the CLI program (defaults to padrone)'),
          for: z.enum(['bash', 'zsh', 'fish', 'powershell']).optional().describe('Target shell (auto-detected if omitted)'),
          setup: z.boolean().optional().default(false).describe('Write completions to shell config file'),
        }),
        {
          positional: ['appPath'],
        },
      )
      .action(runCompletions),
  )
  .command('link', (cmd) =>
    cmd
      .configure({
        description: 'Link a Padrone CLI program for global use during development',
      })
      .arguments(
        z.object({
          entry: z.string().optional().describe('Entry file (auto-detected from package.json bin field)'),
          name: z.string().optional().describe('Command name (auto-detected from package.json)'),
          list: z.boolean().optional().default(false).describe('List all linked programs'),
          setup: z.boolean().optional().default(false).describe('Add ~/.padrone/bin to PATH in shell config'),
        }),
        {
          positional: ['entry'],
        },
      )
      .async()
      .action(runLink),
  )
  .command('unlink', (cmd) =>
    cmd
      .configure({
        description: 'Remove a previously linked Padrone CLI program',
      })
      .arguments(
        z.object({
          name: z.string().optional().describe('Program name to unlink (auto-detected from current directory)'),
        }),
        {
          positional: ['name'],
        },
      )
      .async()
      .action(runUnlink),
  )
  .command('wrap', (cmd) =>
    cmd
      .configure({
        description: 'Generate a Padrone wrapper for an existing CLI tool',
      })
      .arguments(
        z.object({
          command: z.string().describe('CLI command to wrap (e.g. gh, docker, kubectl)'),
          source: z.enum(['help', 'fish', 'zsh']).optional().default('help').describe('Parsing source (default: help)'),
          output: z.string().optional().describe('Output directory (default: ./src/<command>)'),
          depth: z.number().optional().describe('Max subcommand depth (default: unlimited)'),
          dryRun: z.boolean().optional().default(false).describe('Print what would be generated without writing'),
          overwrite: z.boolean().optional().default(false).describe('Overwrite existing files'),
        }),
        {
          positional: ['command'],
        },
      )
      .async()
      .action(runWrap),
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
