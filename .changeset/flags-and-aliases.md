---
"padrone": minor
---

Split option `alias` into `flags` (single-char, stackable) and `alias` (multi-char long names)

**Breaking:** `PadroneFieldMeta.alias` for single-character shortcuts is now `flags`.

- `flags`: single-char short flags used with single dash (`-v`, `-o file`). Stackable: `-abc` = `-a -b -c`.
- `alias`: multi-char alternative long names used with double dash (`--dry-run` for `--dryRun`).

### Migration

```diff
- { fields: { verbose: { alias: 'v' } } }
+ { fields: { verbose: { flags: 'v' } } }
```

```diff
- z.string().meta({ alias: ['v'] })
+ z.string().meta({ flags: ['v'] })
```

Multi-char aliases remain as `alias`:
```ts
{ fields: { dryRun: { alias: 'dry-run' } } }
```
