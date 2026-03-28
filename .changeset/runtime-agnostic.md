---
'padrone': minor
---

Improve runtime agnosticism. Add `terminal` and `exit` fields to `PadroneRuntime`. Replace `Buffer` usage with `Uint8Array`/`TextEncoder`. Route scattered `process.*` reads through runtime abstraction. Replace all `require()` calls with dynamic `import()`. Use `runtime.onSignal` in serve/MCP instead of direct `process.on`.
