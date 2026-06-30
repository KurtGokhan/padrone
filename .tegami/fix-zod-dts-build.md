---
packages:
  padrone: patch
---

## Fix build failure when generating type declarations for the `padrone/zod` entry

The `padrone/zod` entry used a named re-export which tripped a `rolldown-plugin-dts` chunk-merge bug during the multi-entry build, breaking `npm publish`. Switched to a wildcard re-export so declaration generation succeeds.
