---
"padrone": minor
---

Add `padrone/test` entry point with testing utilities. The `testCli(program)` function provides a fluent builder for setting up CLI test scenarios with mock I/O capture. Supports mocking environment variables (`.env()`), interactive prompt answers (`.prompt()`), config files (`.config()`), and REPL sessions (`.repl()`). Works with any test framework.
