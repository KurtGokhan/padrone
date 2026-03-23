---
name: padrone
description: Build CLI applications with the Padrone framework. Use when writing code that imports from 'padrone', creating CLI tools, defining commands with Zod schemas, or working with Padrone's builder API, plugins, testing, REPL, or AI tool integration.
user-invocable: true
license: MIT
metadata:
  - type: npm-package
    name: padrone
    url: https://www.npmjs.com/package/padrone
---

# Padrone CLI Framework

Padrone is a type-safe CLI framework for Node.js/Bun. It uses any schema library that implements the [Standard Schema](https://github.com/standard-schema/standard-schema) spec (Zod, Valibot, ArkType, etc.) for argument validation and provides an immutable builder API for defining programs, commands, and plugins.

## Installation

```bash
npm install padrone zod    # or any Standard Schema-compatible library instead of zod
```

## Quick Start

```ts
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const program = createPadrone('mycli')
  .configure({ version: '1.0.0', description: 'My CLI app' })
  .command('greet', (c) =>
    c
      .arguments(z.object({ name: z.string() }), { positional: ['name'] })
      .action((args) => `Hello, ${args.name}!`),
  )
  .command(['deploy', 'dp'], (c) =>
    c
      .arguments(z.object({
        env: z.enum(['staging', 'production']),
        dry: z.boolean().default(false),
      }))
      .action((args, { runtime }) => {
        runtime.output(`Deploying to ${args.env}...`);
        return { deployed: true };
      }),
  );

program.cli();
```

## Core Concepts

- **Immutable builder**: Every method returns a new builder/program instance
- **Standard Schema validation**: Any schema library supporting `standard-schema` (Zod, Valibot, ArkType, etc.) defines positional args, named flags, defaults, coercion, and validation
- **Two entry points**: `'padrone'` (core) and `'padrone/test'` (testing utilities)
- **Sync by default**: Returns become async only when async schemas or plugins are used

## Builder API Summary

| Method | Purpose |
|---|---|
| `.arguments(schema, meta?)` | Define options/args with a Standard Schema |
| `.action(handler?)` | Set the command handler `(args, ctx, base?) => result` |
| `.command(name, builderFn?)` | Add or extend a subcommand |
| `.mount(name, program)` | Mount another Padrone program as a subcommand |
| `.configure(config)` | Set title, description, version, deprecated, hidden, group, autoOutput, mutation |
| `.use(plugin)` | Register a middleware plugin |
| `.env(schema)` | Parse environment variables into args |
| `.configFile(file, schema?)` | Load args from config files |
| `.wrap(config)` | Wrap an external CLI tool *(experimental)* |
| `.progress(config?)` | Configure auto-managed progress indicator |
| `.runtime(runtime)` | Custom I/O adapter (output, error, env, prompt, progress) |
| `.updateCheck(config?)` | Enable background update notifications |
| `.async()` | Mark command as using async validation |

## Program API Summary (after builder methods)

| Method | Purpose |
|---|---|
| `.cli(prefs?)` | Entry point from `process.argv` — throws on validation errors |
| `.eval(input, prefs?)` | Parse + validate + execute a string — returns issues softly |
| `.run(name, args)` | Execute by name with args object (sync, no validation) |
| `.parse(input?)` | Parse without executing |
| `.repl(options?)` | Start interactive REPL session |
| `.help(command?, prefs?)` | Generate help text |
| `.completion(shell?)` | Generate shell completion script |
| `.find(command)` | Look up a command by path |
| `.api()` | Type-safe programmatic API |
| `.tool()` | Vercel AI SDK tool definition |
| `.mcp(prefs?)` | Start MCP server (HTTP or stdio) *(experimental)* |
| `.serve(prefs?)` | Start REST server with OpenAPI docs *(experimental)* |
| `.stringify(command?, args?)` | Convert back to CLI string |

## Arguments Meta

The second parameter to `.arguments()` configures positional args, interactive prompts, and field metadata:

```ts
.arguments(schema, {
  positional: ['source', '...files'],     // '...' prefix = variadic
  interactive: true,                       // or ['fieldName'] for specific fields
  autoAlias: true,                         // auto kebab-case aliases for camelCase (default: true)
  stdin: 'data',                           // infers text/lines from schema type; use zodAsyncStream() for streaming
  fields: {
    output: { flags: 'o', description: 'Output path', examples: ['./dist'] },
    verbose: { flags: 'v', hidden: true },
    dryRun: { alias: 'dry' },             // multi-char long alias (--dry)
    old: { deprecated: 'Use --new instead', group: 'Legacy' },
  },
})
```

## Plugin System

Six phases in onion/middleware pattern with `next()`:

1. **start** — before pipeline (root only, not called by `parse()`/`run()`)
2. **parse** — command routing (root only)
3. **validate** — schema validation (parent chain)
4. **execute** — handler execution (parent chain)
5. **error** — error handling (return `{ error: undefined, result }` to suppress)
6. **shutdown** — cleanup, always runs

```ts
const plugin: PadronePlugin = {
  name: 'timer',
  order: -10,  // lower = outermost
  execute: (ctx, next) => {
    const start = Date.now();
    const result = next();
    console.log(`${ctx.command.path} took ${Date.now() - start}ms`);
    return result;
  },
};
program.use(plugin);
```

## Testing

```ts
import { testCli } from 'padrone/test';

const result = await testCli(program).run('greet World');
// result: { command, args, result, issues, stdout, stderr, error }

// With mocks
await testCli(program)
  .env({ API_KEY: 'xxx' })
  .prompt({ name: 'myapp' })
  .config({ 'app.json': { port: 8080 } })
  .run('deploy --env staging');

// REPL testing
const { results } = await testCli(program).repl(['greet Alice', 'greet Bob']);
```

## Progress Indicators

Auto-managed spinners for long-running commands:

```ts
.command('deploy', (c) =>
  c
    .async()
    .progress({
      progress: 'Deploying...',
      success: (result) => `Deployed v${result.version}`,
      error: 'Deploy failed',
    })
    .action(async () => {
      await deploy();
      return { version: '2.0' };
    }),
)
```

- **Auto-managed**: `.progress()` starts a spinner before execution, calls `succeed`/`fail` automatically
- **Manual control**: Use `ctx.progress` in action handlers for on-demand updates (`update`, `succeed`, `fail`, `stop`, `pause`, `resume`)
- **Dynamic messages**: `success`/`error` can be callbacks returning `string | null | { message, indicator }`
- **Spinner config**: `spinner` field accepts preset name (`'dots'`, `'line'`, etc.), `false` to disable, or `{ frames, interval }` object
- **Runtime factory**: `runtime({ progress: (message, options?) => indicator })` to provide a custom spinner implementation
- **Lazy creation**: `ctx.progress` defers real indicator creation until first `update()` call; auto-stops on cleanup

## Error Classes

- `PadroneError` — base (exitCode, suggestions, command, phase)
- `RoutingError` — unknown command
- `ValidationError` — schema failures (has `.issues`)
- `ConfigError` — config file problems
- `ActionError` — throw from action handlers with structured metadata

## Additional Resources

- For the complete API reference with all type signatures, see [api-reference.md](api-reference.md)
- For full working examples covering common patterns, see [examples.md](examples.md)
