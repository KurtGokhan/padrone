import type { HelpFormat } from './formatter.ts';
import { findConfigFile, loadConfigFile } from './utils.ts';

/**
 * Defines the execution context for a Padrone program.
 * Abstracts all environment-dependent I/O so the CLI framework
 * can run outside of a terminal (e.g., web UIs, chat interfaces, testing).
 *
 * All fields are optional — unspecified fields fall back to the Node.js/Bun defaults.
 */
export type PadroneRuntime = {
  /** Write normal output (replaces console.log). */
  output?: (text: string) => void;
  /** Write error output (replaces console.error). */
  error?: (text: string) => void;
  /** Return the raw CLI arguments (replaces process.argv.slice(2)). */
  argv?: () => string[];
  /** Return environment variables (replaces process.env). */
  env?: () => Record<string, string | undefined>;
  /** Default help output format. */
  format?: HelpFormat | 'auto';
  /** Load and parse a config file by path. Return undefined if not found or unparsable. */
  loadConfigFile?: (path: string) => Record<string, unknown> | undefined;
  /** Find the first existing file from a list of candidate names. */
  findFile?: (names: string[]) => string | undefined;
};

/**
 * Internal resolved runtime where all fields are guaranteed to be present.
 */
export type ResolvedPadroneRuntime = Required<PadroneRuntime>;

/**
 * Creates the default Node.js/Bun runtime.
 */
export function createDefaultRuntime(): ResolvedPadroneRuntime {
  return {
    output: (text) => console.log(text),
    error: (text) => console.error(text),
    argv: () => (typeof process !== 'undefined' ? process.argv.slice(2) : []),
    env: () => (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {}),
    format: 'auto',
    loadConfigFile,
    findFile: findConfigFile,
  };
}

/**
 * Merges a partial runtime with the default runtime.
 */
export function resolveRuntime(partial?: PadroneRuntime): ResolvedPadroneRuntime {
  if (!partial) return createDefaultRuntime();
  const defaults = createDefaultRuntime();
  return {
    output: partial.output ?? defaults.output,
    error: partial.error ?? defaults.error,
    argv: partial.argv ?? defaults.argv,
    env: partial.env ?? defaults.env,
    format: partial.format ?? defaults.format,
    loadConfigFile: partial.loadConfigFile ?? defaults.loadConfigFile,
    findFile: partial.findFile ?? defaults.findFile,
  };
}
