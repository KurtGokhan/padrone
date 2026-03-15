---
"padrone": minor
---

Add `.mount(name, program)` method for composing Padrone programs together. Mounts an existing program as a subcommand, recursively re-pathing all nested commands and preserving arguments, handlers, plugins, and schemas. Supports aliases via array syntax. Mounted program's root-level `version` is dropped. Type-level paths are recursively updated for correct inference with `eval()`, `find()`, `run()`, etc.
