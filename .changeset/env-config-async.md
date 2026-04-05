---
'padrone': minor
---

Mark `padroneEnv` and `padroneConfig` as async at the type level. Extensions now return `WithAsync<T>` so `eval()` and `cli()` correctly return `Promise` when used.
