---
'padrone': minor
---

Add extension system with `.extend()` for build-time composition. Rename plugins to interceptors (`.use()` → `.intercept()`, `PadronePlugin` → `PadroneInterceptor`). Move built-in commands (help, version, completion, man) to opt-in `padroneBuiltins()` extension that registers them as real typed commands. Add `WithPadroneBuiltins` type helper for strong typing of augmented programs.
