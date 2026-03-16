import { createPadrone, type PadronePlugin } from 'padrone';
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
  .runtime({ interactive: 'supported' })
  .command(['repl', ''], (c) =>
    c.configure({ title: 'Start interactive REPL' }).action(async (_args, runtime) => {
      for await (const _ of tasksProgram.runtime(runtime).repl({
        spacing: { before: ['▆', true], after: [true, '▆', true] },
        outputPrefix: '│   ',
      })) {
        // results are handled by each command's action
      }
    }),
  )
  .command('add', (c) =>
    c
      .configure({ title: 'Add a new task' })
      .arguments(
        z.object({
          title: z.string().describe('Task title'),
          priority: prioritySchema.optional().default('medium').describe('Task priority').meta({ alias: 'p' }),
          tags: z.array(z.string()).optional().default([]).describe('Tags for categorization').meta({ alias: 't' }),
          due: z.string().optional().describe('Due date (YYYY-MM-DD)').meta({ alias: 'd' }),
        }),
        {
          positional: ['title'],
          interactive: ['title'],
          optionalInteractive: ['priority', 'tags', 'due'],
        },
      )
      .action((args) => {
        const task = addTask({
          title: args.title,
          priority: args.priority,
          tags: args.tags,
          dueDate: args.due,
        });
        console.log(`Task added: ${formatTask(task)}`);
        return task;
      }),
  )
  .command('list', (c) =>
    c
      .configure({ title: 'List all tasks' })
      .arguments(
        z.object({
          status: z.array(statusSchema).optional().describe('Filter by status').meta({ alias: 's' }),
          priority: prioritySchema.optional().describe('Filter by priority').meta({ alias: 'p' }),
          tag: z.string().optional().describe('Filter by tag').meta({ alias: 't' }),
        }),
        { optionalInteractive: ['status', 'priority'] },
      )
      .action((args, runtime) => {
        const tasks = getTasks({
          status: args.status,
          priority: args.priority,
          tag: args.tag,
        });

        if (tasks.length === 0) {
          runtime.output('No tasks found.');
          return tasks;
        }

        runtime.output('Tasks:\n');
        for (const task of tasks) {
          runtime.output(`  ${formatTask(task)}`);
        }
        runtime.output(`\nTotal: ${tasks.length} task(s)`);
        return tasks;
      }),
  )
  .command('show', (c) =>
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

        console.log('Task Details:\n');
        console.log(`  ID:       ${task.id}`);
        console.log(`  Title:    ${task.title}`);
        console.log(`  Status:   ${task.status}`);
        console.log(`  Priority: ${task.priority}`);
        console.log(`  Tags:     ${task.tags.length > 0 ? task.tags.join(', ') : '(none)'}`);
        console.log(`  Created:  ${task.createdAt}`);
        if (task.dueDate) {
          console.log(`  Due:      ${task.dueDate}`);
        }
        return task;
      }),
  )
  .command('complete', (c) =>
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

        console.log(`Task completed: ${formatTask(task)}`);
        return task;
      }),
  )
  .command('start', (c) =>
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

        console.log(`Task started: ${formatTask(task)}`);
        return task;
      }),
  )
  .command('edit', (c) =>
    c
      .configure({ title: 'Edit a task' })
      .arguments(
        z.object({
          id: z.string().describe('Task ID'),
          title: z.string().optional().describe('New title'),
          priority: prioritySchema.optional().describe('New priority').meta({ alias: 'p' }),
          tags: z.array(z.string()).optional().describe('New tags').meta({ alias: 't' }),
          due: z.string().optional().describe('New due date (YYYY-MM-DD)').meta({ alias: 'd' }),
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

        console.log(`Task updated: ${formatTask(task)}`);
        return task;
      }),
  )
  .command('remove', (c) =>
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

        console.log(`Task removed: ${args.id}`);
        return { removed: true, id: args.id };
      }),
  )
  .use(telemetry)
  .command('advanced', (c) =>
    c
      .configure({ title: 'Advanced task operations' })
      .command('', (c) =>
        c.configure({ description: 'Placeholder for advanced operations' }).action(() => {
          console.log('This is a placeholder for advanced operations like bulk updates, analytics, etc.');
          return { message: 'Advanced operations coming soon!' };
        }),
      )
      .command('clear', (c) =>
        c.configure({ title: 'Clear all tasks' }).action(() => {
          const tasks = getTasks();
          for (const task of tasks) {
            removeTask(task.id);
          }
          console.log(`All tasks cleared. Total removed: ${tasks.length}`);
          return { cleared: true, count: tasks.length };
        }),
      ),
  );

if (import.meta.main) {
  try {
    await (await tasksProgram.cli())?.result;
  } catch {
    // Error handling
  } finally {
    if (telemetry.entries.length > 0) {
      console.log('\n── Telemetry ──');
      for (const entry of telemetry.entries) {
        const time = entry.startTime.toLocaleTimeString();
        console.log(`  ${time}  ${entry.command.padEnd(20)} ${entry.duration.toFixed(1)}ms`);
      }
      console.log(`  Total: ${telemetry.entries.length} command(s)`);
    }
  }
}
