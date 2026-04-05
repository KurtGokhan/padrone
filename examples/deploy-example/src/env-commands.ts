import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import * as store from './store.ts';

const regionSchema = z.enum(['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1']);

/**
 * Environment management program — mounted into the main CLI via `.mount('env', envProgram)`.
 * Demonstrates using a standalone program for modular command composition.
 */
export const envProgram = createPadrone('env')
  .configure({
    title: 'Environment Management',
    description: 'Manage deployment target environments',
  })

  .command(['list', 'ls'], (c) =>
    c
      .configure({ title: 'List environments' })
      .arguments(
        z.object({
          production: z.boolean().optional().describe('Show only production environments'),
        }),
      )
      .action((args) => {
        const envs = store.getEnvironments().filter((e) => args.production === undefined || e.production === args.production);
        if (envs.length === 0) return 'No environments found.';

        const header = `${'NAME'.padEnd(15)} ${'URL'.padEnd(35)} ${'REGION'.padEnd(15)} PROD`;
        const divider = '-'.repeat(70);
        const rows = envs.map((e) => `${e.name.padEnd(15)} ${e.url.padEnd(35)} ${e.region.padEnd(15)} ${e.production ? 'yes' : 'no'}`);
        return [header, divider, ...rows].join('\n');
      }),
  )

  .command('add', (c) =>
    c
      .configure({
        title: 'Add a new environment',
        examples: ['deploy env add staging https://staging.example.com --region us-west-2'],
      })
      .arguments(
        z.object({
          name: z.string().nonempty().describe('Environment name'),
          url: z.string().url().describe('Environment base URL'),
          region: regionSchema.default('us-east-1').describe('AWS region').meta({ flags: 'r' }),
          production: z.boolean().default(false).describe('Mark as production environment').meta({ flags: 'p' }),
        }),
        {
          positional: ['name', 'url'],
          interactive: ['name', 'url'],
        },
      )
      .action((args) => {
        const env = store.addEnvironment(args);
        return `Environment "${env.name}" created (${env.url}, ${env.region})`;
      }),
  )

  .command(['remove', 'rm'], (c) =>
    c
      .configure({ title: 'Remove an environment', mutation: true })
      .arguments(
        z.object({
          name: z.string().describe('Environment name to remove'),
          force: z.boolean().default(false).describe('Force removal of production environments').meta({ flags: 'f' }),
        }),
        { positional: ['name'] },
      )
      .action((args) => {
        store.removeEnvironment(args.name, args.force);
        return `Environment "${args.name}" removed`;
      }),
  );
