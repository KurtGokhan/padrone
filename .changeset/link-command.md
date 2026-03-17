---
"padrone": minor
---

Add `padrone link` and `padrone unlink` CLI commands for linking programs during development. Creates shell shims in `~/.padrone/bin/` that invoke the entry file with the detected runtime. Auto-detects entry from `package.json` bin field and runtime from lockfiles. Use `--setup` to automatically add `~/.padrone/bin` to PATH in shell config. Shell utilities (`detectShell`, `getRcFile`, `writeToRcFile`) extracted to `shell-utils.ts` for reuse.
