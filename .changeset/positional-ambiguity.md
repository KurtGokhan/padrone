---
'padrone': patch
---

Detect ambiguous positional arguments provided both positionally and as named options. For example, `cmd val --pos1=val` with `positional: ['pos1', 'pos2']` now reports a validation error instead of silently overwriting.
