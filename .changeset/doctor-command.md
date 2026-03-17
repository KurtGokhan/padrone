---
"padrone": minor
---

Add `padrone doctor <entry>` CLI command that lints and validates a Padrone program definition. Catches duplicate aliases, shadowed option/command names (help, version), commands without actions, schemas without descriptions, conflicting positional configs, and unused plugins.
