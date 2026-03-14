import type { HelpFormat } from './formatter.ts';
import { findConfigFile, loadConfigFile } from './utils.ts';

/**
 * Configuration passed to the runtime's `prompt` function for interactive field prompting.
 * The prompt type and choices are auto-detected from the field's JSON schema.
 */
export type InteractivePromptConfig = {
  /** The field name being prompted. */
  name: string;
  /** Human-readable message/label for the prompt, derived from the field's description or name. */
  message: string;
  /** The prompt type, auto-detected from the JSON schema. */
  type: 'input' | 'confirm' | 'select' | 'multiselect' | 'password';
  /** Available choices for select/multiselect prompts. */
  choices?: { label: string; value: unknown }[];
  /** Default value from the schema. */
  default?: unknown;
};

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
  /**
   * Whether this runtime supports interactive prompts.
   * When `true`, commands with `interactive` or `optionalInteractive` meta will prompt for missing values.
   * Defaults to `false`.
   */
  interactive?: boolean;
  /**
   * Prompt the user for input. Called during `cli()` for fields marked as interactive.
   * When `interactive` is `true` and this is not provided, defaults to an Enquirer-based terminal prompt.
   */
  prompt?: (config: InteractivePromptConfig) => Promise<unknown>;
};

/**
 * Internal resolved runtime where all fields are guaranteed to be present.
 * The `prompt` field remains optional since not all runtimes support interactive prompts.
 */
export type ResolvedPadroneRuntime = Required<Omit<PadroneRuntime, 'prompt'>> & Pick<PadroneRuntime, 'prompt'>;

/**
 * Default terminal prompt implementation powered by Enquirer.
 * Lazily imported to avoid loading Enquirer when not needed.
 */
async function defaultTerminalPrompt(config: InteractivePromptConfig): Promise<unknown> {
  const Enquirer = (await import('enquirer')).default;

  const question: Record<string, unknown> = {
    type: config.type,
    name: config.name,
    message: config.message,
  };

  if (config.default !== undefined) {
    question.initial = config.default;
  }

  if (config.choices) {
    question.choices = config.choices.map((c) => ({
      name: String(c.value),
      message: c.label,
    }));
  }

  const response = (await Enquirer.prompt(question as any)) as Record<string, unknown>;
  return response[config.name];
}

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
    interactive: false,
  };
}

/**
 * Merges a partial runtime with the default runtime.
 */
export function resolveRuntime(partial?: PadroneRuntime): ResolvedPadroneRuntime {
  if (!partial) return createDefaultRuntime();
  const defaults = createDefaultRuntime();
  const interactive = partial.interactive ?? defaults.interactive;
  return {
    output: partial.output ?? defaults.output,
    error: partial.error ?? defaults.error,
    argv: partial.argv ?? defaults.argv,
    env: partial.env ?? defaults.env,
    format: partial.format ?? defaults.format,
    loadConfigFile: partial.loadConfigFile ?? defaults.loadConfigFile,
    findFile: partial.findFile ?? defaults.findFile,
    interactive,
    prompt: partial.prompt ?? (interactive ? defaultTerminalPrompt : undefined),
  };
}
