---
"padrone": minor
---

Add REPL mode. `program.repl()` starts an interactive Read-Eval-Print Loop that returns an `AsyncIterable<PadroneCommandResult>`, yielding a result for each successfully executed command. Errors are caught and printed without crashing the session. Built-in REPL commands (`exit`, `quit`, `clear`) are provided but yield to user-defined commands of the same name. The runtime gains a new `readLine` field for abstracting line input, with a default Node.js/Bun `readline` implementation.
