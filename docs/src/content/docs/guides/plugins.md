---
title: Plugins
description: Intercept and extend command execution with the middleware plugin system
---

Padrone's plugin system lets you intercept the command lifecycle using a middleware pattern. Plugins wrap the parse, validate, and execute phases with an onion model, giving you full control to modify inputs, short-circuit execution, add logging, or implement cross-cutting concerns.

## Defining a Plugin

A plugin is an object with a `name` and optional handlers for each phase:

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
```

## Registering Plugins

Use `.use()` on programs or individual commands:

```typescript
const program = createPadrone('myapp')
  .use(logger)  // Applies to all commands
  .command('deploy', (c) =>
    c
      .use(deployGuard)  // Only applies to 'deploy'
      .arguments(schema)
      .action(handler)
  );
```

`.use()` is immutable — it returns a new builder with the plugin added.

## Execution Phases

Plugins can hook into three phases:

### Parse Phase

Runs when CLI input is being parsed into a command and raw arguments. Only root-level plugins run during parsing — subcommand plugins are not invoked.

```typescript
const parseLogger: PadronePlugin = {
  name: 'parse-logger',
  parse: (context, next) => {
    console.log('Input:', context.input);
    const result = next();
    console.log('Parsed command:', result.command.name);
    return result;
  },
};
```

**Context:**
| Property | Type | Description |
|----------|------|-------------|
| `command` | `PadroneCommand` | The root command |
| `input` | `string \| undefined` | Raw CLI input string |
| `state` | `Record<string, unknown>` | Shared mutable state bag |

**Result:**
| Property | Type | Description |
|----------|------|-------------|
| `command` | `PadroneCommand` | Resolved command |
| `rawArgs` | `Record<string, unknown>` | Parsed raw arguments |
| `positionalArgs` | `string[]` | Positional argument values |

### Validate Phase

Runs after parsing, when raw arguments are being validated against the Zod schema.

```typescript
const defaults: PadronePlugin = {
  name: 'inject-defaults',
  validate: (context, next) => {
    // Inject values before validation
    context.rawArgs.region ??= 'us-east-1';
    return next();
  },
};
```

**Context:**
| Property | Type | Description |
|----------|------|-------------|
| `command` | `PadroneCommand` | Resolved command |
| `rawArgs` | `Record<string, unknown>` | Mutable raw arguments — modify before `next()` |
| `positionalArgs` | `string[]` | Positional argument values |
| `state` | `Record<string, unknown>` | Shared mutable state bag |

**Result:**
| Property | Type | Description |
|----------|------|-------------|
| `args` | `unknown` | Validated arguments |
| `argsResult` | `StandardSchemaV1.Result` | Full validation result |

### Execute Phase

Runs when the command's action handler is being invoked.

```typescript
const timer: PadronePlugin = {
  name: 'timer',
  execute: (context, next) => {
    const start = performance.now();
    const result = next();
    const duration = performance.now() - start;
    console.log(`Completed in ${duration.toFixed(0)}ms`);
    return result;
  },
};
```

**Context:**
| Property | Type | Description |
|----------|------|-------------|
| `command` | `PadroneCommand` | Resolved command |
| `args` | `unknown` | Mutable validated arguments — modify before `next()` |
| `state` | `Record<string, unknown>` | Shared mutable state bag |

**Result:**
| Property | Type | Description |
|----------|------|-------------|
| `result` | `unknown` | Action handler return value |

## Middleware Order

Plugins compose as an onion — the first registered plugin is the outermost wrapper:

```typescript
program
  .use(pluginA)  // Outermost — runs first on entry, last on exit
  .use(pluginB)  // Inner
  .use(pluginC); // Innermost — runs last on entry, first on exit
```

Program-level plugins always wrap subcommand plugins:

```
Program plugins (outermost) → Subcommand plugins (inner) → Action handler (core)
```

### Explicit Ordering

Use the `order` property to control position. Lower values run as outermost wrappers:

```typescript
const auth: PadronePlugin = {
  name: 'auth',
  order: -10,  // Runs before other plugins
  execute: (context, next) => {
    if (!isAuthenticated()) throw new Error('Not authenticated');
    return next();
  },
};

const metrics: PadronePlugin = {
  name: 'metrics',
  order: 10,  // Runs after most plugins
  execute: (context, next) => {
    const result = next();
    reportMetrics(context.command.name);
    return result;
  },
};
```

Plugins with the same `order` (default: `0`) preserve their registration order.

## Shared State

The `state` object is mutable and shared across all three phases within a single execution. Use it to pass data between phases:

```typescript
const auditPlugin: PadronePlugin = {
  name: 'audit',
  parse: (context, next) => {
    context.state.startTime = Date.now();
    return next();
  },
  execute: (context, next) => {
    const result = next();
    const duration = Date.now() - (context.state.startTime as number);
    auditLog({ command: context.command.name, duration });
    return result;
  },
};
```

## Short-Circuiting

Return early without calling `next()` to skip the rest of the chain:

```typescript
const dryRun: PadronePlugin = {
  name: 'dry-run',
  execute: (context, next) => {
    if (context.state.dryRun) {
      console.log('Dry run — skipping execution');
      return { result: undefined };
    }
    return next();
  },
};
```

## Sync Preservation

Plugins preserve sync/async behavior. If your plugin and all inner plugins are synchronous, the entire chain stays synchronous. Only return a Promise when you need async operations:

```typescript
// Sync plugin — chain stays sync
const syncPlugin: PadronePlugin = {
  name: 'sync',
  execute: (context, next) => {
    console.log('before');
    const result = next();
    console.log('after');
    return result;
  },
};

// Async plugin — chain becomes async
const asyncPlugin: PadronePlugin = {
  name: 'async',
  execute: async (context, next) => {
    await someAsyncWork();
    return next();
  },
};
```

## Which Methods Run Which Phases

| Method | Parse | Validate | Execute |
|--------|-------|----------|---------|
| `eval()` / `cli()` | Yes | Yes | Yes |
| `parse()` | Yes | Yes | No |
| `run()` | No | No | Yes |

Built-in features (help, version, completion, REPL) bypass plugins entirely.
