---
"padrone": minor
---

Add scoped/contextual REPLs, `--repl` CLI flag, and dot-prefixed built-in commands. All REPL built-ins now use dot-prefix notation (`.exit`, `.quit`, `.clear`, `.scope`, `.help`, `.history`) to avoid collisions with user commands. `.scope <subcommand>` scopes the REPL session to a command subtree, `.scope ..`/`..` goes back up, `.` executes the current scoped command. `.help` shows REPL-specific commands and keybindings. `.history` shows session command history. Default greeting displays program name and version; configurable `hint` text shown below. Double Ctrl+C to exit (first press shows hint). The prompt updates to reflect scope (e.g. `myapp/db ❯`). `options.scope` allows starting pre-scoped and is strongly typed to valid command paths. The `--repl` flag in `cli()` starts a REPL (optionally scoped to a command).
