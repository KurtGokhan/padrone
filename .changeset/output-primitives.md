---
'padrone': minor
---

Add format-aware output primitives (table, tree, list, key-value) to auto-output. Actions can use `ctx.context.output.table()`, `.tree()`, `.list()`, `.kv()` for styled output that adapts to the runtime format (ANSI, text, JSON, markdown, HTML). Declarative formatting via `padroneAutoOutput({ output: 'table' })` per-command. Extract shared Styler/Layout infrastructure from help formatter into reusable `styling.ts` module.
