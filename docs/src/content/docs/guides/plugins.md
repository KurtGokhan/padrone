---
title: Interceptors & Extensions
description: Intercept command execution and extend programs with composable middleware
---

Padrone has two complementary systems for extending behavior:

- **Interceptors**: Runtime phase interception — middleware that wraps the command lifecycle (parse, validate, execute, etc.) with an onion model. Use interceptors for logging, auth, metrics, error handling, and other cross-cutting concerns.
- **Extensions**: Build-time composition — reusable bundles of commands, configuration, and interceptors that can be applied to any program via `.extend()`. Use extensions to package and share functionality.

## Interceptors

Interceptors let you intercept the command lifecycle using a middleware pattern. They wrap each phase with an onion model, giving you full control to modify inputs, short-circuit execution, add logging, or implement cross-cutting concerns.

The full lifecycle is: **start → parse → validate → execute → shutdown** (with **error** on failure).

### Defining an Interceptor

An interceptor is an object with a `name` and optional handlers for each phase:

```typescript
import type { PadroneInterceptor } from 'padrone';

const logger: PadroneInterceptor = {
  name: 'logger',
  execute: (context, next) => {
    console.log(`Running: ${context.command.name}`);
    const result = next();
    console.log(`Done: ${context.command.name}`);
    return result;
  },
};
```

### Registering Interceptors

Use `.intercept()` on programs or individual commands:

```typescript
const program = createPadrone('myapp')
  .intercept(logger)  // Applies to all commands
  .command('deploy', (c) =>
    c
      .intercept(deployGuard)  // Only applies to 'deploy'
      .arguments(schema)
      .action(handler)
  );
```

`.intercept()` is immutable — it returns a new builder with the interceptor added.

### Execution Phases

Interceptors can hook into six phases — three core phases (parse, validate, execute) and three lifecycle phases (start, error, shutdown):

#### Start Phase

Runs before everything else, wrapping the entire pipeline. Only root-level interceptors run during start — subcommand interceptors are not invoked. Available in `eval()` and `cli()` only (not `parse()` or `run()`).

```typescript
const startup: PadroneInterceptor = {
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
| `context` | `unknown` | User-provided context from `cli()`/`eval()` |

**Result:** The full pipeline result (passed through from parse → validate → execute).

#### Parse Phase

Runs when CLI input is being parsed into a command and raw arguments. Only root-level interceptors run during parsing — subcommand interceptors are not invoked.

```typescript
const parseLogger: PadroneInterceptor = {
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
| `context` | `unknown` | User-provided context from `cli()`/`eval()` |

**Result:**
| Property | Type | Description |
|----------|------|-------------|
| `command` | `PadroneCommand` | Resolved command |
| `rawArgs` | `Record<string, unknown>` | Parsed raw arguments |
| `positionalArgs` | `string[]` | Positional argument values |

#### Validate Phase

Runs after parsing, when raw arguments are being validated against the Zod schema.

```typescript
const defaults: PadroneInterceptor = {
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
| `context` | `unknown` | User-provided context |

**Result:**
| Property | Type | Description |
|----------|------|-------------|
| `args` | `unknown` | Validated arguments |
| `argsResult` | `StandardSchemaV1.Result` | Full validation result |

#### Execute Phase

Runs when the command's action handler is being invoked.

```typescript
const timer: PadroneInterceptor = {
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
| `context` | `unknown` | User-provided context |

**Result:**
| Property | Type | Description |
|----------|------|-------------|
| `result` | `unknown` | Action handler return value |

#### Error Phase

Called when the pipeline throws an error. Error handlers can log, transform, or suppress errors. Only runs for `eval()` and `cli()`.

```typescript
const errorReporter: PadroneInterceptor = {
  name: 'error-reporter',
  error: (context, next) => {
    // Log and pass through
    reportToSentry(context.error);
    return next();
  },
};

const errorRecovery: PadroneInterceptor = {
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
| `context` | `unknown` | User-provided context |

**Result:**
| Property | Type | Description |
|----------|------|-------------|
| `error` | `unknown \| undefined` | The error to throw. Set to `undefined` to suppress. |
| `result` | `unknown` | Replacement result when suppressing the error. |

Calling `next()` passes to the next error handler. The innermost core returns `{ error }` unchanged, which re-throws after shutdown runs.

#### Shutdown Phase

Always runs after the pipeline completes — whether it succeeded or failed. Use for cleanup like closing connections or flushing logs. Only runs for `eval()` and `cli()`.

```typescript
const cleanup: PadroneInterceptor = {
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
| `context` | `unknown` | User-provided context |

### Middleware Order

Interceptors compose as an onion — the first registered interceptor is the outermost wrapper:

```typescript
program
  .intercept(interceptorA)  // Outermost — runs first on entry, last on exit
  .intercept(interceptorB)  // Inner
  .intercept(interceptorC); // Innermost — runs last on entry, first on exit
```

Program-level interceptors always wrap subcommand interceptors:

```
Program interceptors (outermost) → Subcommand interceptors (inner) → Action handler (core)
```

#### Explicit Ordering

Use the `order` property to control position. Lower values run as outermost wrappers:

```typescript
const auth: PadroneInterceptor = {
  name: 'auth',
  order: -10,  // Runs before other interceptors
  execute: (context, next) => {
    if (!isAuthenticated()) throw new Error('Not authenticated');
    return next();
  },
};

const metrics: PadroneInterceptor = {
  name: 'metrics',
  order: 10,  // Runs after most interceptors
  execute: (context, next) => {
    const result = next();
    reportMetrics(context.command.name);
    return result;
  },
};
```

Interceptors with the same `order` (default: `0`) preserve their registration order.

### Shared State

The `state` object is mutable and shared across all phases within a single execution. Use it to pass data between phases:

```typescript
const auditInterceptor: PadroneInterceptor = {
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

### Short-Circuiting

Return early without calling `next()` to skip the rest of the chain:

```typescript
const dryRun: PadroneInterceptor = {
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

### Sync Preservation

Interceptors preserve sync/async behavior. If your interceptor and all inner interceptors are synchronous, the entire chain stays synchronous. Only return a Promise when you need async operations:

```typescript
// Sync interceptor — chain stays sync
const syncInterceptor: PadroneInterceptor = {
  name: 'sync',
  execute: (context, next) => {
    console.log('before');
    const result = next();
    console.log('after');
    return result;
  },
};

// Async interceptor — chain becomes async
const asyncInterceptor: PadroneInterceptor = {
  name: 'async',
  execute: async (context, next) => {
    await someAsyncWork();
    return next();
  },
};
```

### Which Methods Run Which Phases

| Method | Start | Parse | Validate | Execute | Error | Shutdown |
|--------|-------|-------|----------|---------|-------|----------|
| `eval()` / `cli()` | Yes | Yes | Yes | Yes | Yes | Yes |
| `parse()` | No | Yes | Yes | No | No | No |
| `run()` | No | No | No | Yes | No | No |

Built-in features (help, version, completion, REPL) bypass interceptors entirely.

## Extensions

Extensions are build-time compositions that bundle commands, configuration, and interceptors into reusable packages. Apply them with `.extend()`.

### Built-in Commands Extension

Padrone's built-in commands (help, version, completion, REPL, MCP, serve) are available as an extension:

```typescript
import { createPadrone, padroneBuiltins } from 'padrone';

const program = createPadrone('myapp')
  .extend(padroneBuiltins())
  .command('serve', (c) => c.action(() => 'serving'));
```

### Custom Extensions

An extension is a function that receives a builder and returns a modified builder:

```typescript
const withLogging = (builder) =>
  builder.intercept({
    name: 'logger',
    execute: (ctx, next) => {
      console.log(`Running: ${ctx.command.name}`);
      return next();
    },
  });

const program = createPadrone('myapp')
  .extend(withLogging);
```

Extensions compose naturally — chain multiple `.extend()` calls to layer functionality.
