import { thenMaybe } from '#src/core/results.ts';
import { defineInterceptor } from '../core/interceptors.ts';
import type { AnyPadroneBuilder, CommandTypesBase } from '../types/index.ts';

// ── Interceptor ─────────────────────────────────────────────────────────

const configInterceptor = defineInterceptor({ id: 'padrone:config', name: 'padrone:config', order: -999 }, () => ({
  parse(ctx, next) {
    return thenMaybe(next(), (res) => {
      const configPath = (res.rawArgs.config ?? res.rawArgs.c) as string | undefined;
      if (typeof configPath === 'string') {
        ctx.state._configPath = configPath;
        delete res.rawArgs.config;
        delete res.rawArgs.c;
      }
      return res;
    });
  },
}));

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that handles `--config` / `-c` flags for config file path override.
 * Extracts the config path and stores it in `state._configPath` for the validation phase.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneConfig())
 * ```
 */
export function padroneConfig(): <T extends CommandTypesBase>(builder: T) => T {
  return ((builder: AnyPadroneBuilder) => builder.intercept(configInterceptor)) as any;
}
