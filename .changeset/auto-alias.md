---
"padrone": minor
---

Auto-generate kebab-case aliases for camelCase option names

Options like `dryRun` automatically accept `--dry-run` on the CLI. This is enabled by default and can be disabled per-command with `autoAlias: false`. Auto-aliases are shown as the primary name in help text when available.

```ts
// --dry-run automatically resolves to dryRun
.arguments(z.object({ dryRun: z.boolean() }))

// Disable auto-aliases
.arguments(z.object({ dryRun: z.boolean() }), { autoAlias: false })
```
