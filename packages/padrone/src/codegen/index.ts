// Types

// Core utilities
export { createCodeBuilder } from './code-builder.ts';
export { createFileEmitter } from './file-emitter.ts';
// Generators
export { generateBarrelFile } from './generators/barrel-file.ts';
export { generateCommandFile } from './generators/command-file.ts';
export { generateCommandTree } from './generators/command-tree.ts';
// Parsers
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
