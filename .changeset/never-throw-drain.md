---
"padrone": minor
---

**BREAKING:** `eval()`, `cli()`, and `run()` no longer throw errors. Instead, they return a discriminated union with an `error` field:

- Success: `{ command, args, argsResult, result, drain() }`
- Error: `{ error, command?, args?, argsResult?, drain() }`

Added `drain()` method to all command results. It flattens the result into a single `Promise<{ value } | { error }>` that never throws — resolving Promises, collecting iterables into arrays, and catching errors:

```ts
const { value, error } = await program.cli().drain();
```

New exported types: `PadroneDrainResult<T>`, `Drained<T>`.
