---
"padrone": minor
---

Add plugin system with middleware pattern for intercepting command execution phases. Plugins use an onion model with `next()` to wrap parse, validate, and execute phases. Registered via `.use()` on both programs and subcommand builders. Program-level plugins apply as outermost wrappers; subcommand plugins compose as inner layers. Parse phase runs root plugins only. Supports explicit ordering via `order` parameter, shared mutable `state` across phases, sync preservation, and short-circuiting.
