import { Box, Text, useApp, useInput } from 'ink';
import React, { useState } from 'react';
import { getTasks, setTaskStatus } from './tasks-store.ts';
import type { Task } from './tasks-types.ts';

const STATUS_COLUMNS = ['pending', 'in_progress', 'completed'] as const;
const STATUS_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' };
const PRIORITY_COLORS: Record<string, string> = { high: 'red', medium: 'yellow', low: 'green' };

function TaskCard({ task, selected }: { task: Task; selected: boolean }) {
  const color = PRIORITY_COLORS[task.priority] ?? 'white';

  return (
    <Box flexDirection="column" borderStyle={selected ? 'double' : 'round'} borderColor={selected ? 'cyan' : 'gray'} paddingX={1}>
      <Text bold color={selected ? 'cyan' : undefined}>
        {task.title}
      </Text>
      <Text dimColor>
        <Text color={color}>{task.priority}</Text>
        {task.tags.length > 0 ? ` · ${task.tags.join(', ')}` : ''}
      </Text>
    </Box>
  );
}

function Column({ title, tasks, selectedId }: { title: string; tasks: Task[]; selectedId: string | null }) {
  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} marginRight={1}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold underline>
          {title} ({tasks.length})
        </Text>
      </Box>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} selected={task.id === selectedId} />
      ))}
      {tasks.length === 0 && (
        <Text dimColor italic>
          {'  (empty)'}
        </Text>
      )}
    </Box>
  );
}

export function TaskBoard() {
  const { exit } = useApp();
  const allTasks = getTasks();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, rerender] = useState(0);

  const flatTasks = STATUS_COLUMNS.flatMap((status) => allTasks.filter((t) => t.status === status));
  const selected = flatTasks[selectedIndex];

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(i + 1, flatTasks.length - 1));
    } else if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if ((key.rightArrow || input === 'l') && selected) {
      const currentCol = STATUS_COLUMNS.indexOf(selected.status as (typeof STATUS_COLUMNS)[number]);
      if (currentCol < STATUS_COLUMNS.length - 1) {
        setTaskStatus(selected.id, STATUS_COLUMNS[currentCol + 1]!);
        rerender((n) => n + 1);
      }
    } else if ((key.leftArrow || input === 'h') && selected) {
      const currentCol = STATUS_COLUMNS.indexOf(selected.status as (typeof STATUS_COLUMNS)[number]);
      if (currentCol > 0) {
        setTaskStatus(selected.id, STATUS_COLUMNS[currentCol - 1]!);
        rerender((n) => n + 1);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {'  Task Board'}
        </Text>
      </Box>

      <Box>
        {STATUS_COLUMNS.map((status) => (
          <Column
            key={status}
            title={STATUS_LABELS[status]!}
            tasks={allTasks.filter((t) => t.status === status)}
            selectedId={selected?.id ?? null}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓/jk: navigate · ←→/hl: move task · q/esc: quit</Text>
      </Box>
    </Box>
  );
}
