---
"padrone": minor
---

Add stdin piping support. Commands can declare a `stdin` field in their arguments meta to read piped input and inject it into a schema field. Supports `text` mode (read all as string) and `lines` mode (read as string array). Precedence: CLI flags > stdin > env vars > config file > schema defaults. Stdin is only read when piped (not a TTY) and the target field wasn't already provided via CLI. Runtime abstraction (`PadroneRuntime.stdin`) enables custom stdin sources for testing and non-terminal environments. Test harness gains `.stdin(data)` builder method. Help output shows `[stdin > field]` in usage line.
