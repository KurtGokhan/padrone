---
title: Quick Start
description: Build your first CLI application with Padrone in minutes
---

This guide walks you through creating a simple CLI application with Padrone.

## Installation

Install Padrone and Zod:

```bash
# Using npm
npm install padrone zod

# Using bun
bun add padrone zod

# Using pnpm
pnpm add padrone zod
```

## Create Your First CLI

Create a new file `cli.ts`:

```typescript
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const program = createPadrone('greet')
  .configure({
    version: '1.0.0',
    description: 'A friendly greeting CLI',
  })
  .options(
    z.object({
      name: z.string().describe('Name to greet'),
      excited: z.boolean().optional().describe('Add excitement'),
    }),
    { positional: ['name'] }
  )
  .action((options) => {
    const greeting = `Hello, ${options.name}`;
    console.log(options.excited ? `${greeting}!` : greeting);
  });

program.cli();
```

## Run Your CLI

```bash
# Run with a positional argument
bun cli.ts World
# Output: Hello, World

# Run with the --excited flag
bun cli.ts World --excited
# Output: Hello, World!

# Show help
bun cli.ts --help
```

## Add Commands

Most CLIs have multiple commands. Let's add some:

```typescript
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const program = createPadrone('todo')
  .configure({
    version: '1.0.0',
    description: 'A simple todo CLI',
  })
  .command('add', (c) =>
    c
      .options(
        z.object({
          task: z.string().describe('Task description'),
          priority: z.enum(['low', 'medium', 'high']).default('medium'),
        }),
        { positional: ['task'] }
      )
      .action((options) => {
        console.log(`Added: ${options.task} [${options.priority}]`);
      })
  )
  .command('list', (c) =>
    c
      .options(
        z.object({
          all: z.boolean().optional().describe('Show completed tasks'),
        })
      )
      .action((options) => {
        console.log('Listing tasks...', { showAll: options.all });
      })
  );

program.cli();
```

```bash
# Add a task
bun cli.ts add "Buy groceries" --priority high

# List tasks
bun cli.ts list --all
```

## Use Option Aliases

Add short aliases for frequently used options:

```typescript
z.object({
  verbose: z.boolean().optional().describe('Verbose output').meta({ alias: 'v' }),
  output: z.string().optional().describe('Output file').meta({ alias: 'o' }),
})
```

Now users can use `-v` instead of `--verbose` and `-o` instead of `--output`.

## Programmatic Usage

You can also run commands programmatically with full type safety:

```typescript
// Run a command directly
program.run('add', { task: 'Buy milk', priority: 'high' });

// Generate a typed API
const api = program.api();
api.add({ task: 'Buy eggs', priority: 'low' });

// Parse without executing
const parsed = program.parse('add "Clean room" --priority medium');
console.log(parsed.command); // 'add'
console.log(parsed.options); // { task: 'Clean room', priority: 'medium' }
```

## Next Steps

- Learn about [Commands & Options](/guides/commands-options/) in depth
- Integrate with [AI tools](/guides/ai-integration/)
- Explore the [API Reference](/reference/api/)
