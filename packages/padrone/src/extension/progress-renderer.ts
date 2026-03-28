import type {
  PadroneBarConfig,
  PadroneProgressIndicator,
  PadroneProgressOptions,
  PadroneProgressShow,
  PadroneProgressUpdate,
  PadroneSpinnerConfig,
  PadroneSpinnerPreset,
} from '../core/runtime.ts';

// ---------------------------------------------------------------------------
// Spinner presets & resolution
// ---------------------------------------------------------------------------

const spinnerPresets: Record<PadroneSpinnerPreset, string[]> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
};

type ResolvedSpinnerConfig = { frames: string[]; interval: number; show: PadroneProgressShow };

function resolveSpinnerConfig(config?: PadroneSpinnerConfig): ResolvedSpinnerConfig {
  if (config === false) return { frames: [], interval: 80, show: 'never' };
  if (config === true) return { frames: spinnerPresets.dots, interval: 80, show: 'always' };
  if (typeof config === 'string') return { frames: spinnerPresets[config], interval: 80, show: 'auto' };
  if (typeof config === 'object') {
    return {
      frames: config.frames ?? spinnerPresets.dots,
      interval: config.interval ?? 80,
      show: config.show ?? 'auto',
    };
  }
  return { frames: spinnerPresets.dots, interval: 80, show: 'auto' };
}

// ---------------------------------------------------------------------------
// Bar resolution & rendering
// ---------------------------------------------------------------------------

type ResolvedBarConfig = {
  width: number;
  filled: string;
  empty: string;
  animation: 'bounce' | 'slide' | 'pulse';
  show: PadroneProgressShow;
};

const defaultBarConfig: ResolvedBarConfig = { width: 20, filled: '█', empty: '░', animation: 'bounce', show: 'auto' };

function resolveBarConfig(bar: boolean | PadroneBarConfig | undefined): ResolvedBarConfig | undefined {
  if (bar === false) return undefined;
  if (!bar) return { ...defaultBarConfig };
  if (bar === true) return { ...defaultBarConfig, show: 'always' };
  return {
    width: bar.width ?? 20,
    filled: bar.filled ?? '█',
    empty: bar.empty ?? '░',
    animation: bar.animation ?? 'bounce',
    show: bar.show ?? 'always',
  };
}

const SEGMENT_RATIO = 0.25;
const pulseGradient = ['░', '▒', '▓', '█', '▓', '▒', '░'];

function formatIndeterminate(cfg: ResolvedBarConfig, frame: number): string {
  const { width, filled, empty, animation } = cfg;
  const pad = ''.padStart(4);

  if (animation === 'pulse') {
    const idx = frame % pulseGradient.length;
    return `${pad} ${pulseGradient[idx]!.repeat(width)}`;
  }

  const seg = Math.max(2, Math.round(width * SEGMENT_RATIO));
  const travel = width - seg;

  if (animation === 'slide') {
    const offset = frame % (travel + 1);
    return `${pad} ${empty.repeat(offset)}${filled.repeat(seg)}${empty.repeat(travel - offset)}`;
  }

  // bounce (default)
  const cycle = travel * 2;
  const pos = frame % cycle;
  const offset = pos <= travel ? pos : cycle - pos;
  return `${pad} ${empty.repeat(offset)}${filled.repeat(seg)}${empty.repeat(width - offset - seg)}`;
}

function formatBar(progress: number | undefined, cfg: ResolvedBarConfig, frame: number): string {
  if (progress === undefined) return formatIndeterminate(cfg, frame);
  const { width, filled, empty } = cfg;
  const clamped = Math.max(0, Math.min(1, progress));
  const filledCount = Math.round(clamped * width);
  const pct = `${Math.round(clamped * 100)}%`.padStart(4);
  return `${pct} ${filled.repeat(filledCount)}${empty.repeat(width - filledCount)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseUpdate(value: PadroneProgressUpdate): { message?: string; progress?: number; indeterminate?: boolean } {
  if (typeof value === 'string') return { message: value };
  if (typeof value === 'number') return { progress: value };
  return value;
}

// ---------------------------------------------------------------------------
// Factory type
// ---------------------------------------------------------------------------

/** Factory function that creates a `PadroneProgressIndicator`. */
export type PadroneProgressRenderer = (message: string, options?: PadroneProgressOptions) => PadroneProgressIndicator;

// ---------------------------------------------------------------------------
// Default terminal renderer
// ---------------------------------------------------------------------------

/**
 * Creates a terminal progress indicator (spinner, bar, or both).
 * Returns a no-op indicator in non-TTY/CI environments.
 */
export function createTerminalProgress(message: string, options?: PadroneProgressOptions): PadroneProgressIndicator {
  const spinnerCfg = resolveSpinnerConfig(options?.spinner);
  const successIcon = options?.successIndicator ?? '✔';
  const errorIcon = options?.errorIndicator ?? '✖';
  const barCfg = resolveBarConfig(options?.bar);

  const formatFinal = (icon: string, msg: string) => (icon ? `${icon} ${msg}\n` : `${msg}\n`);

  if (typeof process === 'undefined' || !process.stderr?.isTTY) {
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

  if (spinnerCfg.show === 'never' && (!barCfg || barCfg.show === 'never') && !message) {
    return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
  }

  let spinnerFrame = 0;
  let barFrame = 0;
  let text = message;
  let progress: number | undefined;
  let indeterminate = false;
  let stopped = false;
  let paused = false;

  const writeStderr = process.stderr.write.bind(process.stderr);
  const writeStdout = process.stdout.write.bind(process.stdout);
  const clearLine = () => writeStderr('\x1b[2K\r');

  const render = () => {
    if (paused || stopped) return;

    const barVisible = barCfg && (barCfg.show === 'always' || (barCfg.show === 'auto' && (progress !== undefined || indeterminate)));
    const spinnerVisible = spinnerCfg.show === 'always' || (spinnerCfg.show === 'auto' && !barVisible);

    let line = '';
    if (barVisible) line += formatBar(progress, barCfg!, barFrame);
    if (spinnerVisible) {
      if (line) line += ' ';
      line += frames[spinnerFrame] ?? '';
    }
    if (text) {
      if (line) line += ' ';
      line += text;
    }

    if (line) writeStderr(`\x1b[2K\r${line}`);
    else clearLine();
  };

  const { frames } = spinnerCfg;
  const needsAnimation = spinnerCfg.show !== 'never' || (barCfg && barCfg.show !== 'never');
  const tickInterval = barCfg && barCfg.show !== 'never' ? Math.min(80, spinnerCfg.interval) : spinnerCfg.interval;

  const timer = needsAnimation
    ? setInterval(() => {
        spinnerFrame = (spinnerFrame + 1) % (frames.length || 1);
        barFrame++;
        render();
      }, tickInterval)
    : undefined;

  render();

  const clear = () => {
    if (stopped) return;
    stopped = true;
    paused = false;
    if (timer) clearInterval(timer);
    clearLine();
  };

  return {
    update(value) {
      if (stopped) return;
      const parsed = parseUpdate(value);
      if (parsed.message !== undefined) text = parsed.message;
      if (parsed.progress !== undefined) progress = parsed.progress;
      if (parsed.indeterminate !== undefined) {
        indeterminate = parsed.indeterminate;
        if (indeterminate) progress = undefined;
      }
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
