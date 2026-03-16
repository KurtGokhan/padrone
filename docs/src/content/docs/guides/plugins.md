---
title: Plugins
description: Intercept and extend command execution with the middleware plugin system
---

Padrone's plugin system lets you intercept the command lifecycle using a middleware pattern. Plugins wrap each phase with an onion model, giving you full control to modify inputs, short-circuit execution, add logging, or implement cross-cutting concerns.

The full lifecycle is: **start → parse → validate → execute → shutdown** (with **error** on failure).

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

Plugins can hook into six phases — three core phases (parse, validate, execute) and three lifecycle phases (start, error, shutdown):

### Start Phase

Runs before everything else, wrapping the entire pipeline. Only root-level plugins run during start — subcommand plugins are not invoked. Available in `eval()` and `cli()` only (not `parse()` or `run()`).

```typescript
const startup: PadronePlugin = {
  name: 'startup',
  start: (context, next) => {
    console.log('Starting up...');
    const result = next();  // Runs the full parse → validate → execute pipeline
    console.log('Pipeline complete');
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

**Result:** The full pipeline result (passed through from parse → validate → execute).

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

### Error Phase

Called when the pipeline throws an error. Error handlers can log, transform, or suppress errors. Only runs for `eval()` and `cli()`.

```typescript
const errorReporter: PadronePlugin = {
  name: 'error-reporter',
  error: (context, next) => {
    // Log and pass through
    reportToSentry(context.error);
    return next();
  },
};

const errorRecovery: PadronePlugin = {
  name: 'error-recovery',
  error: (context, next) => {
    // Suppress the error and return a fallback result
    if (context.error instanceof NetworkError) {
      return { error: undefined, result: cachedValue };
    }
    // Transform the error
    return { error: new AppError('Something went wrong', { cause: context.error }) };
  },
};
```

**Context:**
| Property | Type | Description |
|----------|------|-------------|
| `command` | `PadroneCommand` | The root command |
| `error` | `unknown` | The error that was thrown |
| `state` | `Record<string, unknown>` | Shared mutable state bag |

**Result:**
| Property | Type | Description |
|----------|------|-------------|
| `error` | `unknown \| undefined` | The error to throw. Set to `undefined` to suppress. |
| `result` | `unknown` | Replacement result when suppressing the error. |

Calling `next()` passes to the next error handler. The innermost core returns `{ error }` unchanged, which re-throws after shutdown runs.

### Shutdown Phase

Always runs after the pipeline completes — whether it succeeded or failed. Use for cleanup like closing connections or flushing logs. Only runs for `eval()` and `cli()`.

```typescript
const cleanup: PadronePlugin = {
  name: 'cleanup',
  shutdown: (context, next) => {
    if (context.error) {
      console.error('Failed:', context.error);
    }
    db.close();
    return next();
  },
};
```

**Context:**
| Property | Type | Description |
|----------|------|-------------|
| `command` | `PadroneCommand` | The root command |
| `error` | `unknown \| undefined` | The error, if the pipeline failed |
| `result` | `unknown \| undefined` | The pipeline result, if it succeeded |
| `state` | `Record<string, unknown>` | Shared mutable state bag |

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

| Method | Start | Parse | Validate | Execute | Error | Shutdown |
|--------|-------|-------|----------|---------|-------|----------|
| `eval()` / `cli()` | Yes | Yes | Yes | Yes | Yes | Yes |
| `parse()` | No | Yes | Yes | No | No | No |
| `run()` | No | No | No | Yes | No | No |

Built-in features (help, version, completion, REPL) bypass plugins entirely.
