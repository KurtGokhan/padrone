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

**Configuration:**
| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | Display title for help output |
| `description` | `string` | Program/command description |
| `version` | `string` | Version string |
| `configFiles` | `string[]` | Config file paths to load |
| `examples` | `string[]` | Usage examples for help |

---

### .runtime(config)

Configure the runtime adapter for I/O abstraction. Allows the CLI framework to work outside of a terminal (e.g., web UIs, chat interfaces, AI agents, testing).

```typescript
program.runtime({
  interactive: true,
  prompt: myCustomPromptFn,
  output: (text) => panel.append(text),
  error: (text) => panel.appendError(text),
  format: 'html',
});
```

**Configuration:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `output` | `(text: string) => void` | `console.log` | Write normal output |
| `error` | `(text: string) => void` | `console.error` | Write error output |
| `argv` | `() => string[]` | `process.argv.slice(2)` | Return raw CLI arguments |
| `env` | `() => Record<string, string \| undefined>` | `process.env` | Return environment variables |
| `format` | `string` | `'auto'` | Default help output format |
| `loadConfigFile` | `(path: string) => Record<string, unknown> \| undefined` | Built-in JSON/YAML loader | Load a config file |
| `findFile` | `(names: string[]) => string \| undefined` | Built-in file finder | Find config file by name |
| `interactive` | `boolean` | `false` | Whether the runtime supports interactive prompts |
| `prompt` | `(config: InteractivePromptConfig) => Promise<unknown>` | Enquirer (when `interactive: true`) | Custom prompt implementation |

Successive `.runtime()` calls merge with previous configuration.

---

### .arguments(schema, meta?)

Define arguments using a Zod schema.

```typescript
program.arguments(
  z.object({
    port: z.number().default(3000).describe('Port number'),
    host: z.string().default('localhost'),
  }),
  {
    positional: ['port'],
    fields: {
      host: { env: 'HOST', configKey: 'server.host' },
    },
  }
);
```

**Parameters:**
- `schema`: Zod object schema defining the arguments
- `meta` (optional): Additional configuration
  - `positional`: Array of argument names to treat as positional arguments
  - `fields`: Per-argument metadata (env, configKey, alias, description, etc.)
  - `interactive`: `true | string[]` — fields to prompt when missing (see [Interactive Prompting](/padrone/guides/interactive-prompting/))
  - `optionalInteractive`: `true | string[]` — optional fields offered after required prompts

When `interactive` or `optionalInteractive` is set, the command becomes async — `parse()` and `cli()` return Promises.

---

### .action(handler)

Set the handler function for the command.

```typescript
program.action((args, ctx) => {
  console.log('Arguments:', args);
  return { success: true };
});
```

**Parameters:**
- `handler`: Function receiving `(args, ctx, base)`
  - `args`: Parsed and validated arguments object
  - `ctx`: Action context object containing `runtime`, `command`, and `program`
  - `base`: Previous handler function (useful when [overriding commands](/padrone/guides/composition/#command-override))

**Returns:** The program builder (chainable)

---

### .wrap(config)

Wrap an external CLI tool with optional schema transformation in the config object.

The config can include a `schema` property that transforms command arguments to external CLI arguments. The schema's **input type** should match the current command's arguments (from `.arguments()`), and its **output type** defines the arguments expected by the external command.

```typescript
// Define command arguments first
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

**Configuration:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `command` | `string` | required | The external command to execute (e.g., 'git', 'docker', 'npm') |
| `args` | `string[]` | `[]` | Fixed arguments that always precede the arguments (e.g., `['commit']` for 'git commit') |
| `positional` | `string[]` | command's positional | Positional argument configuration for the external command. Defaults to the wrapping command's positional config. |
| `inheritStdio` | `boolean` | `true` | Whether to inherit stdio streams from the parent process. Set to `false` to capture stdout/stderr |
| `schema` | `Schema \| (cmdSchema) => Schema` | identity | Optional transformation schema. If not provided, command arguments are passed through as-is. |

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
// No transformation - pass arguments through as-is
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
- Input schema matches command arguments from `.arguments()`
- Output schema defines external CLI arguments structure
- Return type is inferred as `Promise<WrapResult>`
- TypeScript enforces correct types when calling `.run()` or `.cli()`

**How it works:**

1. **Schema Transformation**: The wrap schema transforms command arguments to external CLI arguments
   - Input: Parsed command arguments (from `.arguments()`)
   - Output: External program arguments

2. **Arguments → CLI Arguments**: Padrone converts transformed arguments to CLI arguments:
   - Boolean arguments: `{ verbose: true }` → `--verbose`
   - String/Number arguments: `{ port: 3000 }` → `--port 3000`
   - Array arguments: `{ files: ['a', 'b'] }` → `--files a --files b`
   - Positional arguments: Follow the order specified in `config.positional`
   - Argument keys are used as-is with `--` prefix

3. **Process Execution**: Uses `Bun.spawn()` to execute the external command with the generated arguments

---

### .use(plugin)

Register a plugin for middleware-style interception of command phases. See the [Plugins guide](/padrone/guides/plugins/) for full details.

```typescript
import type { PadronePlugin } from 'padrone';

const logger: PadronePlugin = {
  name: 'logger',
  execute: (context, next) => {
    console.log(`Running: ${context.command.name}`);
    const result = next();
    console.log(`Done: ${context.command.name}`);
    return result;
  },
};

program.use(logger);
```

**Parameters:**
- `plugin`: A `PadronePlugin` object with `name`, optional `order`, and phase handlers (`start`, `parse`, `validate`, `execute`, `error`, `shutdown`)

**Returns:** New builder with the plugin added (immutable)

Available on both programs and subcommand builders. Program-level plugins apply as outermost wrappers; subcommand plugins compose as inner layers.

---

### .command(name, builder)

Add a subcommand. Re-registering a command with the same name merges the definitions — see [Program Composition](/padrone/guides/composition/) for details.

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

Execute the program as a CLI. This is the main process entry point that reads from `process.argv` and throws on validation errors.

```typescript
// Parse process.argv
program.cli();

// Parse an array
program.cli(['serve', '--port', '8080']);

// Start a REPL session from CLI
// myapp --repl
// myapp --repl db
```

**Parameters:**
- `input` (optional): String array to parse. Defaults to `process.argv.slice(2)`

**Returns:** The action handler's return value, or undefined. Returns a `Promise` when the matched command has async schemas or interactive fields.

**Note:** Interactive prompting only triggers in `cli()` and `eval()`, not in `parse()` or `run()`. When a command has interactive meta and the runtime has `interactive: true`, missing field values are prompted before validation. The `--repl` flag starts a REPL session (optionally scoped to a command).

---

### .eval(input, preferences?)

Parse, validate, and execute a command string with soft error handling. Returns a result with issues instead of throwing on validation errors.

```typescript
const result = await program.eval('serve --port 8080');

if (result.argsResult?.issues) {
  console.error('Validation errors:', result.argsResult.issues);
} else {
  console.log('Result:', result.result);
}
```

**Parameters:**
- `input`: Command string to parse and execute
- `preferences` (optional): `{ interactive?: boolean }` — override interactive prompting (`true` = force, `false` = suppress, `undefined` = inherit from runtime)

**Returns:** `PadroneCommandResult` with `command`, `args`, `argsResult`, and `result`. Returns a `Promise` when the matched command is async.

**Difference from `cli()`:** `eval()` is designed for programmatic use (REPL, AI tools, testing). It uses soft error handling — validation failures are returned as `argsResult.issues` rather than thrown. `cli()` is the process entry point that throws on errors and reads from `process.argv`.

---

### .run(command, args)

Run a command programmatically with typed arguments.

```typescript
const result = program.run('serve', {
  port: 8080,
  host: 'localhost',
});
```

**Parameters:**
- `command`: Command path (e.g., `'serve'` or `'db migrate up'`)
- `args`: Arguments object matching the command's schema

**Returns:** The action handler's return value

---

### .parse(input?)

Parse input without executing the action.

```typescript
const result = program.parse('serve --port 8080');

console.log(result.command);  // 'serve'
console.log(result.args);     // { port: 8080, host: 'localhost' }
console.log(result.rest);     // Any unparsed arguments
```

**Parameters:**
- `input` (optional): String or string array to parse

**Returns:** Parse result object with `command`, `args`, and `rest` properties

---

### .stringify(command?, args?)

Convert a command and arguments back to a CLI string.

```typescript
const cliString = program.stringify('serve', { port: 8080 });
// 'serve --port 8080'
```

**Parameters:**
- `command` (optional): Command name
- `args` (optional): Arguments object

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

### .help(command?, preferences?)

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
- `preferences` (optional): `{ format: 'text' | 'ansi' | 'markdown' | 'html' | 'json' }`

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

### .mount(name, program)

Mount an existing Padrone program as a subcommand. All nested commands are recursively re-pathed. See the [Program Composition guide](/padrone/guides/composition/) for full details.

```typescript
const users = createPadrone('users')
  .command('list', (c) => c.action(() => 'listing users'))
  .command('create', (c) =>
    c.arguments(z.object({ name: z.string() })).action((args) => args.name)
  );

const app = createPadrone('app')
  .mount('users', users);

// With aliases
const app2 = createPadrone('app')
  .mount(['users', 'u'], users);
```

**Parameters:**
- `name`: Command name string, or `[name, ...aliases]` array for aliases
- `program`: A Padrone program to mount

**Returns:** New builder with the mounted program

---

### .repl(options?)

Start an interactive REPL session. Returns an `AsyncIterable` that yields a result for each executed command. See the [REPL guide](/padrone/guides/repl/) for full details.

```typescript
for await (const result of program.repl()) {
  console.log(result.command.name, result.result);
}

// With options
for await (const result of program.repl({
  prompt: 'app> ',
  scope: 'db',
  greeting: 'Welcome!',
})) {
  // ...
}
```

**Parameters:**
- `options` (optional): REPL preferences
  - `prompt`: Custom prompt string or function
  - `greeting`: Welcome message (`false` to suppress)
  - `hint`: Hint text below greeting (`false` to suppress)
  - `history`: Initial history entries
  - `completion`: Enable tab completion (default: `true`)
  - `spacing`: Output separators (before/after command output)
  - `outputPrefix`: Prefix for output lines
  - `scope`: Start scoped to a command path (strongly typed)

**Returns:** `AsyncIterable<PadroneCommandResult>`

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
  // Core types
  PadroneProgram,
  PadroneCommand,
  PadroneBuilder,
  PadroneParseResult,
  PadroneCommandResult,
  PadroneAPI,
  PadroneSchema,
  AsyncPadroneSchema,
  PadroneCommandConfig,

  // Plugin types
  PadronePlugin,
  PluginBaseContext,
  PluginStartContext,
  PluginParseContext,
  PluginParseResult,
  PluginValidateContext,
  PluginValidateResult,
  PluginExecuteContext,
  PluginExecuteResult,
  PluginErrorContext,
  PluginErrorResult,
  PluginShutdownContext,

  // Runtime types
  PadroneRuntime,
  ResolvedPadroneRuntime,
  InteractivePromptConfig,
  PadroneReplPreferences,
  PadroneEvalPreferences,

  // Type utilities
  MaybePromise,
  OrAsync,
  OrAsyncMeta,
  HasInteractive,
  IsAsyncSchema,

  // Inference helpers
  InferArgsInput,
  InferArgsOutput,
  InferCommand,
} from 'padrone';
```
