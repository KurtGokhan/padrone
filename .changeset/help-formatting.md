---
"padrone": minor
---

Improve help output formatting

- Use bracket convention for option types: `<type>` for required, `[type]` for optional, nothing for booleans
- Show kebab-case alias as primary name when available (e.g. `--dry-run` instead of `--dryRun`)
- Move choices and default values after the description
- Show array item types (e.g. `[string[]]` instead of `[array] (repeatable)`)
- Hide empty default values (empty strings and arrays)
- Cap description alignment at 32 characters
- Show `(stdin)` marker on arguments that accept stdin input
- Show `--no-` negation hint only when relevant (boolean options defaulting to true)
- Remove `[no-]` prefix from individual boolean options
