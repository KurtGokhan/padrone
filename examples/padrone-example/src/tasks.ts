import { createPadrone, type PadronePlugin } from 'padrone';
import { zodAsyncStream } from 'padrone/zod';
import * as z from 'zod/v4';
import { addTask, getTask, getTasks, removeTask, setTaskStatus, updateTask } from './tasks-store.ts';

type CommandTelemetry = { command: string; startTime: Date; duration: number };

function telemetryPlugin(): PadronePlugin & { entries: CommandTelemetry[] } {
  const entries: CommandTelemetry[] = [];

  return {
    name: 'telemetry',
    entries,
    execute: (ctx, next) => {
      const startTime = new Date();
      const start = performance.now();
      const result = next();

      const record = () => {
        entries.push({ command: ctx.command.path || '(root)', startTime, duration: performance.now() - start });
      };

      if (result instanceof Promise) {
        return result.then((r) => {
          record();
          return r;
        });
      }
      record();
      return result;
    },
  };
}

const telemetry = telemetryPlugin();

const prioritySchema = z.enum(['low', 'medium', 'high']);
const statusSchema = z.enum(['pending', 'in_progress', 'completed']);

function formatTask(task: ReturnType<typeof getTask>) {
  if (!task) return '';

  const statusIcon = task.status === 'completed' ? '[x]' : task.status === 'in_progress' ? '[~]' : '[ ]';
  const priorityIcon = task.priority === 'high' ? '!!!' : task.priority === 'medium' ? '!!' : '!';
  const tags = task.tags.length > 0 ? ` [${task.tags.join(', ')}]` : '';
  const due = task.dueDate ? ` (due: ${task.dueDate})` : '';

  return `${statusIcon} ${task.id}: ${task.title} ${priorityIcon}${tags}${due}`;
}

export const tasksProgram = createPadrone('tasks')
  .configure({
    title: 'Task Manager CLI',
    description: 'A task manager CLI for managing your todos with support for priorities, tags, and due dates.',
    version: '1.0.0',
  })
  .use(telemetry)
  .runtime({ interactive: 'supported' })
  .command(['repl', ''], (c) =>
    c.configure({ title: 'Start interactive REPL', autoOutput: false }).action(async (_args, { program }) => {
      for await (const _ of program.repl({
        spacing: { before: ['▆', true], after: [true, '▆', true] },
        outputPrefix: '│   ',
      })) {
        // results are handled by each command's action
      }
    }),
  )
  .command('chat', (c) =>
    c
      .configure({ title: 'Start a conversation with the assistant', autoOutput: true })
      .async()
      .arguments(
        z.object({
          system: z.string().optional().describe('System prompt to set the context for the assistant').meta({ flags: 's' }),
          messages: zodAsyncStream(z.string().nonempty()),
        }),
        {
          positional: ['messages'],
          stdin: 'messages',
          interactive: ['system'],
        },
      )
      .action(async function* (args) {
        yield `Hello there. This is a simple echo assistant. Feel free to send messages, and I will echo them back!`;

        for await (const message of args.messages) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          yield `You said: ${message}`;
        }
      }),
  )
  .command(['add', 'create'], (c) =>
    c
      .configure({ title: 'Add a new task' })
      .arguments(
        z.object({
          title: z.string().nonempty().describe('Task title'),
          priority: prioritySchema.optional().default('medium').describe('Task priority').meta({ flags: 'p' }),
          tags: z.array(z.string()).optional().default([]).describe('Tags for categorization').meta({ flags: 't' }),
          due: z.string().optional().describe('Due date (YYYY-MM-DD)').meta({ flags: 'd' }),
          dryRun: z.boolean().optional().describe('Simulate adding a task without saving').meta({}),
        }),
        {
          positional: ['title'],
          interactive: ['title'],
          optionalInteractive: ['priority', 'tags', 'due'],
          stdin: 'title',
        },
      )
      .action((args) => {
        const task = addTask({
          title: args.title,
          priority: args.priority,
          tags: args.tags,
          dueDate: args.due,
          dryRun: args.dryRun,
        });
        return `Task added: ${formatTask(task)}`;
      }),
  )
  .command(['list', 'ls'], (c) =>
    c
      .configure({ title: 'List all tasks' })
      .arguments(
        z.object({
          status: z.array(statusSchema).optional().describe('Filter by status').meta({ flags: 's' }),
          priority: prioritySchema.optional().describe('Filter by priority').meta({ flags: 'p' }),
          tag: z.string().optional().describe('Filter by tag').meta({ flags: 't' }),
          limit: z.number().optional().describe('Limit number of tasks displayed').meta({ flags: 'l' }),
        }),
        { optionalInteractive: ['status', 'priority'] },
      )
      .action((args) => {
        const tasks = getTasks({
          status: args.status,
          priority: args.priority,
          tag: args.tag,
        }).slice(0, args.limit);

        if (tasks.length === 0) {
          return 'No tasks found.';
        }

        const lines = ['Tasks:\n', ...tasks.map((task) => `  ${formatTask(task)}`), `\nTotal: ${tasks.length} task(s)`];
        return lines.join('\n');
      }),
  )
  .command(['show', 'details'], (c) =>
    c
      .configure({ title: 'Show task details' })
      .arguments(
        z.object({
          id: z.string().describe('Task ID'),
        }),
        { positional: ['id'] },
      )
      .action((args) => {
        const task = getTask(args.id);

        if (!task) {
          throw new Error(`Task not found: ${args.id}`);
        }

        const lines = [
          'Task Details:\n',
          `  ID:       ${task.id}`,
          `  Title:    ${task.title}`,
          `  Status:   ${task.status}`,
          `  Priority: ${task.priority}`,
          `  Tags:     ${task.tags.length > 0 ? task.tags.join(', ') : '(none)'}`,
          `  Created:  ${task.createdAt}`,
          ...(task.dueDate ? [`  Due:      ${task.dueDate}`] : []),
        ];
        return lines.join('\n');
      }),
  )
  .command(['complete', 'done'], (c) =>
    c
      .configure({ title: 'Mark a task as completed' })
      .arguments(
        z.object({
          id: z.string().describe('Task ID'),
        }),
        { positional: ['id'] },
      )
      .action((args) => {
        const task = setTaskStatus(args.id, 'completed');

        if (!task) {
          throw new Error(`Task not found: ${args.id}`);
        }

        return `Task completed: ${formatTask(task)}`;
      }),
  )
  .command(['start', 'in-progress'], (c) =>
    c
      .configure({ title: 'Mark a task as in progress' })
      .arguments(
        z.object({
          id: z.string().describe('Task ID'),
        }),
        { positional: ['id'] },
      )
      .action((args) => {
        const task = setTaskStatus(args.id, 'in_progress');

        if (!task) {
          throw new Error(`Task not found: ${args.id}`);
        }

        return `Task started: ${formatTask(task)}`;
      }),
  )
  .command(['edit', 'update'], (c) =>
    c
      .configure({ title: 'Edit a task' })
      .arguments(
        z.object({
          id: z.string().describe('Task ID'),
          title: z.string().optional().describe('New title'),
          priority: prioritySchema.optional().describe('New priority').meta({ flags: 'p' }),
          tags: z.array(z.string()).optional().describe('New tags').meta({ flags: 't' }),
          due: z.string().optional().describe('New due date (YYYY-MM-DD)').meta({ flags: 'd' }),
        }),
        {
          positional: ['id'],
          interactive: ['id'],
          optionalInteractive: ['title', 'priority', 'due'],
        },
      )
      .action((args) => {
        const task = updateTask(args.id, {
          title: args.title,
          priority: args.priority,
          tags: args.tags,
          dueDate: args.due,
        });

        if (!task) {
          throw new Error(`Task not found: ${args.id}`);
        }

        return `Task updated: ${formatTask(task)}`;
      }),
  )
  .command(['remove', 'delete'], (c) =>
    c
      .configure({ title: 'Remove a task' })
      .arguments(
        z.object({
          id: z.string().describe('Task ID'),
        }),
        { positional: ['id'] },
      )
      .action((args) => {
        const removed = removeTask(args.id);

        if (!removed) {
          throw new Error(`Task not found: ${args.id}`);
        }

        return `Task removed: ${args.id}`;
      }),
  )
  .command('sync', (c) =>
    c
      .configure({ title: 'Sync tasks to remote', autoOutput: false })
      .async()
      .arguments(
        z.object({
          test: z
            .string()
            .optional()
            .describe('Test argument to demonstrate async progress')
            .transform(async (val) => {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              return val;
            })
            .meta({ flags: 't' }),
        }),
      )
      .action(async (_args, ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        ctx.progress.update('Finalizing sync...');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const tasks = getTasks();
        return {
          count: tasks.length,
          message: `Synced ${tasks.length} task(s) to remote.`,
        };
      })
      .progress({
        validation: 'Validating before sync...',
        progress: 'Syncing tasks to remote...',
        success: (res) => ({
          message: `${res.count} tasks synced successfully!`,
          indicator: res.count > 3 ? '🚀' : '✅',
        }),
        error: 'Failed to sync tasks.',
      }),
  )
  .command('import', (c) =>
    c
      .configure({ title: 'Import tasks from a file' })
      .arguments(
        z.object({
          file: z.string().describe('File path to import from'),
        }),
        { positional: ['file'] },
      )
      .action((args, ctx) => {
        // Simulate reading and importing
        const count = 3;
        for (let i = 1; i <= count; i++) {
          addTask({ title: `Imported task ${i} from ${args.file}`, priority: 'medium', tags: ['imported'] });
          ctx.progress.update(`Imported ${i}/${count} tasks...`);
        }
        return `Successfully imported ${count} task(s) from ${args.file}`;
      })
      .progress({
        progress: 'Importing tasks...',
        success: (res) => res,
      }),
  )
  .command('advanced', (c) =>
    c
      .configure({ title: 'Advanced task operations' })
      .command('', (c) =>
        c.configure({ description: 'Placeholder for advanced operations' }).action(() => {
          return 'Advanced operations coming soon!';
        }),
      )
      .command('clear', (c) =>
        c.configure({ title: 'Clear all tasks' }).action(() => {
          const tasks = getTasks();
          for (const task of tasks) {
            removeTask(task.id);
          }
          return `All tasks cleared. Total removed: ${tasks.length}`;
        }),
      ),
  );

if (import.meta.main) {
  await tasksProgram.cli().drain();
  if (telemetry.entries.length > 0) {
    console.log('\n── Telemetry ──');
    for (const entry of telemetry.entries) {
      const time = entry.startTime.toLocaleTimeString();
      console.log(`  ${time}  ${entry.command.padEnd(20)} ${entry.duration.toFixed(1)}ms`);
    }
    console.log(`  Total: ${telemetry.entries.length} command(s)`);
  }
}

export default tasksProgram;
