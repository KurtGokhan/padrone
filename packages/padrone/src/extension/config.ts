import type { StandardSchemaV1 } from '@standard-schema/spec';
import { applyValues } from '../core/args.ts';
import { ConfigError } from '../core/errors.ts';
import { defineInterceptor } from '../core/interceptors.ts';
import { thenMaybe } from '../core/results.ts';
import type { AnyPadroneBuilder, CommandTypesBase, InterceptorValidateContext } from '../types/index.ts';

// ── Types ────────────────────────────────────────────────────────────────

export type PadroneConfigOptions = {
  /** Config file names to auto-detect (e.g. `['config.json', '.myapprc']`). First found is used. */
  files?: string | string[];
  /** Schema to validate and transform config file data into the args shape. */
  schema?: StandardSchemaV1;
  /** Disable this extension. */
  disabled?: boolean;
};

// ── Extension ────────────────────────────────────────────────────────────

/**
 * Extension that handles config file loading, validation, and merging into command arguments.
 *
 * Features:
 * - `--config` / `-c` flag for explicit config file path
 * - Auto-detection of config files from a list of candidate names
 * - Optional schema validation and transformation of config data
 *
 * Config values have the lowest precedence (CLI > stdin > env > config).
 *
 * ```ts
 * createPadrone('my-cli')
 *   .extend(padroneConfig({
 *     files: ['config.json', '.myapprc'],
 *     schema: z.object({ port: z.number(), host: z.string() }),
 *   }))
 * ```
 */
export function padroneConfig(options?: PadroneConfigOptions): <T extends CommandTypesBase>(builder: T) => T {
  if (options?.disabled) {
    const disabled = defineInterceptor({ id: 'padrone:config', name: 'padrone:config', order: -999, disabled: true }, () => ({}));
    return ((builder: AnyPadroneBuilder) => builder.intercept(disabled)) as any;
  }

  const configFiles = options?.files ? (Array.isArray(options.files) ? options.files : [options.files]) : undefined;
  const configSchema = options?.schema;

  const interceptor = defineInterceptor({ id: 'padrone:config', name: 'padrone:config', order: -999 }, () => ({
    validate(ctx: InterceptorValidateContext, next) {
      // Extract --config / -c from rawArgs
      const explicitConfigPath = (ctx.rawArgs.config ?? ctx.rawArgs.c) as string | undefined;
      if (typeof explicitConfigPath === 'string') {
        delete ctx.rawArgs.config;
        delete ctx.rawArgs.c;
      }

      // Load config data: explicit --config flag takes priority, then auto-detect
      const configData = ctx.runtime.loadConfig(explicitConfigPath ?? configFiles ?? []);

      if (!configData) return next();

      // Validate against schema if provided
      if (configSchema) {
        const validated = configSchema['~standard'].validate(configData);
        return thenMaybe(validated, (result) => {
          if (result.issues) {
            const issueMessages = result.issues
              .map((i: StandardSchemaV1.Issue) => `  - ${i.path?.join('.') || 'root'}: ${i.message}`)
              .join('\n');
            throw new ConfigError(`Invalid config file:\n${issueMessages}`, {
              command: ctx.command.path || ctx.command.name,
            });
          }
          const validatedData = result.value as Record<string, unknown>;
          const mergedRawArgs = applyValues(ctx.rawArgs, validatedData);
          return next({ rawArgs: mergedRawArgs });
        });
      }

      // No schema — pass through as-is
      const mergedRawArgs = applyValues(ctx.rawArgs, configData);
      return next({ rawArgs: mergedRawArgs });
    },
  }));

  return ((builder: AnyPadroneBuilder) => builder.intercept(interceptor)) as any;
}
