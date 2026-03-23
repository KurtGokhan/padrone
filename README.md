<p align="center">
  <img src="media/padrone.svg" alt="Padrone Logo" width="200" height="200" />
</p>

<p align="center">
  <strong>Type-safe CLI framework powered by Zod schemas</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/padrone"><img src="https://img.shields.io/npm/v/padrone.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/padrone"><img src="https://img.shields.io/npm/dm/padrone.svg" alt="npm downloads"></a>
  <a href="https://github.com/KurtGokhan/padrone/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/padrone.svg" alt="license"></a>
</p>

---

Define your CLI with Zod schemas. Get type safety, validation, help generation, interactive prompts, shell completions, AI tool integration, and more — all from a single source of truth.

Built on [Standard Schema](https://github.com/standard-schema/standard-schema), so it also works with Valibot, ArkType, and others.

## Install

```bash
npm install padrone zod
```

## Quick Start

```typescript
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const program = createPadrone('myapp')
  .command('greet', (c) =>
    c
      .arguments(
        z.object({
          names: z.array(z.string()).describe('Names to greet'),
          prefix: z.string().optional().describe('Prefix').meta({ flags: 'p' }),
        }),
        { positional: ['...names'] },
      )
      .action((args) => {
        for (const name of args.names) {
          console.log(`Hello, ${args.prefix ?? ''} ${name}!`);
        }
      }),
  );

program.cli();
```

```bash
myapp greet John Jane -p Mr.
# Hello, Mr. John!
# Hello, Mr. Jane!
```

## What It Does

```typescript
// Multiple ways to run commands
program.cli();                                              // from process.argv
program.eval('greet John --prefix Mr.');                    // from a string
program.run('greet', { names: ['John'], prefix: 'Mr.' });  // typed args
program.api().greet({ names: ['John'], prefix: 'Mr.' });   // as a function

// Parse without executing
const { args } = program.parse('greet John --prefix Mr.');

// Interactive REPL
for await (const result of program.repl()) { /* ... */ }

// AI tool for Vercel AI SDK
const tool = program.tool();

// MCP server for AI assistants (Claude, Cursor, etc.)
await program.mcp();  // or: myapp mcp

// Shell completions
const script = program.completion('zsh');

// Help in multiple formats
program.help('greet');                        // text
program.help('greet', { format: 'json' });   // json, markdown, html, ansi
```

## Features at a Glance

**Arguments** — positional args, variadic args, short flags (`-v`), long aliases (`--dry-run`), auto kebab-case aliases, negatable booleans (`--no-verbose`).

**Env & Config** — load from environment variables with `.env()` and config files with `.configFile()`. Precedence: CLI > stdin > env > config > defaults.

**Interactive prompts** — auto-prompt for missing fields. Booleans become confirm, enums become select, arrays become multi-select.

**Progress indicators** — auto-managed spinners with dynamic messages. `.progress({ progress: 'Deploying...', success: (r) => \`v${r.version}\` })`.

**Plugins** — middleware hooks for 6 phases (start, parse, validate, execute, error, shutdown). Onion model with `next()`.

**Composition** — mount programs as subcommands with `.mount()`, override commands with merge semantics.

**Wrapping** — wrap external CLI tools with `.wrap({ command: 'git', args: ['commit'] })`.

## API

### Builder (define commands)

| Method | What it does |
|--------|-------------|
| `.arguments(schema, meta?)` | Define args with Zod schema, positional config, field metadata |
| `.action(handler)` | Set handler `(args, ctx, base?) => result` |
| `.command(name, builder)` | Add subcommand (name or `[name, ...aliases]`) |
| `.mount(name, program)` | Mount another program as subcommand tree |
| `.configure(config)` | Set title, description, version, etc. |
| `.env(schema)` | Map env vars to args |
| `.configFile(file, schema?)` | Load args from config files |
| `.wrap(config)` | Wrap an external CLI tool |
| `.progress(config?)` | Auto-managed spinner |
| `.use(plugin)` | Register middleware plugin |
| `.runtime(runtime)` | Custom I/O (for non-terminal use) |
| `.updateCheck(config?)` | Background version check |
| `.async()` | Mark as async validation |

### Program (run commands)

| Method | What it does |
|--------|-------------|
| `.cli(prefs?)` | Entry point — parses `process.argv`, throws on errors |
| `.eval(input, prefs?)` | Parse + validate + execute string, returns errors softly |
| `.run(command, args)` | Run by name with typed args (no validation) |
| `.parse(input?)` | Parse without executing |
| `.api()` | Generate typed function API |
| `.repl(options?)` | Interactive REPL session |
| `.help(command?, prefs?)` | Generate help (text, ansi, markdown, html, json) |
| `.tool()` | Vercel AI SDK tool definition |
| `.mcp(prefs?)` | Start MCP server (HTTP or stdio) |
| `.completion(shell?)` | Shell completion script |
| `.find(command)` | Look up command by path |
| `.stringify(command?, args?)` | Convert back to CLI string |

### Zod `.meta()` fields

| Field | Example | Purpose |
|-------|---------|---------|
| `flags` | `'v'` | Single-char short flag (`-v`) |
| `alias` | `'dry-run'` | Multi-char long alias (`--dry-run`) |
| `examples` | `['8080']` | Example values in help |
| `deprecated` | `'Use --debug'` | Deprecation warning |
| `hidden` | `true` | Hide from help |
| `group` | `'Advanced'` | Group in help output |

### Arguments meta (second param of `.arguments()`)

```typescript
.arguments(schema, {
  positional: ['source', '...files', 'dest'],
  interactive: ['name', 'template'],
  optionalInteractive: ['typescript'],
  fields: { verbose: { flags: 'v' } },
  stdin: 'data',
  autoAlias: true,  // default
})
```

## Agent Skill

Give your AI coding agent knowledge of the Padrone API:

```bash
npx skills add KurtGokhan/padrone
```

## Requirements

- Node.js 18+ or Bun
- TypeScript 5.0+ (recommended)
- Zod (or any Standard Schema-compatible library)

## License

[MIT](LICENSE)
