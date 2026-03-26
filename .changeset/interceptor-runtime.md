---
'padrone': patch
---

Add `runtime` to interceptor contexts. Interceptors can now access and override the runtime via `ctx.runtime` instead of calling `getCommandRuntime()`. Support `next()` overrides for passing modified context to downstream interceptors.
