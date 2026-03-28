---
'padrone': minor
---

Add typed context injection for interceptors. Interceptors can declare provided context via `.provides<T>()` and required context via `.requires<T>()` on `defineInterceptor()`. Action handlers see the full merged context type. `.intercept()` rejects interceptors whose required context is not satisfied at compile time.
