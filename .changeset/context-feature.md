---
'padrone': minor
---

Add typed context support. Define context with `.context<T>()` or `.context(transform)`, provide it via `cli()`, `eval()`, `run()`, and access it in action handlers as `ctx.context` and in all plugin phase contexts. Subcommands inherit context from parents. `.mount()` accepts an optional `{ context }` transform. New `InferContext` type helper.
