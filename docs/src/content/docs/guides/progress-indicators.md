---
title: Progress Indicators
description: Show spinners and status messages during long-running commands
---

Padrone provides a built-in progress indicator system for commands that take time — async operations, network calls, file processing, etc. Progress indicators are auto-managed by default (start before validation, succeed/fail after execution) but can also be driven manually from within an action handler.

## Quick Example

```typescript
import { createPadrone, padroneProgress } from 'padrone';

const program = createPadrone('app')
  .command('deploy', (c) =>
    c
      .async()
      .extend(padroneProgress('Deploying...'))
      .action(async () => {
        await deploy();
        return { version: '2.0' };
      })
  );
```

Running `app deploy` shows a spinner with "Deploying..." that auto-succeeds when the action resolves.

## Auto-Managed Progress

Use `padroneProgress()` to configure automatic progress indicators. Register it with `.intercept()` on a command. The indicator starts before validation and is automatically stopped on success or failure.

### Simple Message

```typescript
c.extend(padroneProgress('Deploying...'))
```

### Full Configuration

```typescript
c.extend(padroneProgress({
  validation: 'Validating inputs...',  // Shown during async validation
  progress: 'Deploying...',            // Shown during execution
  success: 'Deployed successfully!',   // Shown on success
  error: 'Deploy failed',             // Shown on failure
  spinner: 'line',                     // Spinner preset
}))
```

The `validation` message is shown first (during schema validation), then replaced by the `progress` message when execution begins.

## Dynamic Success/Error Messages

The `success` and `error` fields accept callbacks that receive the actual result or error:

```typescript
c.extend(padroneProgress({
  progress: 'Deploying...',
  success: (result) => `Deployed v${result.version}`,
  error: (err) => `Deploy failed: ${err.message}`,
}))
```

### Custom Indicator Icons

Callbacks can return an object with `message` and `indicator` to override the success/error icon per-call:

```typescript
c.extend(padroneProgress({
  progress: 'Running checks...',
  success: (result) => ({
    message: `All ${result.count} checks passed`,
    indicator: '🎉',
  }),
  error: () => ({
    message: 'Checks failed',
    indicator: '💥',
  }),
}))
```

Static values also support the object form:

```typescript
c.extend(padroneProgress({
  progress: 'Building...',
  success: { message: 'Build complete', indicator: '🏗️' },
}))
```

### Suppressing Messages

Pass `null` to suppress the success or error message entirely (the spinner just clears):

```typescript
c.extend(padroneProgress({
  progress: 'Working...',
  success: null,  // No success message
}))
```

Callbacks can also return `null`:

```typescript
success: (result) => result.silent ? null : `Done: ${result.count} items`
```

## Manual Progress via `ctx.context.progress`

When `padroneProgress()` is registered, the action context provides a typed `progress` property on `ctx.context`:

```typescript
c.extend(padroneProgress('Importing...'))
  .action((args, ctx) => {
    for (const item of items) {
      process(item);
      ctx.context.progress.update(`Importing ${item.name}...`);
    }
    return `Imported ${items.length} items`;
  })
```

`padroneProgress()` uses the [context-providing interceptor](/guides/interceptors#context-providing-interceptors) mechanism — it declares `.provides<{ progress: PadroneProgressIndicator }>()`, so `ctx.context.progress` is fully typed when the interceptor is registered on the command.

### `PadroneProgressIndicator` Methods

| Method | Description |
|--------|-------------|
| `update(message)` | Change the displayed message |
| `succeed(message?, options?)` | Mark as succeeded and stop |
| `fail(message?, options?)` | Mark as failed and stop |
| `stop()` | Stop without success/fail status |
| `pause()` | Temporarily hide (for clean output) |
| `resume()` | Redraw after `pause()` |

## Spinner Configuration

### Presets

Padrone includes four built-in spinner presets:

| Preset | Frames |
|--------|--------|
| `dots` | `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` |
| `line` | `- \ \| /` |
| `arc` | `◜ ◠ ◝ ◞ ◡ ◟` |
| `bounce` | `⠁ ⠂ ⠄ ⡀ ⢀ ⠠ ⠐ ⠈` |

```typescript
c.extend(padroneProgress({ progress: 'Loading...', spinner: 'line' }))
```

### Custom Frames

```typescript
c.extend(padroneProgress({
  progress: 'Loading...',
  spinner: { frames: ['🌑', '🌒', '🌓', '🌔', '🌕'], interval: 150 },
}))
```

### Disabling the Spinner

Set `spinner: false` to show static text without animation:

```typescript
c.extend(padroneProgress({ progress: 'Processing...', spinner: false }))
```

## Runtime Progress Factory

The progress system requires a `progress` factory on the runtime. Padrone provides a built-in terminal spinner by default. You can replace it with your own implementation (e.g., for web UIs or testing):

```typescript
program.runtime({
  progress: (message, options) => ({
    update(msg) { /* ... */ },
    succeed(msg) { /* ... */ },
    fail(msg) { /* ... */ },
    stop() { /* ... */ },
    pause() { /* ... */ },
    resume() { /* ... */ },
  }),
});
```

The factory receives optional `PadroneProgressOptions`:

| Property | Type | Description |
|----------|------|-------------|
| `spinner` | `PadroneSpinnerConfig` | Spinner preset, custom config, or `false` |
| `successIndicator` | `string` | Default success icon (default: `'✔'`) |
| `errorIndicator` | `string` | Default error icon (default: `'✖'`) |

### Testing with Mock Progress

```typescript
function createMockProgress() {
  const indicators = [];
  const factory = (message) => {
    const calls = [];
    const indicator = {
      update: (msg) => calls.push(`update:${msg}`),
      succeed: (msg) => calls.push(`succeed:${msg}`),
      fail: (msg) => calls.push(`fail:${msg}`),
      stop: () => calls.push('stop'),
      pause: () => {},
      resume: () => {},
    };
    indicators.push({ message, indicator, calls });
    return indicator;
  };
  return { factory, indicators };
}

const { factory, indicators } = createMockProgress();
const program = createPadrone('app')
  .runtime({ progress: factory })
  .command('cmd', (c) =>
    c.extend(padroneProgress('Working...')).action(() => 'done')
  );

program.eval('cmd');
// indicators[0].calls → ['succeed:']
```

## Output Coordination

When auto-progress is active, `runtime.output` and `runtime.error` are automatically wrapped to pause/resume the spinner. This prevents garbled output when writing to the terminal while a spinner is animating.

Manual calls to `ctx.context.progress.pause()` and `ctx.context.progress.resume()` are available if you need explicit control.

## How It Works Under the Hood

`padroneProgress()` is an extension that registers a context-providing interceptor. It:

1. **Registers an interceptor** that wraps the validate and execute phases with progress indicator management
2. **Provides typed context** via `.provides<{ progress: PadroneProgressIndicator }>()` so `ctx.context.progress` is fully typed
3. **Coordinates with the runtime** progress factory to create and manage the spinner

This means progress indicators interact naturally with other interceptors. The indicator starts before validation interceptors run and is cleaned up after execution. Interceptor errors are caught and reflected in the progress indicator:

```typescript
program
  .intercept(defineInterceptor({ name: 'auth' }, () => ({
    execute: (ctx, next) => {
      // If this throws, the progress indicator shows the error
      checkAuth();
      return next();
    },
  })))
  .command('deploy', (c) =>
    c.extend(padroneProgress('Deploying...')).action(handler)
  );
```
