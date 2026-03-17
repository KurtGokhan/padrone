---
"padrone": minor
---

Add `padrone/codegen` entry point with a generic code generation toolkit including CodeBuilder (fluent TypeScript source builder), template engine, schemaToCode (Standard Schema to Zod source), FileEmitter (multi-file output), built-in generators (command files, command trees, barrel files), and parsers (help text, fish completions, zsh completions, multi-source merge). Also add `padrone init` CLI command that scaffolds a new Padrone project using the codegen utilities, and reorganize CLI files into `src/cli/` subfolder.
