---
title: Progress Indicators
description: Show spinners and status messages during long-running commands
---

Padrone provides a built-in progress indicator system for commands that take time — async operations, network calls, file processing, etc. Progress indicators are auto-managed by default (start before validation, succeed/fail after execution) but can also be driven manually from within an action handler.

## Quick Example

```typescript
import { createPadrone } from 'padrone';

const program = createPadrone('app')
  .command('deploy', (c) =>
    c
      .async()
      .progress('Deploying...')
      .action(async () => {
        await deploy();
        return { version: '2.0' };
      })
  );
```

Running `app deploy` shows a spinner with "Deploying..." that auto-succeeds when the action resolves.

## Auto-Managed Progress

Use the `.progress()` builder method to configure automatic progress indicators. The indicator starts before validation and is automatically stopped on success or failure.

### Simple Message

```typescript
.progress('Deploying...')
```

### Boolean Shorthand

```typescript
.progress(true)
// Shows "Running <command-name>..."
```

### Full Configuration

```typescript
.progress({
  validation: 'Validating inputs...',  // Shown during async validation
  progress: 'Deploying...',            // Shown during execution
  success: 'Deployed successfully!',   // Shown on success
  error: 'Deploy failed',             // Shown on failure
  spinner: 'line',                     // Spinner preset
})
```

The `validation` message is shown first (during schema validation), then replaced by the `progress` message when execution begins.

## Dynamic Success/Error Messages

The `success` and `error` fields accept callbacks that receive the actual result or error:

```typescript
.progress({
  progress: 'Deploying...',
  success: (result) => `Deployed v${result.version}`,
  error: (err) => `Deploy failed: ${err.message}`,
})
```

### Custom Indicator Icons

Callbacks can return an object with `message` and `indicator` to override the success/error icon per-call:

```typescript
.progress({
  progress: 'Running checks...',
  success: (result) => ({
    message: `All ${result.count} checks passed`,
    indicator: '🎉',
  }),
  error: () => ({
    message: 'Checks failed',
    indicator: '💥',
  }),
})
```

Static values also support the object form:

```typescript
.progress({
  progress: 'Building...',
  success: { message: 'Build complete', indicator: '🏗️' },
})
```

### Suppressing Messages

Pass `null` to suppress the success or error message entirely (the spinner just clears):

```typescript
.progress({
  progress: 'Working...',
  success: null,  // No success message
})
```

Callbacks can also return `null`:

```typescript
success: (result) => result.silent ? null : `Done: ${result.count} items`
```

## Manual Progress via `ctx.progress`

The action context provides a `progress` property for manual control:

```typescript
.progress('Importing...')
.action((args, ctx) => {
  for (const item of items) {
    process(item);
    ctx.progress.update(`Importing ${item.name}...`);
  }
  return `Imported ${items.length} items`;
})
```

### Without `.progress()` Config

`ctx.progress` works even without calling `.progress()` on the builder. It lazily creates a real indicator on first use:

```typescript
.action((_args, ctx) => {
  ctx.progress.update('Starting work...');
  // A real spinner appears now
  doWork();
  ctx.progress.update('Almost done...');
  return 'done';
})
```

Lazily-created indicators are automatically stopped (not succeeded/failed) when execution finishes. When the runtime has no progress factory, `ctx.progress` is a silent no-op.

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
.progress({ progress: 'Loading...', spinner: 'line' })
```

### Custom Frames

```typescript
.progress({
  progress: 'Loading...',
  spinner: { frames: ['🌑', '🌒', '🌓', '🌔', '🌕'], interval: 150 },
})
```

### Disabling the Spinner

Set `spinner: false` to show static text without animation:

```typescript
.progress({ progress: 'Processing...', spinner: false })
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
    c.progress('Working...').action(() => 'done')
  );

program.eval('cmd');
// indicators[0].calls → ['succeed:']
```

## Output Coordination

When auto-progress is active, `runtime.output` and `runtime.error` are automatically wrapped to pause/resume the spinner. This prevents garbled output when writing to the terminal while a spinner is animating.

Manual calls to `ctx.progress.pause()` and `ctx.progress.resume()` are available if you need explicit control.

## Integration with Plugins

Progress indicators interact naturally with the plugin system. The indicator starts before validation plugins run and is cleaned up in the lifecycle shutdown. Plugin errors are caught and reflected in the progress indicator:

```typescript
program
  .use({
    name: 'auth',
    execute: (ctx, next) => {
      // If this throws, the progress indicator shows the error
      checkAuth();
      return next();
    },
  })
  .command('deploy', (c) =>
    c.progress('Deploying...').action(handler)
  );
```
