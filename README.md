<p align="center">
  <img src="media/padrone.svg" alt="Padrone Logo" width="200" height="200" />
</p>

<h1 align="center">Padrone</h1>

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
- 🎯 **Fluent API** - Chain commands, arguments, and options with a clean builder pattern
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
      .args(z.array(z.string()).describe('Names to greet'))
      .options(
        z.object({
          prefix: z
            .string()
            .optional()
            .describe('Prefix to use in greeting')
            .meta({ alias: 'p' }),
        }),
      )
      .handle((args, options) => {
        const prefix = options?.prefix ? `${options.prefix} ` : '';
        args.forEach((name) => {
          console.log(`Hello, ${prefix}${name}!`);
        });
      }),
  );

// Run from CLI arguments
await program.cli();
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
// Run a command directly with typed args and options
program.run('greet', ['John', 'Jane'], { prefix: 'Dr.' });

// Parse CLI input without executing
const parsed = await program.parse('greet John --prefix Mr.');
console.log(parsed.args);    // ['John']
console.log(parsed.options); // { prefix: 'Mr.' }
```

### API Mode

Generate a typed API from your CLI program:

```typescript
const api = program.api();

// Call commands as functions with full type safety
api.greet(['Alice', 'Bob'], { prefix: 'Dr.' });
```

### Nested Commands

```typescript
const program = createPadrone('weather')
  .command('forecast', (c) =>
    c
      .args(z.tuple([z.string().describe('City name')]))
      .options(
        z.object({
          days: z.number().optional().default(3).describe('Number of days'),
        }),
      )
      .handle((args, options) => {
        console.log(`Forecast for ${args[0]}: ${options.days} days`);
      })
      .command('extended', (c) =>
        c
          .args(z.tuple([z.string()]))
          .handle((args) => {
            console.log(`Extended forecast for ${args[0]}`);
          }),
      ),
  );

// Run nested command
await program.cli('forecast extended London');
```

### Option Aliases and Metadata

```typescript
const program = createPadrone('app')
  .command('serve', (c) =>
    c
      .options(
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
      .handle((_, options) => {
        console.log(`Server running at ${options.host}:${options.port}`);
      }),
  );
```

## 🤖 AI SDK Integration

Padrone provides first-class support for the [Vercel AI SDK](https://sdk.vercel.ai/), making it easy to expose your CLI as an AI tool:

```typescript
import { streamText } from 'ai';
import { createPadrone } from 'padrone';

const weatherCli = createPadrone('weather')
  .command('current', (c) =>
    c
      .args(z.tuple([z.string().describe('City name')]))
      .handle((args) => {
        return { city: args[0], temperature: 72, condition: 'Sunny' };
      }),
  );

// Convert your CLI to an AI tool
const result = await streamText({
  model: yourModel,
  prompt: "What's the weather in London?",
  tools: {
    weather: await weatherCli.tool(),
  },
});
```

## 📋 Auto-Generated Help

Padrone automatically generates help text from your Zod schemas:

```typescript
console.log(await program.help());
```

Example output:
```
Usage: myapp greet [args...] [options]

Arguments:
  args...    Names to greet

Options:
  -p, --prefix <string>   Prefix to use in greeting
  -h, --help              Show help
```

## 🔧 API Reference

### `createPadrone(name)`

Creates a new CLI program with the given name.

### Program Methods

| Method | Description |
|--------|-------------|
| `.command(name, builder)` | Add a command to the program |
| `.args(schema)` | Define positional arguments schema |
| `.options(schema, meta?)` | Define options schema |
| `.handle(handler)` | Set the command handler function |
| `.cli(input?)` | Run as CLI (parses `process.argv` or input string) |
| `.run(command, args, options)` | Run a command programmatically |
| `.parse(input?)` | Parse input without executing |
| `.api()` | Generate a typed API object |
| `.help(command?)` | Generate help text |
| `.tool()` | Generate a Vercel AI SDK tool |
| `.find(command)` | Find a command by name |

### Zod Meta Options

Use `.meta()` on Zod schemas to provide additional CLI metadata:

```typescript
z.string().meta({
  alias: 'p',           // Short alias (-p)
  examples: ['value'],  // Example values for help text
  deprecated: 'message', // Mark as deprecated
  hidden: true,         // Hide from help output
})
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
