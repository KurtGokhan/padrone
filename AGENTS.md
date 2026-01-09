# AGENTS.md

This file provides guidance for AI coding agents working on the Padrone codebase.

## Project Overview

Padrone is a TypeScript library for building type-safe, interactive CLI applications with Zod schema validation. It's a monorepo using Bun as the package manager and runtime.

**Repository Structure:**
- `packages/padrone/` - Main library source code
- `packages/padrone/tests/` - Test files
- `examples/padrone-example/` - Example CLI application
- `e2e/example-test/` - End-to-end tests
- `docs/` - Documentation site (Astro-based)
- `scripts/` - Build scripts

## Build/Lint/Test Commands

### Package Manager
This project uses **Bun** exclusively. Do not use npm, yarn, or pnpm.

### Common Commands (from root)
```bash
bun install              # Install dependencies
bun run test                 # Run all tests
bun run check            # Lint + format check (biome)
bun run lint             # Lint only
bun run format           # Format only
bun run types            # Type checking (uses tsgo - TypeScript native preview)
bun run build            # Build packages (uses tsdown)

bun run checks           # Run all checks: lint, test, types
```

### Running Tests
```bash
# Run all tests
bun run test

# Run a single test file
bun run test packages/padrone/tests/cli.test.ts

# Run tests matching a pattern (test name)
bun run test --test-name-pattern "should parse"

# Run a specific describe block
bun run test --test-name-pattern "CLI parsing"

# Run tests in a specific directory
bun run test packages/padrone/tests/
```

### CI Pipeline
The CI runs these checks in order:
1. `bun i` - Install dependencies
2. `bun check` - Biome lint + format
3. `bun run test` - Run tests
4. `bun types` - TypeScript type checking

## Code Style Guidelines

### TypeScript Configuration
- Strict mode enabled
- `noUncheckedIndexedAccess: true` - Index access can return undefined
- `verbatimModuleSyntax: true` - Explicit `type` imports required
- Target: ESNext, Module: Preserve with bundler resolution

### Formatting (Biome)
- **Indent**: 2 spaces
- **Line width**: 140 characters
- **Quotes**: Single quotes for JS/TS
- **Line endings**: LF
- **Imports**: Auto-organized

### Import Style
```typescript
// Type-only imports MUST use 'type' keyword (verbatimModuleSyntax)
import type { SomeType } from './types';

// CRITICAL: Zod imports MUST use namespace syntax with explicit version
import * as z from 'zod/v4';  // Correct
// import { z } from 'zod';   // ERROR - will fail lint
// import z from 'zod/v4';    // ERROR - will fail lint

// Regular imports
import { createPadrone } from 'padrone';
```

### Naming Conventions
- **Files**: kebab-case (`type-utils.ts`, `console-mocker.ts`)
- **Types/Interfaces**: PascalCase (`PadroneCommand`, `HelpOptionInfo`)
- **Functions**: camelCase (`createPadrone`, `parseCliInputToParts`)
- **Constants**: camelCase for module-level (`commandSymbol`)
- **Internal properties**: Prefix with `~` for type-only (`'~types'`)

### Type Patterns
```typescript
// Use explicit return types for public API functions
export function createPadrone(name: string): PadroneProgram { ... }

// Use satisfies for type-safe object literals while preserving inference
} satisfies AnyPadroneProgram as unknown as TBuilder;

// JSDoc comments for public APIs with @example blocks
/**
 * Creates a new Padrone CLI program.
 * @example
 * const program = createPadrone('my-cli')
 *   .command('hello', (c) => c.action(() => 'Hello!'));
 */
```

### Error Handling
- Throw `Error` with descriptive messages
- Check for undefined explicitly due to `noUncheckedIndexedAccess`
```typescript
const found = commands.find((cmd) => cmd.name === name);
if (!found) throw new Error(`Command "${name}" not found`);
```

### Code Patterns
- Prefer `const` assertions (`as const`)
- Avoid `forEach` (allowed via biome config, but `for...of` preferred)
- Empty catch blocks are acceptable for non-critical errors
- Use optional chaining and nullish coalescing

## Testing Patterns

### Test Framework
Uses **Bun's built-in test runner** (`bun:test`).

### Basic Test Structure
```typescript
import { describe, expect, it } from 'bun:test';
import * as z from 'zod/v4';
import { createPadrone } from '../src/index';

describe('Feature', () => {
  it('should do something', () => {
    const program = createPadrone('test')
      .command('cmd', (c) => c.action(() => 'result'));

    const result = program.cli('cmd');
    expect(result.result).toBe('result');
  });
});
```

### Snapshot Tests
```typescript
it('should match snapshot', () => {
  const help = program.help('command', { format: 'text' });
  expect(help).toMatchSnapshot();
});
```

### Inline Snapshots
```typescript
expect(result.options).toMatchInlineSnapshot(`
  {
    "city": "New York",
    "unit": "celsius",
  }
`);
```

### Type Tests
```typescript
import { expectTypeOf } from 'bun:test';

describe.skip('Types', () => {
  expectTypeOf<SomeType>().toEqualTypeOf<ExpectedType>();
});
```

### Test Utilities
- `tests/console-mocker.ts` - Mock console output
- `tests/common.ts` - Shared test fixtures

## Lint Rules (Biome)

### Key Rules
- `noUnusedImports`: warn (auto-fixed)
- `noUnusedVariables`: info
- `noUnusedFunctionParameters`: info
- `noExplicitAny`: off (allowed)
- `noNonNullAssertion`: off (allowed)
- `noForEach`: off (allowed)

### Critical Restriction
Zod imports MUST use namespace syntax with explicit version:
```typescript
// This will cause a lint ERROR:
import { z } from 'zod';
import z from 'zod/v4';

// This is CORRECT:
import * as z from 'zod/v4';
```

## Dependencies

### Dependency Philosophy
**External dependencies are strongly discouraged.** Padrone should work as a standalone library with minimal external dependencies. Only add dependencies when absolutely necessary, and prefer optional peer dependencies over runtime dependencies. This keeps the library lightweight and reduces dependency bloat for end users.

### Runtime (padrone package)
- `@standard-schema/spec` - Standard schema specification (minimal, required for schema abstraction)

### Peer Dependencies (optional)
- `zod` (^3.25.0 or ^4.0.0) - Optional schema validation library
- `ai` (5 or 6) - Optional Vercel AI SDK for tool generation

### Dev Dependencies
- `@biomejs/biome` - Linting and formatting
- `@types/bun` - Bun types
- `tsdown` - Build tool
- `typescript` - Type checking
- `husky` + `lint-staged` - Git hooks (pre-commit runs biome check)

## Common Gotchas

1. **Always use `bun`** - Never npm/yarn/pnpm
2. **Zod imports** - Must be `import * as z from 'zod/v4'`
3. **Type imports** - Must use `import type` for type-only imports
4. **Index access** - Can return undefined, handle appropriately
5. **Pre-commit hook** - Runs `biome check --write` automatically
6. **Test runner** - Use `bun run test`, not jest/vitest
