---
title: Commands & Arguments
description: Learn how to define commands and arguments in Padrone
---

This guide covers how to work with commands, argments, positional arguments, and nested command hierarchies in Padrone.

## Defining Arguments

Arguments are defined using Zod schemas. Each property in the schema becomes a CLI argument:

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
  .action((args) => {
    // args: { port: number; host: string; verbose?: boolean }
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

### Argument Aliases

Add short aliases using `.meta()`:

```typescript
z.object({
  port: z.number().default(3000).meta({ alias: 'p' }),
  verbose: z.boolean().optional().meta({ alias: 'v' }),
})
```

Users can now use `-p 8080` instead of `--port 8080`.

### Argument Metadata

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

Positional arguments let users provide values without argument names:

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
      .action((args) => {
        console.log(`Cloning ${args.url}`);
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
          .action((args) => console.log(`Rolling back ${args.steps} migrations`))
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

Bind arguments to environment variables:

```typescript
.arguments(
  z.object({
    apiKey: z.string().describe('API key'),
    debug: z.boolean().optional(),
  }),
  {
    fields: {
      apiKey: { env: 'API_KEY' },
      debug: { env: ['DEBUG', 'APP_DEBUG'] }, // Multiple env vars
    }
  }
)
```

Priority order: CLI argument > Environment variable > Interactive prompt > Default value

## Config Files

Load arguments from configuration files:

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
      fields: {
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

Priority order: CLI argument > Environment variable > Config file > Interactive prompt > Default value

## Interactive Prompting

Commands can prompt users for missing field values when running in an interactive terminal. This is configured in the arguments meta and requires the runtime to have `interactive: true`.

```typescript
const program = createPadrone('app')
  .runtime({ interactive: true })
  .command('init', (c) =>
    c
      .arguments(
        z.object({
          name: z.string().describe('Project name'),
          template: z.enum(['react', 'vue', 'svelte']).describe('Starter template'),
          typescript: z.boolean().default(false).describe('Use TypeScript'),
        }),
        {
          interactive: ['name', 'template'],
          optionalInteractive: ['typescript'],
        }
      )
      .action((args) => {
        console.log(`Creating ${args.name} with ${args.template}`);
      })
  );
```

Running `app init` without arguments will:
1. Prompt for `name` (text input) and `template` (select from enum choices)
2. Ask "Would you also like to configure:" with `typescript` as a choice
3. Prompt for any selected optional fields

Values provided via CLI, env vars, or config files skip the prompt. Running `app init myproject --template react` only prompts for nothing — all required interactive fields are already provided.

Interactive prompting only occurs in `cli()`, not in `parse()` or `run()`. See the [Interactive Prompting guide](../interactive-prompting/) for full details.

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
