import type { Task, TaskPriority, TaskStatus } from './tasks-types.ts';

let nextId = 6;

const tasks: Task[] = [
  {
    id: 'task-1',
    title: 'Review pull request #42',
    status: 'pending',
    priority: 'high',
    tags: ['work', 'code-review'],
    createdAt: '2024-01-15T09:00:00Z',
    dueDate: '2024-01-16',
  },
  {
    id: 'task-2',
    title: 'Buy groceries',
    status: 'pending',
    priority: 'medium',
    tags: ['personal', 'errands'],
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    id: 'task-3',
    title: 'Prepare presentation slides',
    status: 'in_progress',
    priority: 'high',
    tags: ['work', 'meeting'],
    createdAt: '2024-01-14T14:00:00Z',
    dueDate: '2024-01-17',
  },
  {
    id: 'task-4',
    title: 'Schedule dentist appointment',
    status: 'completed',
    priority: 'low',
    tags: ['personal', 'health'],
    createdAt: '2024-01-13T08:00:00Z',
  },
  {
    id: 'task-5',
    title: 'Update project documentation',
    status: 'pending',
    priority: 'medium',
    tags: ['work', 'docs'],
    createdAt: '2024-01-15T11:00:00Z',
  },
];

export interface TaskFilters {
  status?: TaskStatus[];
  priority?: TaskPriority;
  tag?: string;
}

export function getTasks(filters?: TaskFilters): Task[] {
  let result = [...tasks];

  if (filters?.status) {
    result = result.filter((t) => filters.status?.includes(t.status));
  }
  if (filters?.priority) {
    result = result.filter((t) => t.priority === filters.priority);
  }
  if (filters?.tag) {
    result = result.filter((t) => t.tags.includes(filters.tag!));
  }

  return result;
}

export function getTask(id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

export function addTask(input: { title: string; priority?: TaskPriority; tags?: string[]; dueDate?: string; dryRun?: boolean }): Task {
  const task: Task = {
    id: `task-${nextId++}`,
    title: input.title,
    status: 'pending',
    priority: input.priority ?? 'medium',
    tags: input.tags ?? [],
    createdAt: new Date().toISOString(),
    dueDate: input.dueDate,
  };
  if (!input.dryRun) tasks.push(task);
  return task;
}

export function updateTask(
  id: string,
  updates: { title?: string; priority?: TaskPriority; tags?: string[]; dueDate?: string },
): Task | undefined {
  const task = tasks.find((t) => t.id === id);
  if (!task) return undefined;

  if (updates.title !== undefined) task.title = updates.title;
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.tags !== undefined) task.tags = updates.tags;
  if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;

  return task;
}

export function removeTask(id: string): boolean {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;
  tasks.splice(index, 1);
  return true;
}

export function setTaskStatus(id: string, status: TaskStatus): Task | undefined {
  const task = tasks.find((t) => t.id === id);
  if (!task) return undefined;
  task.status = status;
  return task;
}
