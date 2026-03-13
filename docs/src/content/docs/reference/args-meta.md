---
title: Arguments Metadata
description: Reference for Zod meta arguments and positional argument configuration
---

Padrone uses Zod schemas with `.meta()` to configure CLI-specific behavior. This reference covers all available metadata configuration.

## Zod Meta Configuration

Use `.meta()` on individual Zod schema properties to configure their CLI behavior:

```typescript
z.object({
  output: z.string()
    .describe('Output file path')
    .meta({
      alias: 'o',
      examples: ['output.json', './dist/bundle.js'],
      env: 'OUTPUT_PATH',
      configKey: 'build.output',
    }),
})
```

### Available Meta Properties

| Property | Type | Description |
|----------|------|-------------|
| `alias` | `string` | Short alias (e.g., `'p'` for `-p`) |
| `examples` | `string[]` | Example values shown in help |
| `deprecated` | `string \| boolean` | Mark as deprecated with optional message |
| `hidden` | `boolean` | Hide from help output |
| `env` | `string \| string[]` | Environment variable name(s) |
| `configKey` | `string` | Dot-notation path in config file |

---

## Meta Configuration

The second argument to `.arguments()` configures positional arguments and per-argument metadata:

```typescript
.arguments(schema, {
  positional: ['source', '...files', 'dest'],
  fields: {
    verbose: { env: 'VERBOSE' },
    config: { configKey: 'settings.config' },
  },
})
```

### positional

Array of argument names to accept as positional arguments.

```typescript
{ positional: ['source', 'dest'] }
```

**Positional argument order:**
- Arguments are matched in the order specified
- Optional arguments are skipped if not provided
- Position matters: `['source', 'dest']` means first arg is source, second is dest

**Variadic arguments:**
- Prefix with `...` to capture multiple values: `['...files']`
- Variadic args must be arrays in the schema: `z.array(z.string())`
- Only one variadic argument is allowed per command
- Variadic can be at any position

```typescript
// Capture all args between fixed positions
{ positional: ['command', '...args', 'output'] }
// command = first arg
// args = all middle args
// output = last arg
```

### fields

Per-argument configuration that supplements or overrides `.meta()`:

```typescript
{
  fields: {
    apiKey: {
      env: 'API_KEY',           // Environment variable
      configKey: 'auth.apiKey', // Config file path
    },
  },
}
```

This is equivalent to using `.meta()` on the schema property but allows configuration to be kept separate from the schema definition.

---

## Environment Variables

Bind arguments to environment variables:

```typescript
// Single env var
z.string().meta({ env: 'API_KEY' })

// Multiple env vars (first found wins)
z.string().meta({ env: ['API_KEY', 'APP_API_KEY'] })

// Via arguments config
.arguments(schema, {
  fields: {
    apiKey: { env: 'API_KEY' },
  },
})
```

**Resolution priority:**
1. CLI argument (highest)
2. Environment variable
3. Config file
4. Default value (lowest)

**Type coercion:**
- Strings: Used as-is
- Numbers: Parsed with `Number()`
- Booleans: `'true'`, `'1'`, `'yes'` → `true`; others → `false`
- Arrays: Comma-separated values

---

## Config Files

Load arguments from configuration files:

```typescript
const program = createPadrone('app')
  .configure({
    configFiles: [
      'app.config.json',
      'app.config.yaml',
      '.apprc',
    ],
  })
  .arguments(
    z.object({
      port: z.number().default(3000),
    }),
    {
      fields: {
        port: { configKey: 'server.port' },
      },
    }
  );
```

### Config File Format

Padrone supports JSON, JSONC, and YAML config files. The `configKey` uses dot notation:

```json
{
  "server": {
    "port": 8080,
    "host": "0.0.0.0"
  }
}
```

```typescript
{ configKey: 'server.port' }  // → 8080
{ configKey: 'server.host' }  // → '0.0.0.0'
```

### Config File Search

Files are searched in order specified. The first existing file is used.

---

## Aliases

Short argument aliases allow single-character shortcuts:

```typescript
z.object({
  verbose: z.boolean().optional().meta({ alias: 'v' }),
  port: z.number().default(3000).meta({ alias: 'p' }),
  output: z.string().optional().meta({ alias: 'o' }),
})
```

**Usage:**
```bash
app -v -p 8080 -o output.json
# Equivalent to:
app --verbose --port 8080 --output output.json
```

**Combined short flags:**
```bash
app -vp 8080
# -v (boolean) + -p 8080
```

---

## Deprecation

Mark arguments as deprecated to warn users:

```typescript
z.object({
  // Simple deprecation
  old: z.string().optional().meta({ deprecated: true }),

  // With migration message
  legacy: z.string().optional().meta({
    deprecated: 'Use --new-arg instead',
  }),
})
```

Deprecated arguments still work but display a warning when used.

---

## Hidden Arguments

Hide arguments from help output while keeping them functional:

```typescript
z.object({
  // Visible in help
  port: z.number().default(3000),

  // Hidden from help
  debug: z.boolean().optional().meta({ hidden: true }),
  internalFlag: z.string().optional().meta({ hidden: true }),
})
```

Hidden arguments:
- Don't appear in `--help` output
- Still work when specified
- Useful for internal/experimental features

---

## Examples in Help

Provide example values for help text:

```typescript
z.object({
  format: z.enum(['json', 'csv', 'xml'])
    .describe('Output format')
    .meta({ examples: ['json', 'csv'] }),

  date: z.string()
    .describe('Date filter')
    .meta({ examples: ['2024-01-01', 'today', 'last-week'] }),
})
```

Examples appear in the generated help text to guide users.
