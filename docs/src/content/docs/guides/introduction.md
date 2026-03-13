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

Every option you define is fully typed from schema definition to action handler:

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

Expose your CLI as an AI tool with a single method call:

```typescript
const tool = program.tool();
// Use with Vercel AI SDK
```

### Multiple Execution Modes

- **CLI mode**: Parse `process.argv` or a string input
- **Programmatic mode**: Call commands with typed arguments
- **API mode**: Generate a typed function interface

## Requirements

- Node.js 18+ or Bun
- TypeScript 5.0+ (recommended)
- Zod 3.25+ or 4.x

## Next Steps

Ready to start? Head to the [Quick Start](../quick-start/) guide to build your first Padrone CLI.
