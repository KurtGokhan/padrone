---
"padrone": minor
---

Add command override/extension support. Re-registering a command with the same name now merges instead of duplicating: configuration is shallow-merged, the previous handler is passed as a `base` parameter to `.action()`, arguments can be overridden, and subcommands are recursively merged by name. Aliases are preserved from the original when the override doesn't specify new ones. All fully strongly typed.

Also fixes: REPL `.` command now works at any scope (including root) to execute the current command, `.help` always shows `.` and `.scope` entries, `cli()` and `repl()` return types now include all possible command results, and nested commands with default `''` subcommands route correctly.
