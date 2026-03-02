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
