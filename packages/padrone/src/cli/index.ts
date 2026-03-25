import { createPadrone } from 'padrone';
import pkg from 'padrone/package.json' with { type: 'json' };
import { completionsSchema, runCompletions } from './completions.ts';
import { docsSchema, runDocs } from './docs.ts';
import { doctorSchema, runDoctor } from './doctor.ts';
import { initSchema, runInit } from './init.ts';
import { linkSchema, runLink, runUnlink, unlinkSchema } from './link.ts';
import { runWrap, wrapSchema } from './wrap.ts';

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
      .arguments(initSchema, {
        positional: ['dir'],
      })
      .async()
      .action(runInit),
  )
  .command('docs', (cmd) =>
    cmd
      .configure({
        description: 'Generate documentation for a Padrone CLI program',
      })
      .arguments(docsSchema, {
        positional: ['entry'],
      })
      .async()
      .action(runDocs),
  )
  .command('doctor', (cmd) =>
    cmd
      .configure({
        description: 'Lint and validate a Padrone CLI program definition',
      })
      .arguments(doctorSchema, {
        positional: ['entry'],
      })
      .async()
      .action(runDoctor),
  )
  .command('completions', (cmd) =>
    cmd
      .configure({
        description: 'Show shell completion install instructions for a Padrone CLI program',
      })
      .arguments(completionsSchema, {
        positional: ['appPath'],
      })
      .action(runCompletions),
  )
  .command('link', (cmd) =>
    cmd
      .configure({
        description: 'Link a Padrone CLI program for global use during development',
      })
      .arguments(linkSchema, {
        positional: ['entry'],
      })
      .async()
      .action(runLink),
  )
  .command('unlink', (cmd) =>
    cmd
      .configure({
        description: 'Remove a previously linked Padrone CLI program',
      })
      .arguments(unlinkSchema, {
        positional: ['name'],
      })
      .async()
      .action(runUnlink),
  )
  .command('wrap', (cmd) =>
    cmd
      .configure({
        description: 'Generate a Padrone wrapper for an existing CLI tool',
      })
      .arguments(wrapSchema, {
        positional: ['command'],
        fields: { yes: { alias: 'y' } },
      })
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
