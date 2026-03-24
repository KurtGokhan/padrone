---
"padrone": patch
---

Collect repeated non-array options into an array for the validator. Enables schemas like `z.union([z.string(), z.array(z.string())])` to receive all values when an option is passed multiple times.
