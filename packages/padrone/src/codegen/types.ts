/**
 * Metadata for a single field/option/flag parsed from CLI help or completion data.
 */
export interface FieldMeta {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'enum' | 'unknown';
  /** For arrays: the item type */
  items?: string;
  /** For enums: the allowed values */
  enumValues?: string[];
  description?: string;
  default?: unknown;
  required?: boolean;
  aliases?: string[];
  positional?: boolean;
  /** Mark fields the parser wasn't confident about */
  ambiguous?: boolean;
}

/**
 * Intermediate representation for a CLI command.
 * All parsers produce these, all generators consume them.
 */
export interface CommandMeta {
  name: string;
  description?: string;
  aliases?: string[];
  /** Named options/flags */
  arguments?: FieldMeta[];
  /** Positional arguments */
  positionals?: FieldMeta[];
  /** Recursive subcommands */
  subcommands?: CommandMeta[];
  examples?: string[];
  deprecated?: boolean | string;
}

/**
 * Logger interface for generators to report progress.
 */
export interface GeneratorLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
}

/**
 * Shared context passed to all generators.
 */
export interface GeneratorContext {
  /** Target output directory */
  outDir: string;
  /** Code builder factory */
  createCodeBuilder: () => CodeBuilder;
  /** File emitter for writing output */
  emitter: FileEmitter;
  /** Template engine */
  template: TemplateFunction;
  /** User-facing logger */
  log: GeneratorLogger;
}

/**
 * Result from CodeBuilder.build()
 */
export interface CodeBuildResult {
  /** The formatted source string */
  text: string;
  /** Resolved import map for deduplication across files */
  imports: Map<string, { specifiers: Set<string>; typeOnly: boolean }>;
}

/**
 * Fluent builder for constructing TypeScript source files.
 */
export interface CodeBuilder {
  /** Add a named import: import { specifier } from source */
  import(specifier: string | string[], source: string): CodeBuilder;
  /** Add a default import: import name from source */
  importDefault(name: string, source: string): CodeBuilder;
  /** Add a type-only import: import type { specifier } from source */
  importType(specifier: string | string[], source: string): CodeBuilder;
  /** Add a line of code (empty string or no argument for blank line) */
  line(code?: string): CodeBuilder;
  /** Add a nested block with automatic indentation */
  block(builder: (b: CodeBuilder) => CodeBuilder): CodeBuilder;
  /** Add a nested block with open/close strings */
  block(open: string, builder: (b: CodeBuilder) => CodeBuilder, close?: string): CodeBuilder;
  /** Add a nested block with open string, close string override, and builder */
  block(open: string, close: string, builder: (b: CodeBuilder) => CodeBuilder): CodeBuilder;
  /** Add a single-line comment */
  comment(text: string): CodeBuilder;
  /** Add a JSDoc comment */
  docComment(text: string): CodeBuilder;
  /** Add a TODO comment */
  todoComment(text: string): CodeBuilder;
  /** Add raw pre-formatted code (no indentation adjustment) */
  raw(code: string): CodeBuilder;
  /** Build the final source string */
  build(): CodeBuildResult;
}

/**
 * Result from FileEmitter.emit()
 */
export interface EmitResult {
  /** Files that were written */
  written: string[];
  /** Files that were skipped (already exist, no overwrite) */
  skipped: string[];
  /** Files that failed to write */
  errors: { file: string; error: Error }[];
}

/**
 * Options for creating a FileEmitter.
 */
export interface FileEmitterOptions {
  /** Target output directory */
  outDir: string;
  /** Header comment prepended to every file */
  header?: string;
  /** How to handle existing files: true = overwrite, false = skip */
  overwrite?: boolean;
  /** Print what would be written without writing */
  dryRun?: boolean;
}

/**
 * Manages writing multiple generated files to disk.
 */
export interface FileEmitter {
  /** Queue a file for writing */
  addFile(path: string, content: string | CodeBuildResult): void;
  /** Write all queued files to disk */
  emit(): Promise<EmitResult>;
}

/**
 * Template function returned by template().
 */
export type TemplateFunction = (text: string) => (data: Record<string, unknown>) => string;
