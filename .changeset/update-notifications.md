---
"padrone": minor
---

Add built-in opt-in update checking via `.updateCheck()`. When enabled, the program checks the npm registry (or a custom URL) for newer versions in the background and displays a notification after command output. Checks are cached to avoid hitting the registry on every invocation. Respects CI environments, non-TTY contexts, `--no-update-check` flag, and a configurable env var to disable.
