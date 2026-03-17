---
"padrone": minor
---

Add `padrone/completion` subpath export and `padrone completions` CLI command. Shell completion generation is now lazy-loaded via dynamic import, and `setupCompletions()` writes eval snippets to shell config files with idempotent marker-based replacement. User programs get `--setup` on the built-in `completion` command (e.g. `myapp completion bash --setup`). The `.completion()` method is now async.
