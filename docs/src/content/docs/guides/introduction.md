---
title: Introduction
description: Learn what Padrone is and how it can help you build CLI applications
---

Padrone is a TypeScript library for building **type-safe, interactive CLI applications** with Zod schema validation. It provides a fluent API for defining commands and arguments while maintaining full type safety throughout your application.

## Why Padrone?

Building CLI applications in TypeScript often involves:
- Manual argument parsing with type assertions
- Repetitive validation code
- Separate documentation that gets out of sync
- Boilerplate for help generation

Padrone solves these problems by using **Zod schemas as the single source of truth** for your CLI's arguments. Your schema defines:
- The types of your arguments (automatically inferred)
- Validation rules (enforced at runtime)
- Documentation (generated from `.describe()` calls)
- Default values

## Key Features

### Type Safety

Every argument you define is fully typed from schema definition to action handler:

```typescript
.arguments(
  z.object({
    port: z.number().default(3000),
    host: z.string().default('localhost'),
  })
)
.action((args) => {
  // args is typed as { port: number; host: string }
  console.log(`Server at ${args.host}:${args.port}`);
})
```

### Fluent Builder API

Padrone uses a chainable builder pattern that reads naturally:

```typescript
createPadrone('myapp')
  .configure({ version: '1.0.0' })
  .command('serve', (c) => c.arguments(schema).action(handler))
  .command('build', (c) => c.arguments(schema).action(handler))
  .cli();
```

### AI Integration

Expose your CLI to AI assistants via Model Context Protocol or Vercel AI SDK:

```typescript
// MCP server for Claude, Cursor, Windsurf, etc. [experimental]
await program.mcp();  // or: myapp mcp

// REST server with OpenAPI docs [experimental]
await program.serve();  // or: myapp serve

// Vercel AI SDK tool
const tool = program.tool();
```

### Interactive Prompting

Automatically prompt users for missing arguments with type-aware prompts. Booleans become confirm prompts, enums become select menus, and arrays of enums become multi-selects — all detected from your Zod schema:

```typescript
.arguments(
  z.object({
    name: z.string().describe('Project name'),
    template: z.enum(['react', 'vue']).describe('Template'),
  }),
  { interactive: ['name', 'template'] }
)
```

### REPL Mode

Start an interactive session with command history, tab completion, and scoped navigation:

```typescript
for await (const result of program.repl()) {
  // Each command yields a result
}
```

### Progress Indicators

Auto-managed spinners for long-running commands with dynamic messages:

```typescript
.progress({
  progress: 'Deploying...',
  success: (result) => `Deployed v${result.version}`,
  spinner: 'dots',
})
```

### Interceptor System

Intercept and extend command execution with middleware-style interceptors:

```typescript
program.intercept({
  name: 'logger',
  execute: (ctx, next) => {
    console.log(`Running: ${ctx.command.name}`);
    return next();
  },
});
```

### Extension System

Compose reusable bundles of configuration, commands, and interceptors with `.extend()` and `PadroneExtension`. Built-in features (help, version, repl, color, config, interactive) are included by default.

### Program Composition

Mount independent programs as subcommands and override existing commands:

```typescript
const app = createPadrone('app')
  .mount('admin', adminProgram)
  .mount('db', dbProgram);
```

### Multiple Execution Modes

- **CLI mode**: Parse `process.argv` with `cli()`
- **Eval mode**: Parse and execute strings with soft error handling via `eval()`
- **Programmatic mode**: Call commands with typed arguments via `run()`
- **API mode**: Generate a typed function interface via `api()`
- **REPL mode**: Interactive session with `repl()`
- **MCP mode**: Expose commands as AI tools via `mcp()` *(experimental)*
- **Serve mode**: REST API with OpenAPI docs via `serve()` *(experimental)*

## Requirements

- Node.js 18+ or Bun
- TypeScript 5.0+ (recommended)
- Zod 3.25+ or 4.x

## Next Steps

Ready to start? Head to the [Quick Start](../quick-start/) guide to build your first Padrone CLI.
