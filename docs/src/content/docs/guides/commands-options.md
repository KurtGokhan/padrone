---
title: Commands & Options
description: Learn how to define commands, options, and arguments in Padrone
---

This guide covers how to work with commands, options, positional arguments, and nested command hierarchies in Padrone.

## Defining Options

Options are defined using Zod schemas. Each property in the schema becomes a CLI option:

```typescript
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const program = createPadrone('app')
  .arguments(
    z.object({
      port: z.number().default(3000).describe('Port to listen on'),
      host: z.string().default('localhost').describe('Host to bind to'),
      verbose: z.boolean().optional().describe('Enable verbose logging'),
    })
  )
  .action((options) => {
    // options: { port: number; host: string; verbose?: boolean }
  });
```

### Supported Types

Padrone supports these Zod types:

| Zod Type | CLI Input Example |
|----------|-------------------|
| `z.string()` | `--name "John"` |
| `z.number()` | `--port 3000` |
| `z.boolean()` | `--verbose` or `--no-verbose` |
| `z.enum(['a', 'b'])` | `--level high` |
| `z.array(z.string())` | `--tags foo --tags bar` or `--tags=[foo,bar]` |

### Option Aliases

Add short aliases using `.meta()`:

```typescript
z.object({
  port: z.number().default(3000).meta({ alias: 'p' }),
  verbose: z.boolean().optional().meta({ alias: 'v' }),
})
```

Users can now use `-p 8080` instead of `--port 8080`.

### Option Metadata

The `.meta()` method supports several properties:

```typescript
z.string().meta({
  alias: 'o',              // Short alias
  examples: ['file.txt'],  // Example values for help text
  deprecated: 'Use --out', // Deprecation warning
  hidden: true,            // Hide from help output
  env: 'OUTPUT_FILE',      // Bind to environment variable
  configKey: 'output.file' // Bind to config file key
})
```

## Positional Arguments

Positional arguments let users provide values without option names:

```typescript
.arguments(
  z.object({
    source: z.string().describe('Source file'),
    dest: z.string().describe('Destination file'),
  }),
  { positional: ['source', 'dest'] }
)
```

```bash
# Both are equivalent:
app copy file.txt backup.txt
app copy --source file.txt --dest backup.txt
```

### Variadic Arguments

Use `...` prefix for variadic (rest) arguments that capture multiple values:

```typescript
.arguments(
  z.object({
    files: z.array(z.string()).describe('Files to process'),
    output: z.string().describe('Output directory'),
  }),
  { positional: ['...files', 'output'] }
)
```

```bash
app process a.txt b.txt c.txt ./out
# files: ['a.txt', 'b.txt', 'c.txt'], output: './out'
```

## Commands

Add commands using the `.command()` method:

```typescript
const program = createPadrone('git')
  .command('clone', (c) =>
    c
      .arguments(
        z.object({
          url: z.string().describe('Repository URL'),
          depth: z.number().optional().describe('Clone depth'),
        }),
        { positional: ['url'] }
      )
      .action((options) => {
        console.log(`Cloning ${options.url}`);
      })
  )
  .command('status', (c) =>
    c.action(() => {
      console.log('On branch main');
    })
  );
```

### Command Configuration

Configure commands with `.configure()`:

```typescript
.command('serve', (c) =>
  c
    .configure({
      description: 'Start the development server',
      examples: ['serve --port 8080', 'serve -p 3000'],
    })
    .arguments(schema)
    .action(handler)
)
```

### Nested Commands

Commands can contain subcommands to any depth:

```typescript
const program = createPadrone('db')
  .command('migrate', (c) =>
    c
      .command('up', (c) =>
        c.action(() => console.log('Running migrations'))
      )
      .command('down', (c) =>
        c
          .arguments(z.object({ steps: z.number().default(1) }))
          .action((opts) => console.log(`Rolling back ${opts.steps} migrations`))
      )
      .command('status', (c) =>
        c.action(() => console.log('Migration status'))
      )
  );
```

```bash
db migrate up
db migrate down --steps 3
db migrate status
```

## Environment Variables

Bind options to environment variables:

```typescript
.arguments(
  z.object({
    apiKey: z.string().describe('API key'),
    debug: z.boolean().optional(),
  }),
  {
    options: {
      apiKey: { env: 'API_KEY' },
      debug: { env: ['DEBUG', 'APP_DEBUG'] }, // Multiple env vars
    }
  }
)
```

Priority order: CLI argument > Environment variable > Default value

## Config Files

Load options from configuration files:

```typescript
const program = createPadrone('app')
  .configure({
    configFiles: ['app.config.json', '.apprc', 'app.config.yaml'],
  })
  .arguments(
    z.object({
      port: z.number().default(3000),
      host: z.string().default('localhost'),
    }),
    {
      options: {
        port: { configKey: 'server.port' },
        host: { configKey: 'server.host' },
      }
    }
  );
```

With `app.config.json`:
```json
{
  "server": {
    "port": 8080,
    "host": "0.0.0.0"
  }
}
```

Priority order: CLI argument > Environment variable > Config file > Default value

## Help Generation

Padrone automatically generates help text:

```typescript
// Print help for the program
console.log(program.help());

// Print help for a specific command
console.log(program.help('migrate up'));

// Different formats
program.help('', { format: 'text' });   // Plain text
program.help('', { format: 'ansi' });   // With colors
program.help('', { format: 'markdown' });
program.help('', { format: 'html' });
program.help('', { format: 'json' });
```

## Finding Commands

Look up commands programmatically:

```typescript
const migrateUp = program.find('migrate up');
if (migrateUp) {
  console.log(migrateUp.name); // 'up'
}
```
