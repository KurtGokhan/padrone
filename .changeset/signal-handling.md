---
'padrone': minor
---

Add signal handling support for graceful shutdown. Actions and plugins receive an `AbortSignal` via `ctx.signal` that aborts on SIGINT/SIGTERM/SIGHUP. Command results include `signal` and `exitCode` fields when interrupted. Double Ctrl+C within 2 seconds force-quits. Export new `SignalError` class and `PadroneSignal` type.
