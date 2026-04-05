---
'padrone': minor
---

Auto-merge interceptor context in `next()`. Passing `next({ context: { user } })` now shallow-merges into existing context instead of replacing it. Default `TContext` changed from `unknown` to `object` so `ctx.context` is spreadable without type assertions.
