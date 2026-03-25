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
- `src/types.ts` — All type definitions (`PadroneCommand`, `PadroneBuilder`, `PadroneProgram`, plugins, etc.). PadroneCommand has 10 generic type params.
- `src/create.ts` — `createPadrone()` factory and builder object. Wires together the modules below. Immutable builder methods (configure, arguments, action, command, mount, use, etc.).
- `src/exec.ts` — Core execution pipeline: signal handling → builtin dispatch → parse → validate → execute phases. Contains `execCommand()`, `collectPlugins()`, `handleBuiltinAction()`, and progress cleanup.
- `src/validate.ts` — CLI input parsing (`parseCommand`), argument preprocessing (`buildCommandArgs`), schema validation (`validateCommandArgs`), unknown arg detection, stdin reading, env validation.
- `src/program-methods.ts` — Program API methods: `cli()`, `eval()`, `run()`, `parse()`, `tool()`, `stringify()`, `help()`, `api()`, `repl()`, `mcp()`, `serve()`, `completion()`.
- `src/builtins.ts` — Built-in command/flag detection (`checkBuiltinCommands`), `--config`/`--color` flag extraction, `resolveInherited()` parent-chain walker.
- `src/suggestions.ts` — "Did you mean?" formatting (`formatSuggestions`), issue enrichment with fuzzy suggestions.
- `src/command-utils.ts` — Plugin chain execution (`runPluginChain`, `wrapWithLifecycle`), command tree utilities, sync/async preservation helpers (`thenMaybe`).
- `src/parse.ts` — CLI input tokenizer/parser. Handles flag stacking, `--key=value`, `--no-*` negation, positional args, nested keys.
- `src/args.ts` — Schema metadata extraction (`extractSchemaMetadata`), option preprocessing (flags/aliases), positional config parsing, coercion.
- `src/type-utils.ts` — Advanced type utilities (`MaybePromise`, `PickCommandByName`, `IsGeneric`, `OrAsync`, etc.).
- `src/type-helpers.ts` — User-facing inference helpers (`InferArgsInput`, `InferArgsOutput`, `InferCommand`, `InferContext`).
- `src/mcp.ts` — *(experimental)* Model Context Protocol server (2025-11-25 spec). Streamable HTTP and stdio transports.
- `src/serve.ts` — *(experimental)* REST HTTP server. Exposes commands as endpoints with OpenAPI docs (Scalar).
- `src/help.ts` / `src/formatter.ts` — Help generation in multiple formats (text, ansi, markdown, html, json).
- `src/interactive.ts` — Auto-prompting for missing fields using enquirer.
- `src/completion.ts` — Shell completion script generation (bash, zsh, fish).
- `src/wrap.ts` — *(experimental)* Wrapping external CLI tools.
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

**Plugin system**: Onion model with 6 phases: start → parse → validate → execute → (error) → shutdown. `collectPlugins()` in `exec.ts` walks the parent chain (root outermost, subcommand innermost). Parse/start/error/shutdown use root plugins only; validate/execute use the full collected chain.

**Flags vs aliases**: `flags` = single-char short flags (`-v`), stackable. `alias` = multi-char alternative long names (`--dry-run`). `autoAlias` (default: true) auto-generates kebab-case aliases for camelCase option names.

**Execution paths**: `eval()`/`cli()` runs all 6 plugin phases; `parse()` runs parse + validate; `run()` runs execute only (no validation).

**Context**: User-defined, strongly-typed object that flows through the command tree. Defined via `.context<T>()` (type-only) or `.context(transform)` (with runtime callback). Subcommands inherit the parent context type but can transform it. `mount()` accepts an optional `{ context }` option for context transforms. Context is provided at invocation via `cli()`, `eval()`, `run()`. Resolved by walking the command parent chain and applying transforms from root to target. Available in action handlers via `ctx.context` and in all plugin phase contexts.

**Mutation commands**: `.configure({ mutation: true })` marks a command as performing side effects. Affects serve (POST-only, experimental), MCP (`annotations.destructiveHint`, experimental), and tool() (`needsApproval` default).

## Coding Conventions

- Prefer colocation
- Use TypeScript with strict typing. Avoid `any` unless absolutely necessary.
- When importing internal modules, use absolute imports starting with `#src/`. Also include file extensions (e.g., `import { env } from '#src/env.ts'`).
- Always use top-level `import type` for type imports. Never use inline `import('./module.ts').Type` syntax in type annotations.
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
