---
"padrone": minor
---

Add `padrone/docs` entry point with a `generateDocs()` utility that walks the command tree and generates structured documentation in four formats: markdown (with index page, frontmatter support for VitePress/Starlight), HTML (semantic with CSS classes), man pages (groff-formatted), and JSON. Each page includes command name, description, usage syntax, options with types/defaults/choices/aliases/env vars/config keys/examples, positional arguments, and subcommands table. Also add `padrone docs` CLI command that imports a Padrone program from any entry file and generates documentation to an output directory.
