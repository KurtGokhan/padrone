---
'padrone': minor
---

Add extension system with `.extend()` for build-time composition. Rename plugins to interceptors (`.use()` → `.intercept()`, `PadronePlugin` → `PadroneInterceptor`). Move built-in commands to composable extensions. Default builtins (help, version, repl, color, config, interactive) are applied automatically via `createPadrone()`. Advanced features (completion, man, mcp, serve, update-check) are opt-in extensions. Individual builtins can be disabled via `createPadrone('name', { builtins: { help: false } })`.
