import type { HelpFormat } from './formatter.ts';
import { findConfigFile, loadConfigFile } from './utils.ts';

/**
 * Controls interactive prompting capability and default behavior at the runtime level.
 * - `'supported'` — capable; caller decides.
 * - `'unsupported'` — hard veto; nothing can override.
 * - `'forced'` — capable and forces prompts by default.
 * - `'disabled'` — capable but suppresses prompts by default.
 */
export type InteractiveMode = 'supported' | 'unsupported' | 'forced' | 'disabled';

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
   * Controls interactive prompting capability and default behavior.
   * - `'supported'` — runtime can handle prompts; caller (flag/pref) decides whether to prompt. This is the default when `prompt` is provided.
   * - `'unsupported'` — runtime cannot handle prompts; hard veto that nothing can override.
   * - `'forced'` — runtime supports prompts and forces them by default (prompts even for provided values).
   * - `'disabled'` — runtime supports prompts but suppresses them by default.
   *
   * `'unsupported'` is the only immutable state. For the others, the `--interactive`/`-i` flag
   * and `cli()` preferences can override the default behavior.
   */
  interactive?: InteractiveMode;
  /**
   * Prompt the user for input. Called during `cli()` for fields marked as interactive.
   * When `interactive` is `true` and this is not provided, defaults to an Enquirer-based terminal prompt.
   */
  prompt?: (config: InteractivePromptConfig) => Promise<unknown>;
  /**
   * Read a line of input from the user. Used by `repl()` for custom runtimes
   * (web UIs, chat interfaces, testing).
   * Returns the input string, or `null` on EOF (e.g. Ctrl+D, closed connection).
   *
   * When not provided, `repl()` uses a built-in Node.js readline session
   * with command history (up/down arrows) and tab completion.
   */
  readLine?: (prompt: string) => Promise<string | null>;
};

/**
 * Internal resolved runtime where all fields are guaranteed to be present.
 * The `prompt`, `interactive`, and `readLine` fields remain optional since not all runtimes provide them.
 */
export type ResolvedPadroneRuntime = Required<Omit<PadroneRuntime, 'prompt' | 'interactive' | 'readLine'>> &
  Pick<PadroneRuntime, 'prompt' | 'interactive' | 'readLine'>;

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
 * Internal session config for the REPL's persistent readline interface.
 */
export type ReplSessionConfig = {
  completer?: (line: string) => [string[], string];
  history?: string[];
};

/**
 * Creates a persistent Node.js readline session for the REPL.
 * Enables up/down arrow history navigation and tab completion.
 * Used internally by `repl()` when no custom `readLine` is provided.
 */
export function createTerminalReplSession(config: ReplSessionConfig) {
  // History accumulates across per-call interfaces, giving us
  // up/down arrow navigation without a persistent stdin listener
  // that would conflict with Enquirer or other stdin consumers.
  let history: string[] = config.history ? [...config.history] : [];
  let currentCompleter = config.completer;

  return {
    /** Update the tab completer (e.g. when REPL scope changes). Takes effect on the next question. */
    set completer(fn: ((line: string) => [string[], string]) | undefined) {
      currentCompleter = fn;
    },
    async question(prompt: string): Promise<string | null> {
      const { createInterface } = await import('node:readline');
      const opts: Record<string, unknown> = {
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        history: [...history],
        historySize: Math.max(history.length, 1000),
      };
      if (currentCompleter) {
        opts.completer = currentCompleter;
      }
      const rl = createInterface(opts as any);

      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          // Grab updated history (includes the new entry) before closing.
          if (Array.isArray((rl as any).history)) history = [...(rl as any).history];
          resolve(answer);
          rl.close();
        });
        // Ctrl+C: cancel current line, print newline, resolve empty (shows new prompt).
        rl.once('SIGINT', () => {
          // Write newline so the terminal doesn't show '%' (zsh partial-line indicator).
          process.stdout.write('\n');
          rl.close();
          resolve('');
        });
        // EOF (Ctrl+D) fires close without the question callback.
        rl.once('close', () => resolve(null));
      });
    },
    close() {
      // No persistent interface to clean up.
    },
  };
}

/**
 * Auto-detect interactive mode when not explicitly set.
 * Returns 'disabled' in CI environments or non-TTY contexts, 'supported' otherwise.
 */
function detectInteractiveMode(): InteractiveMode {
  if (typeof process === 'undefined') return 'disabled';
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) return 'disabled';
  if (!process.stdout?.isTTY) return 'disabled';
  return 'supported';
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
  };
}

/**
 * Merges a partial runtime with the default runtime.
 */
export function resolveRuntime(partial?: PadroneRuntime): ResolvedPadroneRuntime {
  if (!partial) return createDefaultRuntime();
  const defaults = createDefaultRuntime();
  const interactive = partial.interactive ?? detectInteractiveMode();
  return {
    output: partial.output ?? defaults.output,
    error: partial.error ?? defaults.error,
    argv: partial.argv ?? defaults.argv,
    env: partial.env ?? defaults.env,
    format: partial.format ?? defaults.format,
    loadConfigFile: partial.loadConfigFile ?? defaults.loadConfigFile,
    findFile: partial.findFile ?? defaults.findFile,
    interactive,
    prompt: partial.prompt ?? defaultTerminalPrompt,
    readLine: partial.readLine,
  };
}
