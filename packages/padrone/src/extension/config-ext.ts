import { thenMaybe } from '#src/core/results.ts';
import { defineInterceptor } from '../core/interceptors.ts';
import type { AnyPadroneBuilder, CommandTypesBase } from '../types/index.ts';

// ── Interceptor ─────────────────────────────────────────────────────────

const configInterceptor = defineInterceptor({ id: 'padrone:config', name: 'padrone:config', order: -999 }, () => {
  let configPath: string | undefined;

  return {
    parse(_ctx, next) {
      return thenMaybe(next(), (res) => {
        configPath = (res.rawArgs.config ?? res.rawArgs.c) as string | undefined;
        if (typeof configPath === 'string') {
          delete res.rawArgs.config;
          delete res.rawArgs.c;
        }
        return res;
      });
    },
    validate(ctx, next) {
      if (configPath) {
        const configData = ctx.runtime.loadConfigFile(configPath);
        return next({ configData });
      }
      return next();
    },
  };
});

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that handles `--config` / `-c` flags for config file path override.
 * Extracts the config path in the parse phase and loads the config file in the validate phase,
 * passing the data to the core validation pipeline via context override.
 *
 * Usage:
 * ```ts
 * createPadrone('my-cli').extend(padroneConfig())
 * ```
 */
export function padroneConfig(): <T extends CommandTypesBase>(builder: T) => T {
  return ((builder: AnyPadroneBuilder) => builder.intercept(configInterceptor)) as any;
}
