---
'padrone': minor
---

Add REST server (`program.serve()`) and `mutation` command config.

- New `serve()` program method: exposes commands as HTTP endpoints with automatic OpenAPI docs (Scalar).
- New `serve` built-in CLI command: `myapp serve --port 3000`.
- Built-in endpoints: `/_health`, `/_help`, `/_schema`, `/_docs` (Scalar), `/_openapi`.
- New `mutation` option in `.configure()`: mutation commands are POST-only in serve, set `destructiveHint` in MCP, and default `needsApproval` to true in `tool()`.
- MCP: rename `endpoint` to `basePath` for consistency with serve.
- Shared utilities extracted from MCP (`collectEndpoints`, `buildInputSchema`, `serializeArgsToFlags`).
