---
"padrone": minor
---

Add interactive field prompting. Commands can now declare `interactive` and `optionalInteractive` in the arguments meta to prompt users for missing field values during `cli()`. Interactive prompts are auto-detected from the schema (boolean → confirm, enum → select, array enum → multiselect). The runtime controls whether interactivity is enabled via `runtime({ interactive: true })`, with a built-in Enquirer-powered terminal prompt as the default. Custom prompt implementations can be provided for non-terminal runtimes.
