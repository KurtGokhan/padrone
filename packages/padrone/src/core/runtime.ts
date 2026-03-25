import type { ColorConfig, ColorTheme } from '../output/colorizer.ts';
import type { HelpFormat } from '../output/formatter.ts';

/** Process signals that Padrone can handle for graceful shutdown. */
export type PadroneSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

/**
 * A progress indicator instance (spinner, progress bar, etc).
 * Created by the runtime's `progress` factory and used to show loading state during command execution.
 */
export type PadroneProgressIndicator = {
  /** Update the displayed message. */
  update: (message: string) => void;
  /** Mark as succeeded and stop. Pass `null` to stop without rendering a final message. */
  succeed: (message?: string | null, options?: { indicator?: string }) => void;
  /** Mark as failed and stop. Pass `null` to stop without rendering a final message. */
  fail: (message?: string | null, options?: { indicator?: string }) => void;
  /** Stop without success/fail status. */
  stop: () => void;
  /** Temporarily hide the indicator so other output can be written cleanly. */
  pause: () => void;
  /** Redraw the indicator after a `pause()`. */
  resume: () => void;
};

/** Built-in spinner presets. */
export type PadroneSpinnerPreset = 'dots' | 'line' | 'arc' | 'bounce';

/**
 * Spinner configuration for progress indicators.
 * - A preset name (e.g., `'dots'`) to use built-in frames.
 * - An object with custom `frames` and/or `interval`.
 * - `false` to disable the spinner animation (static text only).
 */
export type PadroneSpinnerConfig = PadroneSpinnerPreset | { frames?: string[]; interval?: number } | false;

/**
 * Options passed to the runtime's `progress` factory.
 */
export type PadroneProgressOptions = {
  spinner?: PadroneSpinnerConfig;
  /** Character/string shown before the success message. Defaults to `'✔'`. */
  successIndicator?: string;
  /** Character/string shown before the error message. Defaults to `'✖'`. */
  errorIndicator?: string;
};

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
  /** Write normal output (replaces console.log). Receives the raw value — runtime handles formatting. */
  output?: (...args: unknown[]) => void;
  /** Write error output (replaces console.error). */
  error?: (text: string) => void;
  /** Return the raw CLI arguments (replaces process.argv.slice(2)). */
  argv?: () => string[];
  /** Return environment variables (replaces process.env). */
  env?: () => Record<string, string | undefined>;
  /** Default help output format. */
  format?: HelpFormat | 'auto';
  /** Color theme for ANSI/console help output. A theme name or partial color config. */
  theme?: ColorTheme | ColorConfig;
  /** Load and parse a config file by path. Return undefined if not found or unparsable. */
  loadConfigFile?: (path: string) => Record<string, unknown> | undefined;
  /** Find the first existing file from a list of candidate names. */
  findFile?: (names: string[]) => string | undefined;
  /**
   * Standard input abstraction. Provides methods to read piped data from stdin.
   * When not provided, defaults to reading from `process.stdin`.
   *
   * Used by commands that declare a `stdin` field in their arguments meta.
   * The framework reads stdin automatically during the validate phase and
   * injects the data into the specified argument field.
   */
  stdin?: {
    /** Whether stdin is a TTY (interactive terminal) vs a pipe/file. */
    isTTY?: boolean;
    /** Read all of stdin as a string. */
    text: () => Promise<string>;
    /** Async iterable of lines for streaming. */
    lines: () => AsyncIterable<string>;
  };
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
   * Create a progress indicator (spinner, progress bar, etc).
   * Used by commands that set `progress` in their config, or manually via `ctx.progress()` in actions.
   * When not provided, auto-progress is silently skipped and `ctx.progress()` returns a no-op indicator.
   */
  progress?: (message: string, options?: PadroneProgressOptions) => PadroneProgressIndicator;
  /**
   * Read a line of input from the user. Used by `repl()` for custom runtimes
   * (web UIs, chat interfaces, testing).
   * Returns the input string, `null` on EOF (e.g. Ctrl+D, closed connection),
   * or `REPL_SIGINT` when the user presses Ctrl+C.
   *
   * When not provided, `repl()` uses a built-in Node.js readline session
   * with command history (up/down arrows) and tab completion.
   */
  readLine?: (prompt: string) => Promise<string | typeof REPL_SIGINT | null>;

  /**
   * Register a callback for process signals. Returns an unsubscribe function.
   * The default runtime wires this to `process.on('SIGINT' | 'SIGTERM' | 'SIGHUP')`.
   * Non-Node runtimes (web UIs, tests) can map their own cancellation semantics.
   *
   * When not provided, signal handling is disabled for this runtime.
   */
  onSignal?: (callback: (signal: PadroneSignal) => void) => () => void;
};

/**
 * Internal resolved runtime where all fields are guaranteed to be present.
 * The `prompt`, `interactive`, and `readLine` fields remain optional since not all runtimes provide them.
 */
export type ResolvedPadroneRuntime = Required<
  Omit<PadroneRuntime, 'prompt' | 'interactive' | 'readLine' | 'stdin' | 'progress' | 'theme' | 'onSignal'>
> &
  Pick<PadroneRuntime, 'prompt' | 'interactive' | 'readLine' | 'stdin' | 'progress' | 'theme' | 'onSignal'>;

/**
 * Sentinel value returned by the terminal REPL session when Ctrl+C is pressed.
 * Distinguished from empty string (user pressed enter) and null (EOF/Ctrl+D).
 */
export const REPL_SIGINT = Symbol('REPL_SIGINT');

/**
 * Internal session config for the REPL's persistent readline interface.
 */
export type ReplSessionConfig = {
  completer?: (line: string) => [string[], string];
  history?: string[];
};
