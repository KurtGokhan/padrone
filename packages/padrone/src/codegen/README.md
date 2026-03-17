# padrone/codegen

Code generation toolkit for Padrone CLI projects. Import from `padrone/codegen`.

## Core Concepts

All parsers produce `CommandMeta` / `FieldMeta` (intermediate representations). All generators consume them. This decouples input formats from output formats.

## API Reference

### Types

- **`FieldMeta`** — Metadata for a single option/flag/argument: `name`, `type` (`string | number | boolean | array | enum | unknown`), `description`, `default`, `required`, `aliases`, `positional`, `enumValues`, `ambiguous`.
- **`CommandMeta`** — Intermediate representation for a CLI command: `name`, `description`, `aliases`, `arguments` (named options), `positionals`, `subcommands` (recursive), `examples`, `deprecated`.
- **`CodeBuilder`** — Fluent interface for building TypeScript source with `.import()`, `.importType()`, `.line()`, `.block()`, `.comment()`, `.raw()`, `.build()`.
- **`FileEmitter`** — Multi-file output manager with `.addFile()` and `.emit()`.
- **`GeneratorContext`** — Shared context for generators: `outDir`, `createCodeBuilder`, `emitter`, `template`, `log`.

### Template Engine

```ts
import { template } from 'padrone/codegen'

const render = template(`Hello, {{name}}!`)
render({ name: 'world' }) // "Hello, world!"
```

Syntax: `{{var}}` interpolation, `{{#arr}}...{{/arr}}` iteration (`{{.}}` for current item), `{{#bool}}...{{/bool}}` conditionals, `{{>partial}}` partials.

### CodeBuilder

```ts
import { createCodeBuilder } from 'padrone/codegen'

const code = createCodeBuilder()
  .import(['createPadrone'], 'padrone')
  .import(['z'], 'zod/v4')
  .line(`const program = createPadrone('my-cli')`)
  .block('.configure({', (b) => b.line(`description: 'My CLI',`), '})')
  .build()

// code.text contains the formatted source
// code.imports contains the deduped import map
```

### FileEmitter

```ts
import { createFileEmitter } from 'padrone/codegen'

const emitter = createFileEmitter({
  outDir: './output',
  header: '// Auto-generated',
  overwrite: false,  // skip existing files
  dryRun: false,
})

emitter.addFile('src/index.ts', codeBuilder.build())
emitter.addFile('package.json', jsonString)
const result = await emitter.emit()
// result: { written: string[], skipped: string[], errors: [] }
```

### Schema-to-Code

```ts
import { schemaToCode, fieldMetaToCode } from 'padrone/codegen'

// Convert a Standard Schema (e.g. Zod) to Zod source code
const result = schemaToCode(myZodSchema)
// result: { code: 'z.object({ ... })', imports: ['z'] }

// Convert FieldMeta[] to Zod z.object() source
const result2 = fieldMetaToCode(fields)
// result2: { code: 'z.object({ ... })', imports: ['z'] }
```

### Generators

```ts
import { generateCommandFile, generateCommandTree, generateBarrelFile } from 'padrone/codegen'

// Generate a single command file from CommandMeta
const builder = generateCommandFile(commandMeta, generatorCtx)

// Walk a CommandMeta tree and emit one file per command + program.ts + index.ts
generateCommandTree(rootCommandMeta, generatorCtx)

// Generate a barrel (index.ts) re-exporting from given paths
const barrelCode = generateBarrelFile(['./commands/hello', './commands/deploy'])
```

### Parsers

```ts
import { parseHelpOutput, parseFishCompletions, parseZshCompletions, mergeCommandMeta } from 'padrone/codegen'

// Parse --help output (GNU, cobra, argparse, commander/yargs styles)
const meta = parseHelpOutput(helpText, { name: 'my-tool' })

// Parse fish shell completion scripts
const meta2 = parseFishCompletions(fishScript)

// Parse zsh _arguments completion definitions
const meta3 = parseZshCompletions(zshScript)

// Merge multiple CommandMeta from different sources (later sources take precedence unless ambiguous)
const merged = mergeCommandMeta(meta, meta2, meta3)
```

## Typical Workflow

1. **Parse** existing CLI help/completions into `CommandMeta` using parsers
2. **Merge** multiple sources with `mergeCommandMeta()` for best coverage
3. **Generate** Padrone source files with `generateCommandTree()` or `generateCommandFile()`
4. **Emit** files to disk with `FileEmitter`

Or use `template()` and `createFileEmitter()` directly for custom scaffolding (see `padrone init` implementation in `src/cli/init.ts`).
