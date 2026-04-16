---
'padrone': minor
---

Auto-coerce CLI string values for union types (e.g. `z.union([z.boolean(), z.string()])`) — `--flag true` now correctly passes boolean `true` instead of the string `"true"`
