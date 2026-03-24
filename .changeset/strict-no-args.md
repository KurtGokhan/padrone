---
'padrone': minor
---

Reject unknown options for commands without `.arguments()`. Previously, commands without a schema accepted all options silently. Now they infer an empty object and error on unknown options.
