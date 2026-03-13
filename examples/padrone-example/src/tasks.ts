import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { addTask, getTask, getTasks, removeTask, setTaskStatus, updateTask } from './tasks-store.ts';

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
    description: 'A task manager CLI for managing your todos with support for priorities, tags, and due dates.',
    version: '1.0.0',
  })
  .action(() => {
    console.log(tasksProgram.help());
  })
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
        { positional: ['title'] },
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
          status: statusSchema.optional().describe('Filter by status').meta({ alias: 's' }),
          priority: prioritySchema.optional().describe('Filter by priority').meta({ alias: 'p' }),
          tag: z.string().optional().describe('Filter by tag').meta({ alias: 't' }),
        }),
      )
      .action((options) => {
        const tasks = getTasks({
          status: options.status,
          priority: options.priority,
          tag: options.tag,
        });

        if (tasks.length === 0) {
          console.log('No tasks found.');
          return tasks;
        }

        console.log('Tasks:\n');
        for (const task of tasks) {
          console.log(`  ${formatTask(task)}`);
        }
        console.log(`\nTotal: ${tasks.length} task(s)`);
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
      .action((options) => {
        const task = getTask(options.id);

        if (!task) {
          console.error(`Task not found: ${options.id}`);
          process.exit(1);
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
      .action((options) => {
        const task = setTaskStatus(options.id, 'completed');

        if (!task) {
          console.error(`Task not found: ${options.id}`);
          process.exit(1);
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
      .action((options) => {
        const task = setTaskStatus(options.id, 'in_progress');

        if (!task) {
          console.error(`Task not found: ${options.id}`);
          process.exit(1);
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
        { positional: ['id'] },
      )
      .action((options) => {
        const task = updateTask(options.id, {
          title: options.title,
          priority: options.priority,
          tags: options.tags,
          dueDate: options.due,
        });

        if (!task) {
          console.error(`Task not found: ${options.id}`);
          process.exit(1);
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
      .action((options) => {
        const removed = removeTask(options.id);

        if (!removed) {
          console.error(`Task not found: ${options.id}`);
          process.exit(1);
        }

        console.log(`Task removed: ${options.id}`);
        return { removed: true, id: options.id };
      }),
  );

if (import.meta.main) {
  try {
    await tasksProgram.cli();
  } catch {
    // Error handling
  }
}
