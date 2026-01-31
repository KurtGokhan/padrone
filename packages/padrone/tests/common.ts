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
        .options(
          z.object({
            status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
            limit: z.coerce.number().min(1).max(100).optional().default(10).describe('Maximum number of tasks'),
            priority: z.enum(['low', 'medium', 'high']).optional().default('medium').describe('Filter by priority'),
          }),
        )
        .action((options) => {
          return {
            status: options.status || 'all',
            limit: options?.limit || 10,
            tasks: mockTaskData.tasks.slice(0, options?.limit || 10),
          };
        })
        .command('extended', (c) =>
          c
            .options(
              z.object({
                status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
                priority: z.enum(['low', 'medium', 'high']).optional().default('medium').describe('Filter by priority'),
              }),
            )
            .action((options) => {
              return {
                status: options.status || 'all',
                extendedList: mockTaskData.tasks,
                priority: options?.priority,
              };
            })
            .command('extended', (c) =>
              c
                .options(
                  z.object({
                    status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
                  }),
                )
                .action((options) => {
                  return {
                    status: options.status || 'all',
                    extendedList: mockTaskData.tasks,
                  };
                }),
            ),
        ),
    )
    .command('show', (c) =>
      c
        .options(
          z.object({
            id: z.string().describe('Task ID'),
            priority: z.enum(['low', 'medium', 'high']).optional().default('medium').describe('Priority level'),
            verbose: z.boolean().optional().describe('Show detailed information'),
          }),
          {
            positional: ['id'],
          },
        )
        .action((options) => {
          const { id } = options;
          return {
            id,
            title: options?.priority === 'high' ? 'Important Task' : 'Regular Task',
            status: mockTaskData.tasks[0]?.status,
            stats: options?.verbose ? mockTaskData.stats : undefined,
          };
        }),
    )
    .command('filter', (c) =>
      c
        .options(
          z.object({
            status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
            priority: z.enum(['low', 'medium', 'high']).optional().describe('Filter by priority'),
            ascending: z.boolean().optional().describe('Sort in ascending order'),
          }),
        )
        .action((options) => {
          return {
            status: options?.status || 'all',
            tasks: mockTaskData.tasks,
            priority: options?.priority,
          };
        }),
    )
    .command('batch', (c) =>
      c
        .options(
          z.object({
            ids: z.array(z.string()).min(2).describe('Task IDs to process'),
          }),
          {
            positional: ['...ids'],
          },
        )
        .action((options) => {
          const { ids } = options;
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
    .command('noop', (c) => c.action(() => undefined))
    .command('tags', (c) =>
      c
        .options(
          z.object({
            verbose: z.boolean().optional(),
          }),
          {
            options: {
              verbose: {
                alias: 'v',
                description: 'Show detailed information',
              },
            },
          },
        )
        .action(),
    )
    .command('deprecated-test', (c) =>
      c
        .options(
          z.object({
            oldOption: z.string().optional().describe('Old option'),
            newOption: z.string().optional().describe('New option'),
            deprecatedWithMessage: z.boolean().optional().describe('Deprecated option with message'),
          }),
          {
            options: {
              oldOption: {
                deprecated: true,
                description: 'This option is deprecated',
              },
              newOption: {
                description: 'This is the new option',
              },
              deprecatedWithMessage: {
                deprecated: 'Use newOption instead',
                description: 'This option is deprecated with a message',
              },
            },
          },
        )
        .action(),
    )
    .command('hidden-test', (c) =>
      c
        .options(
          z.object({
            visibleOption: z.string().optional().describe('This option should be visible'),
            hiddenOption: z.string().optional().describe('This option should be hidden'),
            anotherVisible: z.boolean().optional().describe('Another visible option'),
          }),
          {
            options: {
              visibleOption: {
                description: 'This option is visible in help',
              },
              hiddenOption: {
                hidden: true,
                description: 'This option should not appear in help',
              },
              anotherVisible: {
                description: 'This option is also visible',
              },
            },
          },
        )
        .action(),
    )
    .command('examples-test', (c) =>
      c
        .options(
          z.object({
            output: z.string().optional().describe('Output file path'),
            format: z.enum(['json', 'yaml', 'xml']).optional().describe('Output format'),
            verbose: z.boolean().optional().describe('Enable verbose output'),
            config: z.string().optional().describe('Configuration file'),
          }),
          {
            options: {
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
