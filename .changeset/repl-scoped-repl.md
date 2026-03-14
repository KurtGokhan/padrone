---
"padrone": minor
---

Add scoped/contextual REPLs and `--repl` CLI flag. `cd <subcommand>` scopes the REPL session to a command subtree, `cd ..`/`..` goes back up. The prompt updates to reflect scope (e.g. `myapp/db ❯`). `options.scope` allows starting pre-scoped. The `--repl` flag in `cli()` starts a REPL (optionally scoped to a command). Ctrl+C now cancels the current line instead of killing the process. Default prompt uses `❯` instead of `>`. `exit` and `quit` built-ins are now tracked independently. `scope` is strongly typed to valid command paths.
