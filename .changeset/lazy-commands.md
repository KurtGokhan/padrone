---
'padrone': minor
---

Lazily initialize commands defined with callbacks. Builder functions passed to `.command()` are now deferred until the command is routed to, avoiding upfront construction of unused commands. Features that need the full command tree (help, MCP, serve, docs, completion, REPL) resolve all commands eagerly. Added `getCommand()` and `isPadroneProgram()` helpers to replace direct `commandSymbol` usage.
