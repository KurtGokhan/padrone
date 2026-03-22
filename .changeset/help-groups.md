---
"padrone": minor
---

Add `group` configuration to options and commands for organized help output.

Options can be grouped via `fields: { myField: { group: 'Group Name' } }` in argument metadata. Commands can be grouped via `configure({ group: 'Group Name' })`. Grouped items are rendered under labeled `${group}:` sections in help output, while ungrouped items remain under the default `Options:` / `Commands:` headers.
