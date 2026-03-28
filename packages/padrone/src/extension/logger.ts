import { defineInterceptor } from '#src/core/interceptors.ts';
import { thenMaybe } from '#src/core/results.ts';
import type { ResolvedPadroneRuntime } from '#src/core/runtime.ts';
import type { AnyPadroneBuilder, CommandTypesBase } from '#src/types/index.ts';
import type { WithInterceptor } from '#src/util/type-utils.ts';
import type { PadroneTracer } from './tracing.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Log level values ordered by severity. */
export type PadroneLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Logger instance injected into the command context. */
export type PadroneLogger = {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  /** The current effective log level. */
  level: PadroneLogLevel;
  /** Create a child logger with a prefix label. */
  child: (label: string) => PadroneLogger;
};

/** Configuration for the logger extension. */
export type PadroneLoggerConfig = {
  /** Minimum log level to output. Defaults to `'info'`. */
  level?: PadroneLogLevel;
  /** Prefix prepended to every log message. */
  prefix?: string;
  /** Include timestamps in log output. Defaults to `false`. */
  timestamps?: boolean;
};

/** Builder/program type after applying `padroneLogger()`. Adds `{ logger: PadroneLogger }` to the command context. */
export type WithLogger<T> = WithInterceptor<T, { logger: PadroneLogger }>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<PadroneLogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, silent: 5 };
const LEVEL_LABELS: Record<Exclude<PadroneLogLevel, 'silent'>, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};
const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_ORDER));

function resolveCliLevel(rawArgs: Record<string, unknown>): PadroneLogLevel | undefined {
  // --trace → trace level
  if ('trace' in rawArgs) {
    const t = rawArgs.trace;
    delete rawArgs.trace;
    if (t !== false) return 'trace';
  }
  // --verbose / --debug → debug level
  if ('verbose' in rawArgs) {
    const v = rawArgs.verbose;
    delete rawArgs.verbose;
    if (v !== false) return 'debug';
  }
  if ('debug' in rawArgs) {
    const d = rawArgs.debug;
    delete rawArgs.debug;
    if (d !== false) return 'debug';
  }
  // --silent / --quiet → suppress all output
  if ('silent' in rawArgs) {
    const s = rawArgs.silent;
    delete rawArgs.silent;
    if (s !== false) return 'silent';
  }
  if ('quiet' in rawArgs) {
    const q = rawArgs.quiet;
    delete rawArgs.quiet;
    if (q !== false) return 'silent';
  }
  // --log-level=<level> → explicit level (parser keeps kebab-case)
  if ('log-level' in rawArgs) {
    const val = rawArgs['log-level'];
    delete rawArgs['log-level'];
    if (typeof val === 'string' && VALID_LEVELS.has(val)) return val as PadroneLogLevel;
  }
  return undefined;
}

function createLogger(
  runtime: ResolvedPadroneRuntime,
  level: PadroneLogLevel,
  config: ResolvedLoggerConfig,
  tracing?: PadroneTracer,
): PadroneLogger {
  const threshold = LEVEL_ORDER[level];

  function format(lvl: Exclude<PadroneLogLevel, 'silent'>, prefix: string, args: unknown[]): string {
    const parts: string[] = [];
    if (config.timestamps) parts.push(new Date().toISOString());
    parts.push(`[${LEVEL_LABELS[lvl]}]`);
    if (prefix) parts.push(prefix);
    parts.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    return parts.join(' ');
  }

  function makeLogger(prefix: string): PadroneLogger {
    const emit = (lvl: Exclude<PadroneLogLevel, 'silent'>, args: unknown[]) => {
      if (LEVEL_ORDER[lvl] < threshold) return;
      const message = format(lvl, prefix, args);
      tracing?.rootSpan.addEvent('log', {
        'log.level': lvl,
        'log.message': args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
      });
      if (lvl === 'error' || lvl === 'warn') runtime.error(message);
      else runtime.output(message);
    };

    return {
      trace: (...args) => emit('trace', args),
      debug: (...args) => emit('debug', args),
      info: (...args) => emit('info', args),
      warn: (...args) => emit('warn', args),
      error: (...args) => emit('error', args),
      level,
      child: (label) => makeLogger(prefix ? `${prefix} [${label}]` : `[${label}]`),
    };
  }

  return makeLogger(config.prefix);
}

// ---------------------------------------------------------------------------
// Interceptor
// ---------------------------------------------------------------------------

type ResolvedLoggerConfig = { level: PadroneLogLevel; prefix: string; timestamps: boolean };

function loggerInterceptor(config: ResolvedLoggerConfig) {
  return defineInterceptor({ id: 'padrone:logger', name: 'padrone:logger' })
    .requires<{ tracing?: PadroneTracer }>()
    .factory(() => {
      let effectiveLevel: PadroneLogLevel = config.level;

      return {
        parse(_ctx, next) {
          return thenMaybe(next(), (res) => {
            const cliLevel = resolveCliLevel(res.rawArgs);
            if (cliLevel !== undefined) effectiveLevel = cliLevel;
            return res;
          });
        },

        execute(ctx, next) {
          const logger = createLogger(ctx.runtime, effectiveLevel, config, ctx.context?.tracing);
          return next({ context: { ...ctx.context, logger } });
        },
      };
    });
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/**
 * Extension that injects a structured logger into the command context.
 *
 * The logger respects a configurable log level threshold, supports prefixed
 * child loggers, and routes output through the runtime's `output`/`error`
 * functions so it works in any environment (terminal, test, web).
 *
 * Supports CLI flags for runtime level overrides:
 * - `--trace` → sets level to `trace`
 * - `--verbose` or `--debug` → sets level to `debug`
 * - `--silent` or `--quiet` → sets level to `silent`
 * - `--log-level=<level>` → sets an explicit level (`trace`, `debug`, `info`, `warn`, `error`, `silent`)
 *
 * CLI flags take precedence over the programmatic config.
 *
 * Provides `{ logger: PadroneLogger }` on the command context.
 * Access it in action handlers as `ctx.context.logger`.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli')
 *   .extend(padroneLogger({ level: 'info' }))
 *   .command('sync', (c) =>
 *     c.action((_args, ctx) => {
 *       ctx.context.logger.info('starting sync');
 *       const db = ctx.context.logger.child('db');
 *       db.debug('connecting...');
 *     })
 *   )
 * ```
 *
 * Then run:
 * ```sh
 * my-cli sync --verbose      # debug level
 * my-cli sync --quiet        # silent
 * my-cli sync --log-level=warn
 * ```
 */
export function padroneLogger<T extends CommandTypesBase>(config?: PadroneLoggerConfig): (builder: T) => WithLogger<T> {
  const resolved: ResolvedLoggerConfig = {
    level: config?.level ?? 'info',
    prefix: config?.prefix ?? '',
    timestamps: config?.timestamps ?? false,
  };
  return ((builder: AnyPadroneBuilder) => builder.intercept(loggerInterceptor(resolved))) as any;
}
