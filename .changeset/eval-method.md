---
"padrone": minor
---

Add `eval()` method and separate from `cli()`. `program.eval(input)` parses, validates, and executes a command string with soft error handling (returns result with issues instead of throwing). `program.cli()` is now exclusively the process entry point that reads from `process.argv` and throws on validation errors. The REPL and AI SDK tool integration now use `eval()` internally.
