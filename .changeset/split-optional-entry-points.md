---
'padrone': major
---

Optional integrations are now exported from dedicated subpath entry points so bundlers that don't tree-shake re-exports keep their dependencies out of the main bundle. Update imports as follows:

- `padroneInk`, `isReactElement`, `InkOptions` → `'padrone/ink'`
- `padroneMcp`, `WithMcp`, `PadroneMcpPreferences` → `'padrone/mcp'`
- `padroneServe`, `WithServe` → `'padrone/serve'`
- `padroneTracing`, `WithTracing`, `PadroneTracer`, `PadroneTracingConfig`, `OtelSpan`, `OtelTracer`, `OtelTracerProvider` → `'padrone/tracing'`
- `padroneCompletion`, `WithCompletion` → `'padrone/completion'`
- `padroneMan`, `WithMan` → `'padrone/man'`
