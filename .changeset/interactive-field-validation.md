---
"padrone": minor
---

Add per-field validation during interactive prompts.

When a user provides an invalid value for an interactive field, the prompt now immediately validates it against the schema and re-prompts with a warning message instead of deferring all errors until after all prompts complete. This applies to both required and optional interactive fields.
