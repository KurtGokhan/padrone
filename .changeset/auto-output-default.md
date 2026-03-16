---
"padrone": minor
---

auto-output is now enabled by default: command return values are automatically written to output in eval, cli, and repl modes. The runtime `output` function now accepts `unknown` values instead of only strings, letting runtimes handle formatting natively. Use `autoOutput: false` in preferences or `configure({ autoOutput: false })` on individual commands to opt out.
