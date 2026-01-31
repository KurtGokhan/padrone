# Contributing to Padrone

Thank you for your interest in contributing to Padrone! This guide will help you get started.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0 or later)
- Node.js 18+ (for compatibility testing)
- Git

### Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/padrone.git
   cd padrone
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Verify your setup:
   ```bash
   bun run checks
   ```

## Development Workflow

### Project Structure

```
padrone/
├── packages/padrone/     # Main library
│   ├── src/              # Source code
│   └── tests/            # Tests
├── docs/                 # Documentation site
├── examples/             # Example applications
└── scripts/              # Build scripts
```

### Common Commands

```bash
bun run test          # Run tests
bun run check         # Lint and format check
bun run types         # Type checking
bun run checks        # All of the above
```

### Code Style

This project uses [Biome](https://biomejs.dev) for linting and formatting. Key points:

- **Indent**: 2 spaces
- **Quotes**: Single quotes
- **Line width**: 140 characters

Important: Zod imports must use namespace syntax:
```typescript
import * as z from 'zod/v4';  // Correct
```

For detailed style guidelines, see [AGENTS.md](./AGENTS.md).

### Running Tests

```bash
# All tests
bun run test

# Single file
bun run test packages/padrone/tests/cli.test.ts

# By pattern
bun run test --test-name-pattern "should parse"
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

- Write clear, focused commits
- Add tests for new functionality
- Update documentation if needed

### 3. Add a Changeset

When your change should be noted in the changelog, create a changeset:

```bash
bun changeset
```

Follow the prompts to:
1. Select the `padrone` package
2. Choose the version bump type:
   - **patch**: Bug fixes, docs, internal changes
   - **minor**: New features, non-breaking enhancements
   - **major**: Breaking changes
3. Write a brief summary of your change

This creates a file in `.changeset/` that will be included in the next release's changelog.

**When to skip changesets:**
- CI/tooling changes only
- Test-only changes
- Documentation typos

### 4. Run Checks

Before committing, ensure all checks pass:

```bash
bun run checks
```

The pre-commit hook will automatically run Biome on staged files.

### 5. Submit a Pull Request

1. Push your branch to your fork
2. Open a PR against `main`
3. Fill out the PR template
4. Wait for CI checks and review

## Pull Request Guidelines

- Keep PRs focused on a single change
- Write a clear description of what and why
- Link related issues
- Respond to review feedback promptly

## Reporting Issues

- Search existing issues before creating a new one
- Use issue templates when available
- Provide reproduction steps for bugs
- Include version information

## Questions?

- Open a [Discussion](https://github.com/KurtGokhan/padrone/discussions) for questions
- Check the [documentation](https://gkurt.com/padrone/)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
