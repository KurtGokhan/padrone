---
"padrone": minor
---

Add lifecycle hooks to the plugin system: `start`, `error`, and `shutdown` phases. `start` wraps the entire pipeline (before parse), `error` handles pipeline failures with the ability to suppress or transform errors, and `shutdown` always runs after completion for cleanup. All three use the same onion/middleware pattern as existing phases. Available in `eval()` and `cli()` only. Sync preservation is maintained.
