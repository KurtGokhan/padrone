---
'padrone': minor
---

Add `asyncStream` for streaming stdin as `AsyncIterable`. New `padrone/zod` entrypoint exports `zodAsyncStream` and `jsonCodec` for typed streams with per-item validation. Extract shared `JSON_SCHEMA_OPTS` constant across all `jsonSchema.input()` calls.
