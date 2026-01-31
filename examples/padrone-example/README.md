# Padrone Task Manager Example

Usage: **tasks** *[command]*



A task manager CLI for managing your todos with support for priorities, tags, and due dates.



### Commands:

  **add**       Add a new task

  **list**      List all tasks

  **show**      Show task details

  **complete**  Mark a task as completed

  **start**     Mark a task as in progress

  **edit**      Edit a task

  **remove**    Remove a task



*Run "tasks [command] --help" for more information on a command.*



### Subcommand Details:



*────────────────────────────────────────────────────────────*

Usage: **tasks add** *[args...]* *[options]*



### Add a new task



### Arguments:

  `title`

    Task title



### Options:

  `--priority, -p` `<string>` *(optional)* *(default: medium)* *(choices: low, medium, high)*  Task priority

  `--tags, -t` `<array>` *(optional)* *(default: )* *(repeatable)*      Tags for categorization

  `--due, -d` `<string>` *(optional)*       Due date (YYYY-MM-DD)



*────────────────────────────────────────────────────────────*

Usage: **tasks list** *[options]*



### List all tasks



### Options:

  `--status, -s` `<string>` *(optional)* *(choices: pending, in_progress, completed)*    Filter by status

  `--priority, -p` `<string>` *(optional)* *(choices: low, medium, high)*  Filter by priority

  `--tag, -t` `<string>` *(optional)*       Filter by tag



*────────────────────────────────────────────────────────────*

Usage: **tasks show** *[args...]* *[options]*



### Show task details



### Arguments:

  `id`

    Task ID



*────────────────────────────────────────────────────────────*

Usage: **tasks complete** *[args...]* *[options]*



### Mark a task as completed



### Arguments:

  `id`

    Task ID



*────────────────────────────────────────────────────────────*

Usage: **tasks start** *[args...]* *[options]*



### Mark a task as in progress



### Arguments:

  `id`

    Task ID



*────────────────────────────────────────────────────────────*

Usage: **tasks edit** *[args...]* *[options]*



### Edit a task



### Arguments:

  `id`

    Task ID



### Options:

  `--title` `<string>` *(optional)*     New title

  `--priority, -p` `<string>` *(optional)* *(choices: low, medium, high)*  New priority

  `--tags, -t` `<array>` *(optional)* *(repeatable)*      New tags

  `--due, -d` `<string>` *(optional)*       New due date (YYYY-MM-DD)



*────────────────────────────────────────────────────────────*

Usage: **tasks remove** *[args...]* *[options]*



### Remove a task



### Arguments:

  `id`

    Task ID


