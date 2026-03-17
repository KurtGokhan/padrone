import { createPadrone } from 'padrone';
import pkg from 'padrone/package.json' with { type: 'json' };
import * as z from 'zod/v4';
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
