---
"padrone": minor
---

Add runtime adapter for I/O abstraction, enabling CLI framework usage outside of terminals (web UIs, chat interfaces, testing). New `.runtime()` builder method configures output, error, argv, env, format, config file loading, and file discovery. All fields are optional with Node.js/Bun defaults. Successive `.runtime()` calls merge with previous configuration.
