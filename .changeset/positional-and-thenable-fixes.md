---
"padrone": minor
---

Fix positional arguments and make results always thenable

- Show choices and default values in help output for positional arguments
- Fix type detection for optional array enum positionals (`z.array(z.enum([...])).optional()`)
- Coerce single values to arrays when schema expects an array type
- Make `cli()`, `eval()`, and `parse()` results always thenable (supports `.then()` and `await`)
