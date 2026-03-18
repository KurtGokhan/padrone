import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

// Mock task data for testing
const mockTaskData = {
  tasks: [
    { id: 'task-1', title: 'Review PR', status: 'pending', priority: 'high', tags: ['work'] },
    { id: 'task-2', title: 'Buy groceries', status: 'in_progress', priority: 'medium', tags: ['personal'] },
  ],
  stats: { total: 5, completed: 2, pending: 3 },
};

export function createTasksProgram() {
  return createPadrone('padrone-test')
    .command('list', (c) =>
      c
        .arguments(
          z.object({
            status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
            limit: z.coerce.number().min(1).max(100).optional().default(10).describe('Maximum number of tasks'),
            priority: z.enum(['low', 'medium', 'high']).optional().default('medium').describe('Filter by priority'),
          }),
        )
        .action((args) => {
          return {
            status: args.status || 'all',
            limit: args?.limit || 10,
            tasks: mockTaskData.tasks.slice(0, args?.limit || 10),
          };
        })
        .command('extended', (c) =>
          c
            .arguments(
              z.object({
                status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
                priority: z.enum(['low', 'medium', 'high']).optional().default('medium').describe('Filter by priority'),
              }),
            )
            .action((args) => {
              return {
                status: args.status || 'all',
                extendedList: mockTaskData.tasks,
                priority: args?.priority,
              };
            })
            .command('extended', (c) =>
              c
                .arguments(
                  z.object({
                    status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
                  }),
                )
                .action((args) => {
                  return {
                    status: args.status || 'all',
                    extendedList: mockTaskData.tasks,
                  };
                }),
            ),
        ),
    )
    .command('show', (c) =>
      c
        .arguments(
          z.object({
            id: z.string().describe('Task ID'),
            priority: z.enum(['low', 'medium', 'high']).optional().default('medium').describe('Priority level'),
            verbose: z.boolean().optional().describe('Show detailed information'),
          }),
          {
            positional: ['id'],
          },
        )
        .action((args) => {
          const { id } = args;
          return {
            id,
            title: args?.priority === 'high' ? 'Important Task' : 'Regular Task',
            status: mockTaskData.tasks[0]?.status,
            stats: args?.verbose ? mockTaskData.stats : undefined,
          };
        }),
    )
    .command('filter', (c) =>
      c
        .arguments(
          z.object({
            status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
            priority: z.enum(['low', 'medium', 'high']).optional().describe('Filter by priority'),
            ascending: z.boolean().optional().describe('Sort in ascending order'),
          }),
        )
        .action((args) => {
          return {
            status: args?.status || 'all',
            tasks: mockTaskData.tasks,
            priority: args?.priority,
          };
        }),
    )
    .command('batch', (c) =>
      c
        .arguments(
          z.object({
            ids: z.array(z.string()).min(2).describe('Task IDs to process'),
          }),
          {
            positional: ['...ids'],
          },
        )
        .action((args) => {
          const { ids } = args;
          return {
            ids,
            results: ids.map((id) => ({
              id,
              status: 'processed',
              title: 'Task',
            })),
          };
        }),
    )
    .command('search', (c) =>
      c
        .arguments(
          z.object({
            status: z
              .array(z.enum(['pending', 'in_progress', 'completed']))
              .optional()
              .describe('Filter by status'),
            query: z.string().describe('Search query'),
          }),
          {
            positional: ['query'],
            fields: {
              status: { flags: 's' },
            },
          },
        )
        .action((args) => {
          return { query: args.query, status: args.status };
        }),
    )
    .command('noop', (c) => c.action(() => undefined))
    .command('tags', (c) =>
      c
        .arguments(
          z.object({
            verbose: z.boolean().optional(),
          }),
          {
            fields: {
              verbose: {
                flags: 'v',
                description: 'Show detailed information',
              },
            },
          },
        )
        .action(),
    )
    .command('deprecated-test', (c) =>
      c
        .arguments(
          z.object({
            oldArg: z.string().optional().describe('Old arg'),
            newArg: z.string().optional().describe('New arg'),
            deprecatedWithMessage: z.boolean().optional().describe('Deprecated arg with message'),
          }),
          {
            fields: {
              oldArg: {
                deprecated: true,
                description: 'This arg is deprecated',
              },
              newArg: {
                description: 'This is the new arg',
              },
              deprecatedWithMessage: {
                deprecated: 'Use newArg instead',
                description: 'This arg is deprecated with a message',
              },
            },
          },
        )
        .action(),
    )
    .command('hidden-test', (c) =>
      c
        .arguments(
          z.object({
            visibleArg: z.string().optional().describe('This arg should be visible'),
            hiddenArg: z.string().optional().describe('This arg should be hidden'),
            anotherVisible: z.boolean().optional().describe('Another visible arg'),
          }),
          {
            fields: {
              visibleArg: {
                description: 'This arg is visible in help',
              },
              hiddenArg: {
                hidden: true,
                description: 'This arg should not appear in help',
              },
              anotherVisible: {
                description: 'This arg is also visible',
              },
            },
          },
        )
        .action(),
    )
    .command('examples-test', (c) =>
      c
        .arguments(
          z.object({
            output: z.string().optional().describe('Output file path'),
            format: z.enum(['json', 'yaml', 'xml']).optional().describe('Output format'),
            verbose: z.boolean().optional().describe('Enable verbose output'),
            config: z.string().optional().describe('Configuration file'),
          }),
          {
            fields: {
              output: {
                description: 'Specify the output file path',
                examples: ['output.txt', './dist/result.json'],
              },
              format: {
                description: 'Choose the output format',
                examples: ['json', 'yaml'],
              },
              verbose: {
                description: 'Show detailed information',
                examples: [true],
              },
              config: {
                description: 'Path to configuration file',
                examples: ['./config.json', '~/.config/app.json'],
              },
            },
          },
        )
        .action(),
    );
}
