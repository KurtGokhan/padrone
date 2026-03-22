---
"padrone": minor
---

Add progress indicator system for commands with auto-managed spinners and manual control.

**Auto-managed progress** via `.progress()` builder method:
- `true` or `string` for simple messages, or a full config object with per-state messages
- Starts before validation, auto-succeeds/fails after execution
- Validation-phase message transitions to execution-phase message
- `spinner` option: preset name (`dots`, `line`, `arc`, `bounce`), custom `{ frames, interval }`, or `false` to disable animation
- `success`/`error` fields accept static strings, `null` to suppress, callbacks `(result) => string | null`, or `{ message, indicator }` objects for per-call icon customization

**Manual progress** via `ctx.progress` in action handlers:
- Works even without `.progress()` config — lazily creates a real indicator on first use
- Auto-stopped when execution finishes (no leaked spinners)
- No-op when the runtime has no progress factory

**Built-in terminal spinner** (`createTerminalSpinner`):
- ANSI-based spinner with pause/resume for clean output interleaving
- Customizable success/error indicator icons via `PadroneProgressOptions`
- Empty string indicators hide the icon prefix entirely
- Graceful fallback in non-TTY/CI environments

**New types**: `PadroneProgressIndicator`, `PadroneProgressConfig`, `PadroneProgressMessage`, `PadroneProgressOptions`, `PadroneSpinnerConfig`, `PadroneSpinnerPreset`
