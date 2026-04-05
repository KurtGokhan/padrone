import { defineCommand } from 'padrone';
import * as z from 'zod/v4';
import * as store from './store.ts';

/**
 * Service commands defined with `defineCommand()` — demonstrates modular command definitions
 * that can be registered on a parent command via `.command('name', listServices)`.
 */

export const listServices = defineCommand((c) =>
  c
    .configure({ title: 'List registered services' })
    .arguments(
      z.object({
        status: z.enum(['running', 'stopped', 'deploying', 'failed']).optional().describe('Filter by service status').meta({ flags: 's' }),
      }),
    )
    .action((args) => {
      const services = store.getServices().filter((s) => !args.status || s.status === args.status);
      if (services.length === 0) return 'No services found.';

      const header = `${'NAME'.padEnd(12)} ${'IMAGE'.padEnd(25)} ${'PORT'.padEnd(6)} ${'REPLICAS'.padEnd(10)} STATUS`;
      const divider = '-'.repeat(70);
      const rows = services.map(
        (s) => `${s.name.padEnd(12)} ${s.image.padEnd(25)} ${String(s.port).padEnd(6)} ${String(s.replicas).padEnd(10)} ${s.status}`,
      );
      return [header, divider, ...rows].join('\n');
    }),
);

export const addService = defineCommand((c) =>
  c
    .configure({
      title: 'Register a new service',
      examples: ['deploy service add api myorg/api:latest --port 8080 --replicas 3'],
    })
    .arguments(
      z.object({
        name: z.string().nonempty().describe('Service name'),
        image: z.string().nonempty().describe('Container image (e.g. myorg/api:latest)'),
        port: z.number().describe('Port the service listens on').meta({ flags: 'p' }),
        replicas: z.number().default(1).describe('Number of replicas').meta({ flags: 'r' }),
      }),
      {
        positional: ['name', 'image'],
        interactive: ['name', 'image', 'port'],
      },
    )
    .action((args) => {
      const svc = store.addService(args);
      return `Service "${svc.name}" registered (${svc.image}, port ${svc.port}, ${svc.replicas} replica(s))`;
    }),
);

export const scaleService = defineCommand((c) =>
  c
    .configure({ title: 'Scale service replicas', mutation: true })
    .arguments(
      z.object({
        name: z.string().describe('Service name'),
        replicas: z.number().describe('Target replica count').meta({ flags: 'r' }),
      }),
      { positional: ['name'] },
    )
    .action((args) => {
      const svc = store.scaleService(args.name, args.replicas);
      return `Service "${svc.name}" scaled to ${svc.replicas} replica(s)`;
    }),
);
