import { createPadrone, padroneConfig, padroneEnv, padroneLogger, padroneTiming } from 'padrone';
import * as z from 'zod/v4';
import { authInterceptor } from './auth.ts';
import { envProgram } from './env-commands.ts';
import { addService, listServices, scaleService } from './service-commands.ts';
import * as store from './store.ts';

/**
 * Deploy CLI — a comprehensive example demonstrating most Padrone features:
 *
 * - createPadrone + configure (title, description, version)
 * - Zod argument schemas with positional, flags, aliases, defaults, descriptions
 * - Boolean negation with custom keyword (negative: 'silent')
 * - Command aliases
 * - Nested subcommands
 * - Typed context (.context<T>)
 * - defineInterceptor with .provides<T>() (auth.ts)
 * - defineCommand for modular definitions (service-commands.ts)
 * - .mount() for program composition (env-commands.ts)
 * - Built-in extensions: padroneLogger, padroneTiming, padroneEnv, padroneConfig
 * - Mutation commands (.configure({ mutation: true }))
 * - Command groups
 * - Async commands
 * - Interactive prompts
 * - Examples in configure
 * - autoAlias (camelCase -> kebab-case)
 */

const program = createPadrone('deploy')
  .configure({
    title: 'Deploy CLI',
    description: 'Manage deployments, environments, and services from the command line.',
    version: '0.1.0',
  })
  .extend(padroneLogger())
  .extend(padroneTiming())
  .extend(
    padroneEnv(
      z.object({ DEPLOY_DEFAULT_ENV: z.string().optional() }).transform((vars) => ({
        env: vars.DEPLOY_DEFAULT_ENV,
      })),
    ),
  )
  .extend(padroneConfig({ files: ['deploy.config.json', '.deployrc'] }))
  .intercept(authInterceptor)
  .context<{ project: string }>()

  // --- Mount environment program (demonstrates .mount()) ---
  .mount(['env', 'environment'], envProgram.configure({ group: 'Resources' }))

  // --- Service subcommands via defineCommand (demonstrates .command() + defineCommand) ---
  .command(['service', 'svc'], (c) =>
    c
      .configure({ title: 'Service management', group: 'Resources' })
      .command(['list', 'ls'], listServices)
      .command('add', addService)
      .command('scale', scaleService),
  )

  // --- Inline commands ---

  .command('status', (c) =>
    c
      .configure({ title: 'Show recent deployment status', group: 'Deployment' })
      .arguments(
        z.object({
          env: z.string().optional().describe('Filter by environment').meta({ flags: 'e' }),
          limit: z.number().default(5).describe('Number of recent deployments to show').meta({ flags: 'l' }),
        }),
      )
      .action((args) => {
        const deployments = store.getDeployments({ env: args.env, limit: args.limit });
        if (deployments.length === 0) return 'No deployments found.';

        const header = `${'ID'.padEnd(12)} ${'SERVICE'.padEnd(10)} ${'ENV'.padEnd(12)} ${'VERSION'.padEnd(10)} ${'STATUS'.padEnd(12)} STARTED`;
        const divider = '-'.repeat(80);
        const rows = deployments.map(
          (d) =>
            `${d.id.padEnd(12)} ${d.service.padEnd(10)} ${d.env.padEnd(12)} ${d.version.padEnd(10)} ${d.status.padEnd(12)} ${d.startedAt}`,
        );
        return [header, divider, ...rows].join('\n');
      }),
  )

  .command(['up', 'deploy'], (c) =>
    c
      .configure({
        title: 'Deploy a service to an environment',
        group: 'Deployment',
        examples: ['deploy up api v1.3.0 --env staging', 'deploy up web v2.1.0 --env production --replicas 5 --silent'],
      })
      .async()
      .arguments(
        z.object({
          service: z.string().describe('Service to deploy'),
          tag: z
            .string()
            .describe('Version tag to deploy')
            .meta({ alias: ['image-tag'] }),
          env: z.string().default('staging').describe('Target environment').meta({ flags: 'e' }),
          replicas: z.number().optional().describe('Override replica count').meta({ flags: 'r' }),
          dryRun: z.boolean().default(false).describe('Simulate deployment without applying changes'),
          notify: z.boolean().default(true).describe('Send deployment notifications').meta({ flags: 'n', negative: 'silent' }),
          wait: z.boolean().default(true).describe('Wait for deployment to complete').meta({ flags: 'w' }),
        }),
        {
          positional: ['service', 'tag'],
          interactive: ['service', 'tag'],
        },
      )
      .action(async (args, ctx) => {
        const svc = store.getService(args.service);
        if (!svc) throw new Error(`Service "${args.service}" not found. Run "deploy service list" to see available services.`);

        ctx.context.logger.info(`Deploying ${args.service}@${args.tag} to ${args.env} (project: ${ctx.context.project})`);

        if (args.dryRun) {
          return `[dry-run] Would deploy ${args.service}@${args.tag} to ${args.env}`;
        }

        if (args.replicas) {
          store.scaleService(args.service, args.replicas);
          ctx.context.logger.info(`Scaled ${args.service} to ${args.replicas} replica(s)`);
        }

        const deployment = store.createDeployment(args.env, args.service, args.tag);

        if (args.wait) {
          ctx.context.logger.info('Waiting for deployment to complete...');
          await new Promise((resolve) => setTimeout(resolve, 1500));
          store.finishDeployment(deployment.id, 'success');
        }

        if (args.notify) {
          ctx.context.logger.info(`Notification sent for deployment ${deployment.id}`);
        }

        return `Deployment ${deployment.id}: ${args.service}@${args.tag} -> ${args.env} [success]`;
      }),
  )

  .command('rollback', (c) =>
    c
      .configure({
        title: 'Rollback a service to the previous version',
        group: 'Deployment',
        mutation: true,
      })
      .arguments(
        z.object({
          service: z.string().describe('Service to rollback'),
          env: z.string().default('staging').describe('Target environment').meta({ flags: 'e' }),
        }),
        { positional: ['service'] },
      )
      .action((args, ctx) => {
        ctx.context.logger.info(`Rolling back ${args.service} in ${args.env}...`);
        const deployment = store.rollbackDeployment(args.env, args.service);
        return `Rolled back ${args.service} in ${args.env} (was: ${deployment.version})`;
      }),
  )

  .command('logs', (c) =>
    c
      .configure({ title: 'View service logs', group: 'Deployment' })
      .arguments(
        z.object({
          service: z.string().describe('Service name'),
          lines: z.number().default(10).describe('Number of log lines to show').meta({ flags: 'n' }),
          follow: z.boolean().default(false).describe('Follow log output in real time').meta({ flags: 'f' }),
        }),
        { positional: ['service'] },
      )
      .action((args) => {
        const svc = store.getService(args.service);
        if (!svc) throw new Error(`Service "${args.service}" not found`);

        const logLines = Array.from({ length: args.lines }, (_, i) => {
          const ts = new Date(Date.now() - (args.lines - i) * 60_000).toISOString();
          return `[${ts}] ${args.service}: Request processed (${200 + (i % 5)})`;
        });
        return logLines.join('\n');
      }),
  );

if (import.meta.main) {
  await program.cli({ context: { project: 'my-app' } });
}

export default program;
