---
title: API Reference
description: Complete API reference for Padrone
---

## createPadrone(name)

Creates a new Padrone program with the given name.

```typescript
import { createPadrone } from 'padrone';

const program = createPadrone('myapp');
```

**Parameters:**
- `name` (string): The program name, used in help output and as the root command name

**Returns:** A `PadroneProgram` builder instance

---

## Program Methods

### .configure(config)

Configure program or command properties.

```typescript
program.configure({
  title: 'My Application',
  description: 'A helpful CLI tool',
  version: '1.0.0',
  configFiles: ['app.config.json', '.apprc'],
  examples: ['myapp serve --port 8080'],
});
```

**Config options:**
| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | Display title for help output |
| `description` | `string` | Program/command description |
| `version` | `string` | Version string |
| `configFiles` | `string[]` | Config file paths to load |
| `examples` | `string[]` | Usage examples for help |

---

### .arguments(schema, meta?)

Define options using a Zod schema.

```typescript
program.arguments(
  z.object({
    port: z.number().default(3000).describe('Port number'),
    host: z.string().default('localhost'),
  }),
  {
    positional: ['port'],
    options: {
      host: { env: 'HOST', configKey: 'server.host' },
    },
  }
);
```

**Parameters:**
- `schema`: Zod object schema defining the options
- `meta` (optional): Additional configuration
  - `positional`: Array of option names to treat as positional arguments
  - `options`: Per-option metadata (env, configKey)

---

### .action(handler)

Set the handler function for the command.

```typescript
program.action((options, context) => {
  console.log('Options:', options);
  console.log('Command:', context.command);
  return { success: true };
});
```

**Parameters:**
- `handler`: Function receiving `(options, context)`
  - `options`: Parsed and validated options object
  - `context`: Execution context with `command` name

**Returns:** The program builder (chainable)

---

### .wrap(config)

Wrap an external CLI tool with optional schema transformation in the config object.

The config can include a `schema` property that transforms command options to external CLI arguments. The schema's **input type** should match the current command's options (from `.arguments()`), and its **output type** defines the arguments expected by the external command.

```typescript
// Define command options first
program
  .command('commit', (c) =>
    c
      .arguments(
        z.object({
          message: z.string(),
          all: z.boolean().optional(),
        }),
        {
          positional: ['message'],
        }
      )
      .wrap({
        command: 'git',
        args: ['commit'],
        positional: ['m'],  // Positional for external command
        schema: z.object({
          message: z.string(),
          all: z.boolean().optional(),
        }).transform((args) => ({
          m: args.message,  // Map 'message' to 'm' flag
          a: args.all,      // Map 'all' to 'a' flag
        })),
      })
  );
```

**Config options:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `command` | `string` | required | The external command to execute (e.g., 'git', 'docker', 'npm') |
| `args` | `string[]` | `[]` | Fixed arguments that always precede the options (e.g., `['commit']` for 'git commit') |
| `positional` | `string[]` | command's positional | Positional argument configuration for the external command. Defaults to the wrapping command's positional config. |
| `inheritStdio` | `boolean` | `true` | Whether to inherit stdio streams from the parent process. Set to `false` to capture stdout/stderr |
| `schema` | `Schema \| (cmdSchema) => Schema` | identity | Optional transformation schema. If not provided, command options are passed through as-is. |

**Returns:** The program builder with an action that executes the external command

**Result Type:** `WrapResult` (when `inheritStdio` is `false`)
```typescript
type WrapResult = {
  exitCode: number;      // The exit code of the process
  stdout?: string;       // Standard output (only if inheritStdio is false)
  stderr?: string;       // Standard error (only if inheritStdio is false)
  success: boolean;      // Whether the process exited successfully (exit code 0)
}
```

**Examples:**

```typescript
// No transformation - pass options through as-is
program
  .command('echo', (c) =>
    c
      .arguments(z.object({ message: z.string() }))
      .wrap({
        command: 'echo',
      })
  );

// Function-based schema for type safety
program
  .command('run', (c) =>
    c
      .arguments(
        z.object({
          image: z.string(),
          detach: z.boolean().optional(),
          interactive: z.boolean().optional(),
        })
      )
      .wrap({
        command: 'docker',
        args: ['run'],
        positional: ['image'],
        schema: (cmdSchema) => cmdSchema.transform(args => ({
          image: args.image,
          d: args.detach,
          i: args.interactive,
        })),
      })
  );

// Usage: program.run('run', { image: 'nginx', detach: true })
// After transform: { image: 'nginx', d: true }
// Executes: docker run --d nginx
```

```typescript
// Direct schema with transform
program
  .command('install', (c) =>
    c
      .arguments(
        z.object({
          packages: z.string().array(),
          saveDev: z.boolean().optional(),
        }),
        {
          positional: ['...packages'],
        }
      )
      .wrap({
        command: 'npm',
        args: ['install'],
        positional: ['...packages'],
        inheritStdio: false,  // Capture output
        schema: z.object({
          packages: z.string().array(),
          saveDev: z.boolean().optional(),
        }).transform(args => ({
          packages: args.packages,
          'save-dev': args.saveDev,  // Map to exact flag name
        })),
      })
  );

// Usage:
const result = await program.run('install', {
  packages: ['react', 'react-dom'],
  saveDev: true,
});
console.log(result.result.stdout);  // npm install output
console.log(result.result.exitCode);  // 0 if successful
```

**Type Safety:**

The `.wrap()` method maintains full type safety:
- Input schema matches command options from `.arguments()`
- Output schema defines external CLI arguments structure
- Return type is inferred as `Promise<WrapResult>`
- TypeScript enforces correct types when calling `.run()` or `.cli()`

**How it works:**

1. **Schema Transformation**: The wrap schema transforms command options to external CLI arguments
   - Input: Parsed command arguments (from `.arguments()`)
   - Output: External program arguments

2. **Options → CLI Arguments**: Padrone converts transformed options to CLI arguments:
   - Boolean options: `{ verbose: true }` → `--verbose`
   - String/Number options: `{ port: 3000 }` → `--port 3000`
   - Array options: `{ files: ['a', 'b'] }` → `--files a --files b`
   - Positional arguments: Follow the order specified in `config.positional`
   - Option keys are used as-is with `--` prefix

3. **Process Execution**: Uses `Bun.spawn()` to execute the external command with the generated arguments

---

### .command(name, builder)

Add a subcommand.

```typescript
program.command('serve', (c) =>
  c
    .arguments(schema)
    .action(handler)
);
```

**Parameters:**
- `name` (string): Command name
- `builder`: Function receiving a command builder, returns configured command

---

### .cli(input?)

Execute the program as a CLI.

```typescript
// Parse process.argv
program.cli();

// Parse a string input
program.cli('serve --port 8080');

// Parse an array
program.cli(['serve', '--port', '8080']);
```

**Parameters:**
- `input` (optional): String or string array to parse. Defaults to `process.argv.slice(2)`

**Returns:** The action handler's return value, or undefined

---

### .run(command, options)

Run a command programmatically with typed options.

```typescript
const result = program.run('serve', {
  port: 8080,
  host: 'localhost',
});
```

**Parameters:**
- `command`: Command path (e.g., `'serve'` or `'db migrate up'`)
- `options`: Options object matching the command's schema

**Returns:** The action handler's return value

---

### .parse(input?)

Parse input without executing the action.

```typescript
const result = program.parse('serve --port 8080');

console.log(result.command);  // 'serve'
console.log(result.options);  // { port: 8080, host: 'localhost' }
console.log(result.rest);     // Any unparsed arguments
```

**Parameters:**
- `input` (optional): String or string array to parse

**Returns:** Parse result object with `command`, `options`, and `rest` properties

---

### .stringify(command?, options?)

Convert a command and options back to a CLI string.

```typescript
const cliString = program.stringify('serve', { port: 8080 });
// 'serve --port 8080'
```

**Parameters:**
- `command` (optional): Command name
- `options` (optional): Options object

**Returns:** CLI string representation

---

### .api()

Generate a typed API object for programmatic use.

```typescript
const api = program.api();

// Call commands as methods
api.serve({ port: 8080 });
api.db.migrate.up({ steps: 1 });
```

**Returns:** Typed API object with methods for each command

---

### .help(command?, options?)

Generate help text.

```typescript
// Program help
console.log(program.help());

// Command help
console.log(program.help('serve'));

// Different formats
program.help('', { format: 'markdown' });
```

**Parameters:**
- `command` (optional): Command to get help for
- `options` (optional): `{ format: 'text' | 'ansi' | 'markdown' | 'html' | 'json' }`

**Returns:** Help text string (or object for JSON format)

---

### .tool()

Generate a Vercel AI SDK compatible tool.

```typescript
import { streamText } from 'ai';

const tool = program.tool();

await streamText({
  model: yourModel,
  tools: { myapp: tool },
});
```

**Returns:** AI SDK tool object

---

### .find(command)

Find a command by name.

```typescript
const cmd = program.find('db migrate up');
if (cmd) {
  console.log(cmd.name);  // 'up'
}
```

**Parameters:**
- `command`: Command path string

**Returns:** Command instance or undefined

---

### .completion(shell?)

Generate shell completion script.

```typescript
const script = program.completion('bash');
// Or: 'zsh', 'fish', 'powershell'
```

**Parameters:**
- `shell` (optional): Target shell. Auto-detected if omitted.

**Returns:** Shell completion script string

---

## Type Exports

Padrone exports these TypeScript types:

```typescript
import type {
  PadroneProgram,
  PadroneCommand,
  PadroneParseResult,
  PadroneCommandResult,
  PadroneAPI,
  PadroneSchema,
} from 'padrone';
```
