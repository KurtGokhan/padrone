---
'padrone': minor
---

Add elapsed time (`time: true`) and ETA (`eta: true`) to progress indicators. ETA is calculated from numeric progress updates and counts down between updates. Move progress messages into a `message` field (string or `{ validation, progress, success, error }` object) with runtime-level defaults via context.
