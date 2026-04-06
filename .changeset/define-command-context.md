---
'padrone': minor
---

Add `DefineCommandContext` interface and `defineCommand().requires()` for typed interceptor context in modular commands. Commands defined with `defineCommand()` now have optional `logger`, `tracing`, and `progress` context by default. Use `defineCommand().requires<T>().define(fn)` for additional context requirements with compile-time validation at `.command()` registration.
