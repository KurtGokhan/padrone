---
"padrone": minor
---

Add REPL command history, tab completion, and output styling. The built-in terminal REPL now supports up/down arrow history navigation and tab completion for command names, subcommands, options, and aliases. New `repl()` preferences: `history` (initial entries), `completion` (toggle tab completion), `spacing` (separators before/after command output — supports blank lines, repeated characters, multi-line arrays, and independent before/after config), and `outputPrefix` (prefix each output line, e.g. `'│ '`). The default prompt is bold in ANSI-capable terminals.
