import { signalExitCode } from '../core/errors.ts';
import { defineInterceptor } from '../core/interceptors.ts';
import { thenMaybe } from '../core/results.ts';
import type { PadroneSignal } from '../core/runtime.ts';
import type { AnyPadroneBuilder, CommandTypesBase } from '../types/index.ts';

// ── Interceptor ─────────────────────────────────────────────────────────

const signalMeta = { id: 'padrone:signal', name: 'padrone:signal', order: -2000 } as const;

const signalInterceptor = defineInterceptor(signalMeta, () => {
  const abortController = new AbortController();
  let receivedSignal: PadroneSignal | undefined;
  let lastSigintTime = 0;
  let unsubscribe: (() => void) | undefined;
  const DOUBLE_SIGINT_MS = 2000;

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = undefined;
  };

  const attachSignalInfo = <T>(result: T): T => {
    if (receivedSignal && result && typeof result === 'object') {
      (result as any).signal = receivedSignal;
      (result as any).exitCode = signalExitCode(receivedSignal);
    }
    return result;
  };

  return {
    start(ctx, next) {
      unsubscribe = ctx.runtime.onSignal?.((sig) => {
        if (abortController.signal.aborted) {
          if (sig === 'SIGINT') {
            const elapsed = Date.now() - lastSigintTime;
            if (elapsed > 0 && elapsed < DOUBLE_SIGINT_MS) {
              if (typeof process !== 'undefined') process.exit(signalExitCode(sig));
            }
            lastSigintTime = Date.now();
          }
          return;
        }
        if (sig === 'SIGINT') lastSigintTime = Date.now();
        receivedSignal = sig;
        abortController.abort(sig);
      });

      const result = next({ signal: abortController.signal });
      return thenMaybe(result, (r) => {
        cleanup();
        return attachSignalInfo(r);
      });
    },
    error(_ctx, next) {
      return thenMaybe(next(), (er) => {
        if (receivedSignal && er.error instanceof Error) {
          (er.error as any)._padroneSignal = receivedSignal;
          (er.error as any)._padroneExitCode = signalExitCode(receivedSignal);
        }
        return er;
      });
    },
    shutdown(_ctx, next) {
      cleanup();
      return next();
    },
  };
});

// ── Extension ───────────────────────────────────────────────────────────

/**
 * Extension that wires process signal handling (SIGINT, SIGTERM, SIGHUP) into the interceptor lifecycle.
 *
 * - Creates an `AbortController` whose signal is propagated to all downstream phases.
 * - Subscribes to `runtime.onSignal` to forward OS signals to the abort controller.
 * - Implements SIGINT double-tap: two SIGINTs within 2 seconds force-exits the process.
 * - Attaches `signal` and `exitCode` to results and errors when interrupted.
 * - Cleans up the signal subscription on completion or failure.
 *
 * Included in the default extensions. Runs at order `-2000` (outermost).
 */
export function padroneSignalHandling(options?: { disabled?: boolean }): <T extends CommandTypesBase>(builder: T) => T {
  const interceptor = options?.disabled ? defineInterceptor({ ...signalMeta, disabled: true }, () => ({})) : signalInterceptor;
  return ((builder: AnyPadroneBuilder) => builder.intercept(interceptor)) as any;
}
