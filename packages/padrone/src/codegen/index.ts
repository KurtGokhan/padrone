// Types

// Core utilities
export { createCodeBuilder } from './code-builder.ts';
export type { DiscoveryOptions, DiscoveryResult, DiscoverySource } from './discovery.ts';
// Discovery
export { detectCompletionShell, discoverCli } from './discovery.ts';
export { createFileEmitter } from './file-emitter.ts';
// Generators
export { generateBarrelFile } from './generators/barrel-file.ts';
export type { CommandFileOptions } from './generators/command-file.ts';
export { generateCommandFile } from './generators/command-file.ts';
export type { CommandTreeOptions } from './generators/command-tree.ts';
export { generateCommandTree } from './generators/command-tree.ts';
// Parsers
export { parseBashCompletions } from './parsers/bash.ts';
export { parseFishCompletions } from './parsers/fish.ts';
export { parseHelpOutput } from './parsers/help.ts';
export { mergeCommandMeta } from './parsers/merge.ts';
export { parseZshCompletions } from './parsers/zsh.ts';
export { fieldMetaToCode, schemaToCode } from './schema-to-code.ts';
export { template } from './template.ts';
export type {
  CodeBuilder,
  CodeBuildResult,
  CommandMeta,
  EmitResult,
  FieldMeta,
  FileEmitter,
  FileEmitterOptions,
  GeneratorContext,
  GeneratorLogger,
  TemplateFunction,
} from './types.ts';
