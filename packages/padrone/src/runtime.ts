import type { HelpFormat } from './formatter.ts';
import { findConfigFile, loadConfigFile } from './utils.ts';

/**
 * A progress indicator instance (spinner, progress bar, etc).
 * Created by the runtime's `progress` factory and used to show loading state during command execution.
 */
export type PadroneProgressIndicator = {
  /** Update the displayed message. */
  update: (message: string) => void;
  /** Mark as succeeded and stop. */
  succeed: (message?: string) => void;
  /** Mark as failed and stop. */
  fail: (message?: string) => void;
  /** Stop without success/fail status. */
  stop: () => void;
  /** Temporarily hide the indicator so other output can be written cleanly. */
  pause: () => void;
  /** Redraw the indicator after a `pause()`. */
  resume: () => void;
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
  progress?: (message: string) => PadroneProgressIndicator;
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
};

/**
 * Internal resolved runtime where all fields are guaranteed to be present.
 * The `prompt`, `interactive`, and `readLine` fields remain optional since not all runtimes provide them.
 */
export type ResolvedPadroneRuntime = Required<Omit<PadroneRuntime, 'prompt' | 'interactive' | 'readLine' | 'stdin' | 'progress'>> &
  Pick<PadroneRuntime, 'prompt' | 'interactive' | 'readLine' | 'stdin' | 'progress'>;

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
/**
 * Sentinel value returned by the terminal REPL session when Ctrl+C is pressed.
 * Distinguished from empty string (user pressed enter) and null (EOF/Ctrl+D).
 */
export const REPL_SIGINT = Symbol('REPL_SIGINT');

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
    async question(prompt: string): Promise<string | typeof REPL_SIGINT | null> {
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
        let resolved = false;
        const settle = (value: string | typeof REPL_SIGINT | null) => {
          if (resolved) return;
          resolved = true;
          rl.close();
          resolve(value);
        };

        rl.question(prompt, (answer) => {
          // Grab updated history (includes the new entry) before closing.
          if (Array.isArray((rl as any).history)) history = [...(rl as any).history];
          settle(answer);
        });
        // Ctrl+C: cancel current line, print newline, resolve SIGINT sentinel.
        rl.once('SIGINT', () => {
          process.stdout.write('\n');
          settle(REPL_SIGINT);
        });
        // EOF (Ctrl+D) fires close without the question callback.
        rl.once('close', () => {
          // Write newline so zsh doesn't show '%' (partial-line indicator).
          process.stdout.write('\n');
          settle(null);
        });
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
/**
 * Creates a default stdin reader from `process.stdin`.
 * Only created when a command actually declares a `stdin` meta field.
 */
function createDefaultStdin(): NonNullable<PadroneRuntime['stdin']> {
  return {
    get isTTY() {
      // process.stdin.isTTY is `true` when interactive terminal, `undefined` when piped/redirected.
      // Node.js never sets it to `false` — it's either `true` or absent.
      if (typeof process === 'undefined') return true;
      return process.stdin?.isTTY === true;
    },
    async text() {
      if (typeof process === 'undefined') return '';
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks).toString('utf-8');
    },
    async *lines() {
      if (typeof process === 'undefined') return;
      const { createInterface } = await import('node:readline');
      const rl = createInterface({ input: process.stdin });
      try {
        for await (const line of rl) {
          yield line;
        }
      } finally {
        rl.close();
      }
    },
  };
}

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Creates a built-in terminal spinner. Returns a no-op indicator in non-TTY/CI environments.
 */
function createTerminalSpinner(message: string): PadroneProgressIndicator {
  if (typeof process === 'undefined' || !process.stderr?.isTTY) {
    // Non-TTY: just log start/end, no animation
    return {
      update() {},
      succeed(msg) {
        if (msg) process?.stderr?.write?.(`✔ ${msg}\n`);
      },
      fail(msg) {
        if (msg) process?.stderr?.write?.(`✖ ${msg}\n`);
      },
      stop() {},
      pause() {},
      resume() {},
    };
  }

  let frame = 0;
  let text = message;
  let stopped = false;
  let paused = false;

  const writeStderr = process.stderr.write.bind(process.stderr);
  const writeStdout = process.stdout.write.bind(process.stdout);
  const clearLine = () => writeStderr('\x1b[2K\r');
  const render = () => {
    if (paused || stopped) return;
    writeStderr(`\x1b[2K\r${spinnerFrames[frame]!} ${text}`);
  };

  const timer = setInterval(() => {
    frame = (frame + 1) % spinnerFrames.length;
    render();
  }, 80);

  render();

  const clear = () => {
    if (stopped) return;
    stopped = true;
    paused = false;
    clearInterval(timer);
    clearLine();
  };

  return {
    update(msg) {
      if (stopped) return;
      text = msg;
      render();
    },
    succeed(msg) {
      clear();
      writeStderr(`✔ ${msg || text}\n`);
    },
    fail(msg) {
      clear();
      writeStderr(`✖ ${msg || text}\n`);
    },
    stop() {
      clear();
    },
    pause() {
      if (stopped || paused) return;
      paused = true;
      // Clear on both streams — stderr (where the spinner rendered) and
      // stdout (where console.log writes) to avoid buffering race conditions.
      clearLine();
      writeStdout('\x1b[2K\r');
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      render();
    },
  };
}

export function createDefaultRuntime(): ResolvedPadroneRuntime {
  return {
    output: (...args) => console.log(...args),
    error: (text) => console.error(text),
    argv: () => (typeof process !== 'undefined' ? process.argv.slice(2) : []),
    env: () => (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {}),
    format: 'auto',
    loadConfigFile,
    findFile: findConfigFile,
    prompt: defaultTerminalPrompt,
    interactive: detectInteractiveMode(),
    progress: createTerminalSpinner,
  };
}

/**
 * Merges a partial runtime with the default runtime.
 */
/**
 * Returns the stdin abstraction: custom runtime stdin > default process.stdin.
 * Returns `undefined` when no custom stdin is provided and process.stdin is not piped.
 */
export function resolveStdin(partial?: PadroneRuntime): NonNullable<PadroneRuntime['stdin']> | undefined {
  if (partial?.stdin) return partial.stdin;
  const defaultStdin = createDefaultStdin();
  // Only use default stdin if it's actually piped (isTTY === false).
  // This avoids accidentally blocking on stdin in tests/CI.
  if (defaultStdin.isTTY) return undefined;
  return defaultStdin;
}

export function resolveRuntime(partial?: PadroneRuntime): ResolvedPadroneRuntime {
  const defaults = createDefaultRuntime();
  if (!partial) return defaults;
  return {
    output: partial.output ?? defaults.output,
    error: partial.error ?? defaults.error,
    argv: partial.argv ?? defaults.argv,
    env: partial.env ?? defaults.env,
    format: partial.format ?? defaults.format,
    loadConfigFile: partial.loadConfigFile ?? defaults.loadConfigFile,
    findFile: partial.findFile ?? defaults.findFile,
    interactive: partial.interactive ?? defaults.interactive,
    prompt: partial.prompt ?? defaults.prompt,
    readLine: partial.readLine ?? defaults.readLine,
    progress: partial.progress ?? defaults.progress,
    stdin: partial.stdin,
  };
}
