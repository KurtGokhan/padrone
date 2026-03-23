---
title: CLI Tools
description: Use the padrone CLI to scaffold, lint, link, and generate docs for your projects
---

The `padrone` CLI provides developer tools for scaffolding, linting, linking, and generating documentation for Padrone projects.

```bash
npx padrone --help
```

## padrone init

Scaffold a new Padrone CLI project with a ready-to-run template:

```bash
# Create in current directory
padrone init

# Create in a new directory
padrone init my-cli

# With options
padrone init my-cli --name my-tool --description "My awesome CLI" --version 1.0.0
```

This generates:
- `package.json` — dependencies, scripts, and bin field
- `tsconfig.json` — TypeScript configuration
- `src/index.ts` — starter program with a `hello` command

After scaffolding:

```bash
cd my-cli
bun install
bun run dev    # Start with --watch
```

**Options:**

| Option | Description |
|--------|-------------|
| `dir` (positional) | Target directory (defaults to `.`) |
| `--name` | Project name (defaults to directory name) |
| `--description` | Project description |
| `--version` | Initial version (default: `0.1.0`) |

## padrone doctor

Lint and validate your CLI program definition. Catches common issues before users encounter them:

```bash
# Auto-detect entry from package.json bin field
padrone doctor

# Specify entry file
padrone doctor src/cli.ts
```

**Diagnostics checked:**

| Check | Severity | Description |
|-------|----------|-------------|
| Circular references | error | Circular parent refs in command tree |
| Duplicate aliases | error | Two sibling commands share the same name/alias |
| Duplicate flags/aliases | error | Two options in the same command share a flag or alias |
| Positional not in schema | error | Positional argument name doesn't exist in the schema |
| Multiple variadics | error | More than one variadic positional argument |
| Shadowed builtins | warning | Options or commands named `help`/`version` |
| Missing action | warning | Leaf command with no action handler |
| Missing description | warning | Schema property without a description |
| Variadic not last | warning | Variadic positional not in the last position |
| Unused plugins | warning | Plugin with no phase handlers |
| Unreachable commands | warning | Non-hidden command under a hidden parent |
| Missing command description | warning | Non-hidden, non-root command without title or description |
| Empty command groups | warning | Branch command with no reachable leaf descendants |
| Deprecated without hint | warning | `deprecated: true` without a replacement message |

Exits with code `1` if any errors are found. Warnings don't affect the exit code.

## padrone link / unlink

Link your CLI program for global use during development, without publishing:

```bash
# Link the current project (auto-detects from package.json)
padrone link

# Link a specific entry file
padrone link src/cli.ts --name my-tool

# List all linked programs
padrone link --list

# Set up PATH (adds ~/.padrone/bin to your shell config)
padrone link --setup

# Unlink
padrone unlink my-tool
```

This creates a shim in `~/.padrone/bin/` that runs your entry file with `bun`. After `--setup`, the linked CLI is available globally.

## padrone completions

Generate shell completion install instructions for a Padrone CLI:

```bash
# Show instructions for the current shell
padrone completions

# For a specific CLI program
padrone completions my-tool

# For a specific shell
padrone completions my-tool --for zsh

# Write completions to shell config
padrone completions my-tool --setup
```

Supports `bash`, `zsh`, `fish`, and `powershell`.

## padrone docs

Generate documentation from your CLI program definition:

```bash
# Generate markdown docs
padrone docs src/cli.ts

# Custom output directory and format
padrone docs src/cli.ts --output ./docs/reference --format markdown

# Include hidden commands
padrone docs src/cli.ts --include-hidden

# Preview without writing
padrone docs src/cli.ts --dry-run
```

**Options:**

| Option | Description |
|--------|-------------|
| `entry` (positional) | Entry file exporting a Padrone program |
| `--output` | Output directory (default: `./docs/cli`) |
| `--format` | Output format: `markdown`, `html`, `man`, `json` |
| `--include-hidden` | Include hidden commands and options |
| `--dry-run` | Print what would be generated without writing |

## padrone wrap

Generate a type-safe Padrone wrapper for an existing CLI tool by parsing its help output:

```bash
# Wrap a CLI tool
padrone wrap docker

# Specify parsing source and output
padrone wrap kubectl --source help --output ./src/kubectl

# Limit subcommand depth
padrone wrap git --depth 2

# Preview without writing
padrone wrap gh --dry-run
```

**Options:**

| Option | Description |
|--------|-------------|
| `command` (positional) | CLI command to wrap (e.g., `gh`, `docker`, `kubectl`) |
| `--source` | Parsing source: `help`, `fish`, `zsh` (default: `help`) |
| `--output` | Output directory (default: `./src/<command>`) |
| `--depth` | Max subcommand depth (default: `4`) |
| `--dry-run` | Print what would be generated without writing |
| `--overwrite` | Overwrite existing files |
| `-y`, `--yes` | Skip confirmation prompt |
