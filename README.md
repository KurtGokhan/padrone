<p align="center">
  <img src="media/padrone.svg" alt="Padrone Logo" width="200" height="200" />
</p>

<!-- <h1 align="center">Padrone</h1> -->

<p align="center">
  <strong>Create type-safe, interactive CLI apps with Zod schemas</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/padrone"><img src="https://img.shields.io/npm/v/padrone.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/padrone"><img src="https://img.shields.io/npm/dm/padrone.svg" alt="npm downloads"></a>
  <a href="https://github.com/KurtGokhan/padrone/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/padrone.svg" alt="license"></a>
</p>

---

## ✨ Features

- 🔒 **Type-safe** - Full TypeScript support with Zod schema validation
- 🎯 **Fluent API** - Chain commands and arguments with a clean builder pattern
- 🤖 **AI-Ready** - First-class support for Vercel AI SDK tool integration
- 📚 **Auto Help** - Automatic help generation from your schema definitions
- 🧩 **Nested Commands** - Support for deeply nested subcommands
- 🔄 **Standard Schema** - Built on [Standard Schema](https://github.com/standard-schema/standard-schema) for maximum compatibility
- 🚀 **Zero Config** - Works out of the box with sensible defaults

## 📦 Installation

```bash
# Using npm
npm install padrone zod

# Using bun
bun add padrone zod

# Using pnpm
pnpm add padrone zod

# Using yarn
yarn add padrone zod
```

## 🚀 Quick Start

```typescript
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const program = createPadrone('myapp')
  .command('greet', (c) =>
    c
      .arguments(
        z.object({
          names: z.array(z.string()).describe('Names to greet'),
          prefix: z
            .string()
            .optional()
            .describe('Prefix to use in greeting')
            .meta({ alias: 'p' }),
        }),
        { positional: ['...names'] },
      )
      .action((args) => {
        const prefix = args?.prefix ? `${args.prefix} ` : '';
        args.names.forEach((name) => {
          console.log(`Hello, ${prefix}${name}!`);
        });
      }),
  );

// Run from CLI arguments
program.cli();
```

### Running your CLI

```bash
# Run with arguments
myapp greet John Jane --prefix Mr.

# Or with alias
myapp greet John Jane -p Mr.
```

Output:
```
Hello, Mr. John!
Hello, Mr. Jane!
```

## 📖 Usage Examples

### Programmatic Execution

```typescript
// Run a command directly with typed arguments
program.run('greet', { names: ['John', 'Jane'], prefix: 'Dr.' });

// Parse CLI input without executing
const parsed = program.parse('greet John --prefix Mr.');
console.log(parsed.args); // { names: ['John'], prefix: 'Mr.' }
```

### API Mode

Generate a typed API from your CLI program:

```typescript
const api = program.api();

// Call commands as functions with full type safety
api.greet({ names: ['Alice', 'Bob'], prefix: 'Dr.' });
```

### Nested Commands

```typescript
const program = createPadrone('weather')
  .command('forecast', (c) =>
    c
      .arguments(
        z.object({
          city: z.string().describe('City name'),
          days: z.number().optional().default(3).describe('Number of days'),
        }),
        { positional: ['city'] },
      )
      .action((args) => {
        console.log(`Forecast for ${args.city}: ${args.days} days`);
      })
      .command('extended', (c) =>
        c
          .arguments(
            z.object({
              city: z.string().describe('City name'),
            }),
            { positional: ['city'] },
          )
          .action((args) => {
            console.log(`Extended forecast for ${args.city}`);
          }),
      ),
  );

// Run nested command
program.eval('forecast extended London');
```

### Option Aliases and Metadata

```typescript
const program = createPadrone('app')
  .command('serve', (c) =>
    c
      .arguments(
        z.object({
          port: z
            .number()
            .default(3000)
            .describe('Port to listen on')
            .meta({ alias: 'p', examples: ['3000', '8080'] }),
          host: z
            .string()
            .default('localhost')
            .describe('Host to bind to')
            .meta({ alias: 'h' }),
          verbose: z
            .boolean()
            .optional()
            .describe('Enable verbose logging')
            .meta({ alias: 'v', deprecated: 'Use --debug instead' }),
        }),
      )
      .action((args) => {
        console.log(`Server running at ${args.host}:${args.port}`);
      }),
  );
```

### Environment Variables and Config Files

Padrone supports loading arguments from environment variables and config files using dedicated schema methods:

```typescript
const program = createPadrone('app')
  .command('serve', (c) =>
    c
      .arguments(
        z.object({
          port: z.number().default(3000).describe('Port to listen on'),
          apiKey: z.string().describe('API key for authentication'),
        }),
      )
      // Map environment variables to arguments
      .env(
        z
          .object({
            APP_PORT: z.coerce.number().optional(),
            API_KEY: z.string().optional(),
          })
          .transform((env) => ({
            port: env.APP_PORT,
            apiKey: env.API_KEY,
          })),
      )
      // Load config from JSON file with matching schema
      .configFile(
        'app.config.json',
        z.object({
          port: z.number().optional(),
          apiKey: z.string().optional(),
        }),
      )
      .action((args) => {
        console.log(`Server running on port ${args.port}`);
      }),
  );
```

**Precedence order** (highest to lowest): CLI args > environment variables > config file

### Async Validation

If your schema uses async refinements (e.g. `z.check(async ...)`), mark the command as async so that `parse()` and `cli()` return Promises:

```typescript
import { asyncSchema, createPadrone } from 'padrone';

const program = createPadrone('app')
  .command('create', (c) =>
    c
      // Option 1: brand the schema with asyncSchema()
      .arguments(asyncSchema(z.object({ name: z.string() }).check(async (ctx) => { /* ... */ })))
      // Option 2: call .async() on the builder
      .async()
      .action((args) => args.name),
  );

// parse() and cli() now return Promises
const result = await program.parse('create --name test');
```

## 🤖 AI SDK Integration

Padrone provides first-class support for the [Vercel AI SDK](https://ai-sdk.dev/), making it easy to expose your CLI as an AI tool:

```typescript
import { streamText } from 'ai';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const weatherCli = createPadrone('weather')
  .command('current', (c) =>
    c
      .arguments(
        z.object({
          city: z.string().describe('City name'),
        }),
        { positional: ['city'] },
      )
      .action((args) => {
        return { city: args.city, temperature: 72, condition: 'Sunny' };
      }),
  );

// Convert your CLI to an AI tool
const result = await streamText({
  model: yourModel,
  prompt: "What's the weather in London?",
  tools: {
    weather: weatherCli.tool(),
  },
});
```

## 📋 Auto-Generated Help

Padrone automatically generates help text from your Zod schemas:

```typescript
console.log(program.help());
```

Example output:
```
Usage: myapp greet [names...] [arguments]

Positionals:
  names...    Names to greet

Arguments:
  -p, --prefix <string>   Prefix to use in greeting
  -h, --help              Show help
```

## 🔧 API Reference

### `createPadrone(name)`

Creates a new CLI program with the given name.

### Program Methods

| Method | Description |
|--------|-------------|
| `.configure(config)` | Configure program properties (title, description, version) |
| `.command(name, builder)` | Add a command to the program |
| `.arguments(schema, meta?)` | Define arguments schema with optional positional args |
| `.async()` | Mark command as async (for schemas with async validation) |
| `.env(schema)` | Define schema for parsing environment variables into arguments |
| `.configFile(file, schema?)` | Configure config file path(s) and schema |
| `.action(handler)` | Set the command handler function |
| `.cli(input?)` | Run as CLI (parses `process.argv` or input string) |
| `.run(command, args?)` | Run a command programmatically |
| `.parse(input?)` | Parse input without executing |
| `.stringify(command?, args?)` | Convert command and arguments back to CLI string |
| `.api()` | Generate a typed API object |
| `.help(command?)` | Generate help text |
| `.tool()` | Generate a Vercel AI SDK tool |
| `.find(command)` | Find a command by name |

### Arguments Meta

Use the second argument of `.arguments()` to configure positional arguments and per-argument metadata:

```typescript
.arguments(schema, {
  positional: ['source', '...files', 'dest'],  // '...files' is variadic
  fields: {
    verbose: { alias: 'v' },
    format: { deprecated: 'Use --output instead' },
  },
})
```

### Zod Metadata

Use `.meta()` on Zod schemas to provide additional CLI metadata:

```typescript
z.string().meta({
  alias: 'p',            // Short alias (-p)
  examples: ['value'],   // Example values for help text
  deprecated: 'message', // Mark as deprecated
  hidden: true,          // Hide from help output
})
```

## 🤖 AI Coding Agent Skill

Install the [Padrone skill](https://agentskills.io) to give your AI coding agent (Claude Code, etc.) knowledge of the Padrone API:

```bash
npx skills add KurtGokhan/padrone
```

## 🛠️ Requirements

- Node.js 18+ or Bun
- TypeScript 5.0+ (recommended)
- Zod 3.25+ or 4.x

## 📄 License

[MIT](LICENSE) © [Gokhan Kurt](https://gkurt.com)

---

<p align="center">
  Made with ❤️ by <a href="https://gkurt.com">Gokhan Kurt</a>
</p>
