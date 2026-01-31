In this example, the user requests to see all their personal tasks. The AI responds by filtering tasks with the "personal" tag and provides a detailed list of those tasks along with their statuses, priorities, tags, and creation dates.

## Prompt

Show me all my personal tasks

## AI Response

I'll show you all your personal tasks by filtering for tasks with the "personal" tag.Tasks:

  [ ] task-2: Buy groceries !! [personal, errands]
  [x] task-4: Schedule dentist appointment ! [personal, health]

Total: 2 task(s)

[Tool Call] tasks:

```json
{
  "command": "list --tag personal"
}
```

[Tool Result]:

```json
[
  {
    "id": "task-2",
    "title": "Buy groceries",
    "status": "pending",
    "priority": "medium",
    "tags": [
      "personal",
      "errands"
    ],
    "createdAt": "2024-01-15T10:30:00Z"
  },
  {
    "id": "task-4",
    "title": "Schedule dentist appointment",
    "status": "completed",
    "priority": "low",
    "tags": [
      "personal",
      "health"
    ],
    "createdAt": "2024-01-13T08:00:00Z"
  }
]
```

Here are all your personal tasks:

**Task ID: task-2**
- **Title:** Buy groceries
- **Status:** Pending
- **Priority:** Medium
- **Tags:** personal, errands
- **Created:** January 15, 2024

**Task ID: task-4**
- **Title:** Schedule dentist appointment
- **Status:** Completed ✅
- **Priority:** Low
- **Tags:** personal, health
- **Created:** January 13, 2024

You have 2 personal tasks total - 1 pending and 1 completed.
