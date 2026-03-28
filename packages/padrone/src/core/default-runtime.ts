import { readStreamAsText } from '../util/stream.ts';
import type {
  InteractiveMode,
  InteractivePromptConfig,
  PadroneProgressIndicator,
  PadroneProgressOptions,
  PadroneRuntime,
  PadroneSignal,
  PadroneSpinnerConfig,
  PadroneSpinnerPreset,
  ReplSessionConfig,
  ResolvedPadroneRuntime,
} from './runtime.ts';
import { REPL_SIGINT } from './runtime.ts';

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
      return readStreamAsText(process.stdin);
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

const spinnerPresets: Record<PadroneSpinnerPreset, string[]> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
};

function resolveSpinnerConfig(config?: PadroneSpinnerConfig): { frames: string[]; interval: number; disabled: boolean } {
  if (config === false) return { frames: [], interval: 80, disabled: true };
  if (typeof config === 'string') return { frames: spinnerPresets[config], interval: 80, disabled: false };
  if (typeof config === 'object') {
    return {
      frames: config.frames ?? spinnerPresets.dots,
      interval: config.interval ?? 80,
      disabled: false,
    };
  }
  return { frames: spinnerPresets.dots, interval: 80, disabled: false };
}

/**
 * Creates a built-in terminal spinner. Returns a no-op indicator in non-TTY/CI environments.
 */
function createTerminalSpinner(message: string, options?: PadroneProgressOptions): PadroneProgressIndicator {
  const { frames, interval, disabled: spinnerDisabled } = resolveSpinnerConfig(options?.spinner);
  const successIcon = options?.successIndicator ?? '✔';
  const errorIcon = options?.errorIndicator ?? '✖';

  const formatFinal = (icon: string, msg: string) => (icon ? `${icon} ${msg}\n` : `${msg}\n`);

  if (typeof process === 'undefined' || !process.stderr?.isTTY) {
    // Non-TTY: just log start/end, no animation
    return {
      update() {},
      succeed(msg, opts) {
        if (msg === null) return;
        const icon = opts?.indicator ?? successIcon;
        if (msg || message) process?.stderr?.write?.(formatFinal(icon, msg || message));
      },
      fail(msg, opts) {
        if (msg === null) return;
        const icon = opts?.indicator ?? errorIcon;
        if (msg || message) process?.stderr?.write?.(formatFinal(icon, msg || message));
      },
      stop() {},
      pause() {},
      resume() {},
    };
  }

  // If spinner is disabled and there's no message, nothing to render
  if (spinnerDisabled && !message) {
    return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
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
    if (spinnerDisabled) {
      // Static text only, no spinner frames
      if (text) writeStderr(`\x1b[2K\r${text}`);
    } else {
      const prefix = frames[frame] ?? '';
      writeStderr(`\x1b[2K\r${text ? `${prefix} ${text}` : prefix}`);
    }
  };

  const timer = spinnerDisabled
    ? undefined
    : setInterval(() => {
        frame = (frame + 1) % frames.length;
        render();
      }, interval);

  render();

  const clear = () => {
    if (stopped) return;
    stopped = true;
    paused = false;
    if (timer) clearInterval(timer);
    clearLine();
  };

  return {
    update(msg) {
      if (stopped) return;
      text = msg;
      render();
    },
    succeed(msg, opts) {
      clear();
      if (msg === null) return;
      const finalMsg = msg ?? text;
      const icon = opts?.indicator ?? successIcon;
      if (finalMsg) writeStderr(formatFinal(icon, finalMsg));
    },
    fail(msg, opts) {
      clear();
      if (msg === null) return;
      const finalMsg = msg ?? text;
      const icon = opts?.indicator ?? errorIcon;
      if (finalMsg) writeStderr(formatFinal(icon, finalMsg));
    },
    stop() {
      clear();
    },
    pause() {
      if (stopped || paused) return;
      paused = true;
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

/**
 * Default signal listener that wires to `process.on(signal)`.
 * Returns an unsubscribe function that removes all listeners.
 */
function defaultOnSignal(callback: (signal: PadroneSignal) => void): () => void {
  if (typeof process === 'undefined') return () => {};
  const signals: PadroneSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const handlers = new Map<PadroneSignal, () => void>();
  for (const sig of signals) {
    const handler = () => callback(sig);
    handlers.set(sig, handler);
    process.on(sig, handler);
  }
  return () => {
    for (const [sig, handler] of handlers) {
      process.removeListener(sig, handler);
    }
  };
}

function resolveConfigPath(fs: any, path: any, cwd: string, files: string | string[]): string | undefined {
  if (typeof files === 'string') {
    const abs = path.isAbsolute(files) ? files : path.resolve(cwd, files);
    if (!fs.existsSync(abs)) {
      console.error(`Config file not found: ${abs}`);
      return undefined;
    }
    return abs;
  }
  for (const candidate of files) {
    const abs = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return undefined;
}

// Lazily resolved Node.js modules — cached after first import to keep loadConfig sync after initialization.
let _fs: typeof import('node:fs') | undefined;
let _path: typeof import('node:path') | undefined;

/** Pre-warm the fs/path module cache. Called once; subsequent loadConfig calls are synchronous. */
export async function initNodeModules(): Promise<void> {
  if (_fs && _path) return;
  _fs = await import('node:fs');
  _path = await import('node:path');
}

// Eagerly start caching node modules so loadConfig is sync by the time it's called.
// The import() promise resolves in the microtask queue, well before any user code executes.
if (typeof process !== 'undefined') initNodeModules();

function loadConfigSync(
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
  files: string | string[],
): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> {
  const cwd = process.cwd();
  const absolutePath = resolveConfigPath(fs, path, cwd, files);
  if (!absolutePath) return undefined;

  const getContent = () => fs.readFileSync(absolutePath, 'utf-8');
  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === '.yaml' || ext === '.yml') return Bun.YAML.parse(getContent()) as any;
  if (ext === '.toml') return Bun.TOML.parse(getContent()) as any;
  if (ext === '.jsonc') return Bun.JSONC.parse(getContent()) as any;
  if (ext === '.json') {
    if (Bun.JSONC) return Bun.JSONC.parse(getContent()) as any;
    try {
      return JSON.parse(getContent());
    } catch {
      return Bun.JSONC.parse(getContent()) as any;
    }
  }
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs' || ext === '.ts' || ext === '.cts' || ext === '.mts') {
    return import(absolutePath).then((mod) => mod.default ?? mod);
  }

  // Unknown extension — try JSON
  try {
    return JSON.parse(getContent());
  } catch {
    console.error(`Unable to parse config file: ${absolutePath}`);
    return undefined;
  }
}

/**
 * Find and load a config file. Accepts a single explicit path or a list of
 * candidate file names to search in the current working directory.
 * Supports JSON, JSONC, YAML, TOML, and JS/TS config files.
 *
 * Synchronous after the first call (node:fs/node:path are lazily cached).
 * The first call returns a Promise if the modules aren't yet cached.
 */
export function loadConfig(files: string | string[]): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined> {
  if (typeof process === 'undefined') return undefined;

  try {
    // Fast path: modules already cached — fully synchronous
    if (_fs && _path) return loadConfigSync(_fs, _path, files);

    // Slow path: first call — async-import, cache, then load
    return initNodeModules().then(() => loadConfigSync(_fs!, _path!, files));
  } catch (error) {
    console.error(`Error loading config file: ${error}`);
    return undefined;
  }
}

/**
 * Creates the default Node.js/Bun runtime.
 */
function defaultExit(code: number): never {
  if (typeof process !== 'undefined') process.exit(code);
  throw new Error(`Exit with code ${code}`);
}

function getTerminalInfo(): PadroneRuntime['terminal'] {
  if (typeof process === 'undefined') return undefined;
  return {
    get columns() {
      return process.stdout?.columns;
    },
    get isTTY() {
      return process.stdout?.isTTY === true;
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
    loadConfig,
    prompt: defaultTerminalPrompt,
    interactive: detectInteractiveMode(),
    progress: createTerminalSpinner,
    onSignal: defaultOnSignal,
    terminal: getTerminalInfo(),
    exit: defaultExit,
  };
}

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

/**
 * Like `resolveStdin`, but always returns a stdin source even when it's a TTY.
 * Used for async streams which support interactive (non-piped) input.
 */
export function resolveStdinAlways(partial?: PadroneRuntime): NonNullable<PadroneRuntime['stdin']> {
  if (partial?.stdin) return partial.stdin;
  return createDefaultStdin();
}

/**
 * Merges a partial runtime with the default runtime.
 */
export function resolveRuntime(partial?: PadroneRuntime): ResolvedPadroneRuntime {
  const defaults = createDefaultRuntime();
  if (!partial) return defaults;
  return {
    output: partial.output ?? defaults.output,
    error: partial.error ?? defaults.error,
    argv: partial.argv ?? defaults.argv,
    env: partial.env ?? defaults.env,
    format: partial.format ?? defaults.format,
    loadConfig: partial.loadConfig ?? defaults.loadConfig,
    interactive: partial.interactive ?? defaults.interactive,
    prompt: partial.prompt ?? defaults.prompt,
    readLine: partial.readLine ?? defaults.readLine,
    progress: partial.progress ?? defaults.progress,
    stdin: partial.stdin,
    theme: partial.theme,
    onSignal: partial.onSignal ?? defaults.onSignal,
    terminal: partial.terminal ?? defaults.terminal,
    exit: partial.exit ?? defaults.exit,
  };
}
