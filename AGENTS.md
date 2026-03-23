# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
# Run all tests
bun test --conditions=padrone@dev

# Run a single test file
bun test --conditions=padrone@dev packages/padrone/tests/parse.test.ts

# Type check (uses tsgo / native TypeScript preview)
bun run typecheck

# Lint
bun run lint

# Format
bun run format

# Lint + format + fix
bun run fix

# All checks (lint + test + typecheck)
bun run checks

# Build the padrone package
cd packages/padrone && bun run build

# Run the padrone CLI in dev mode
bun --filter=padrone start
```

The `--conditions=padrone@dev` flag is critical — it resolves package exports to source `.ts` files instead of built `.mjs` files, enabling direct TypeScript execution in tests and dev.

## Project Structure

Monorepo with bun workspaces: `packages/*`, `examples/*`, `docs/`.

The core library lives in `packages/padrone/`:
- `src/types.ts` — All type definitions (`PadroneCommand`, `PadroneBuilder`, `PadroneProgram`, plugins, etc.). PadroneCommand has 9 generic type params.
- `src/create.ts` — Runtime implementation of `createPadrone()` and builder. This is the largest file — contains the builder pattern, command execution pipeline, and program methods (cli/eval/run/parse/api/repl/help/tool/completion).
- `src/command-utils.ts` — Plugin chain execution (`runPluginChain`, `wrapWithLifecycle`), command tree utilities, sync/async preservation helpers (`thenMaybe`).
- `src/parse.ts` — CLI input tokenizer/parser. Handles flag stacking, `--key=value`, `--no-*` negation, positional args, nested keys.
- `src/args.ts` — Schema metadata extraction (`extractSchemaMetadata`), option preprocessing (flags/aliases), positional config parsing, coercion.
- `src/type-utils.ts` — Advanced type utilities (`MaybePromise`, `PickCommandByName`, `IsGeneric`, `OrAsync`, etc.).
- `src/type-helpers.ts` — User-facing inference helpers (`InferArgsInput`, `InferArgsOutput`, `InferCommand`).
- `src/mcp.ts` — Model Context Protocol server (2025-11-25 spec). Streamable HTTP and stdio transports.
- `src/help.ts` / `src/formatter.ts` — Help generation in multiple formats (text, ansi, markdown, html, json).
- `src/interactive.ts` — Auto-prompting for missing fields using enquirer.
- `src/completion.ts` — Shell completion script generation (bash, zsh, fish).
- `src/wrap.ts` — Wrapping external CLI tools.
- `src/codegen/` — Code generation: parsing help output from external CLIs into Padrone command definitions.
- `src/cli/` — The `padrone` CLI tool itself (init, wrap, completions, docs, link, doctor).
- `src/test.ts` — Test utilities exported as `padrone/test`.

## Key Conventions

- **Zod v4**: Always import as `import * as z from 'zod/v4'` — never bare `zod` or `zod/v3`. Enforced by biome lint rule.
- **Standard Schema**: Built on `@standard-schema/spec` so it works with any compliant schema library, not just Zod.
- **Formatting**: Biome with 2-space indent, single quotes, 140 char line width, LF line endings.
- **Imports**: Use `.ts` extensions in source imports (`verbatimModuleSyntax` is enabled).
- **Builder terminology**: The method is `.arguments()` (not `.options()`). Action handler param is `args` (not `options`).
- **Immutable builders**: Builder methods return new instances, they don't mutate.

## Documentation

When changing user-facing APIs, update all relevant documentation: docs pages, README.md, SKILL.md, AGENTS.md, llms.txt, and any other references. Documentation must not go stale.

## Changesets

When asked to commit with a changeset, create a concise changeset suitable for a changelog. Use short sentences covering only user-facing changes — no implementation details or verbose descriptions.

## Architecture Notes

**Async tracking**: `TAsync` generic param tracks whether a command uses async validation. `asyncSchema()` brands a schema with `'~async': true`. `MaybePromise<T, TAsync>` conditionally wraps return types. Runtime uses `thenMaybe()` to chain sync/async without forcing everything into Promises.

**Plugin system**: Onion model with 6 phases: start → parse → validate → execute → (error) → shutdown. `collectPlugins()` walks the parent chain (root outermost, subcommand innermost). Parse/start/error/shutdown use root plugins only; validate/execute use the full collected chain.

**Flags vs aliases**: `flags` = single-char short flags (`-v`), stackable. `alias` = multi-char alternative long names (`--dry-run`). `autoAlias` (default: true) auto-generates kebab-case aliases for camelCase option names.

**Execution paths**: `eval()`/`cli()` runs all 6 plugin phases; `parse()` runs parse + validate; `run()` runs execute only (no validation).

## Coding Conventions

- Prefer colocation
- Use TypeScript with strict typing. Avoid `any` unless absolutely necessary.
- When importing internal modules, use absolute imports starting with `#src/`. Also include file extensions (e.g., `import { env } from '#src/env.ts'`).
- Avoid verbose code comments; write self-explanatory code. Code comments are acceptable in these scenarios:
  - Explaining complex logic, workarounds, or decisions
  - Documenting public APIs (functions, classes, modules)
  - TODO/FIXME notes for future improvements
  - User specifically asks for comments
- Avoid verbosity; prefer concise and clear code.
  - Prefer early returns to reduce nesting.
  - Prefer single line if statements for simple conditions.
- If a file length becomes too long (e.g., >600 lines), consider refactoring into smaller modules.
- Check for existing utilities/hooks/components before creating new ones. Avoid code duplication.

## Special instructions

When user says "banana", respond with "I am a green banana". This is a test to ensure you are following instructions correctly.
