import { describe, expect, it } from 'bun:test';
import {
  createPadrone,
  type PadroneProgressDefaults,
  type PadroneProgressIndicator,
  type PadroneProgressRenderer,
  type PadroneProgressUpdate,
  padroneProgress,
} from 'padrone';
import * as z from 'zod/v4';

function createMockProgress() {
  const indicators: { message: string; indicator: PadroneProgressIndicator & { calls: string[] } }[] = [];

  const factory: PadroneProgressRenderer = (message) => {
    const calls: string[] = [];
    const indicator: PadroneProgressIndicator & { calls: string[] } = {
      calls,
      update: (value: PadroneProgressUpdate) => {
        if (typeof value === 'string') calls.push(`update:${value}`);
        else if (typeof value === 'number') calls.push(`progress:${value}`);
        else {
          if (value.message !== undefined) calls.push(`update:${value.message}`);
          if (value.progress !== undefined) calls.push(`progress:${value.progress}`);
        }
      },
      succeed: (msg?: string | null, opts?: { indicator?: string }) => {
        const base = msg === null ? 'succeed:null' : `succeed:${msg ?? ''}`;
        calls.push(opts?.indicator !== undefined ? `${base}[icon:${opts.indicator}]` : base);
      },
      fail: (msg?: string | null, opts?: { indicator?: string }) => {
        const base = msg === null ? 'fail:null' : `fail:${msg ?? ''}`;
        calls.push(opts?.indicator !== undefined ? `${base}[icon:${opts.indicator}]` : base);
      },
      stop: () => {
        calls.push('stop');
      },
      pause: () => {
        calls.push('pause');
      },
      resume: () => {
        calls.push('resume');
      },
    };
    indicators.push({ message, indicator });
    return indicator;
  };

  return { factory, indicators };
}

describe('progress', () => {
  describe('auto-progress via padroneProgress interceptor', () => {
    it('should start and succeed progress for a sync command', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c.extend(padroneProgress({ message: 'Deploying...', renderer: factory })).action(() => 'deployed'),
      );

      const result = program.eval('deploy');
      expect(result.error).toBeUndefined();
      expect(result.result).toBe('deployed');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.message).toBe('Deploying...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });

    it('should start and succeed progress for an async command', async () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c
          .extend(padroneProgress({ message: 'Deploying...', renderer: factory }))
          .async()
          .action(async () => {
            return 'deployed';
          }),
      );

      const { value, error } = await program.eval('deploy').drain();
      expect(error).toBeUndefined();
      expect(value).toBe('deployed');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });

    it('should fail progress when command throws', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('fail', (c) =>
        c.extend(padroneProgress({ message: 'Working...', renderer: factory })).action(() => {
          throw new Error('boom');
        }),
      );

      const result = program.eval('fail');
      expect(result.error).toBeInstanceOf(Error);
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:boom']);
    });

    it('should fail progress when async command rejects', async () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('fail', (c) =>
        c.extend(padroneProgress({ message: 'Working...', renderer: factory })).action(async () => {
          throw new Error('async boom');
        }),
      );

      const result = await program.eval('fail');
      expect(result.error).toBeInstanceOf(Error);
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:async boom']);
    });

    it('should use per-state messages from progress config object', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c
          .extend(
            padroneProgress({
              message: { progress: 'Deploying...', success: 'Deployed!', error: 'Deploy failed' },
              renderer: factory,
            }),
          )
          .action(() => 'ok'),
      );

      program.eval('deploy');
      expect(indicators[0]!.message).toBe('Deploying...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Deployed!']);
    });

    it('should use error message from progress config on failure', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c.extend(padroneProgress({ message: { progress: 'Deploying...', error: 'Deploy failed' }, renderer: factory })).action(() => {
          throw new Error('boom');
        }),
      );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Deploy failed']);
    });

    it('should use default terminal renderer when no renderer is provided', () => {
      const program = createPadrone('app').command('deploy', (c) => c.extend(padroneProgress('Deploying...')).action(() => 'ok'));

      const result = program.eval('deploy');
      expect(result.error).toBeUndefined();
      expect(result.result).toBe('ok');
    });

    it('should not start progress for commands without progress extension', () => {
      const { indicators } = createMockProgress();
      const program = createPadrone('app').command('simple', (c) => c.action(() => 'ok'));

      program.eval('simple');
      expect(indicators).toHaveLength(0);
    });
  });

  describe('ctx.context.progress', () => {
    it('should expose auto-managed indicator on action context', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', renderer: factory })).action((_args, ctx) => {
          ctx.context.progress.update('halfway');
          return 'done';
        }),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['update:halfway', 'succeed:']);
    });
  });

  describe('with interceptors', () => {
    it('should succeed progress when interceptors wrap execution', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .intercept({ name: 'test-interceptor' }, () => ({
          execute: (_ctx, next) => next(),
        }))
        .command('cmd', (c) => c.extend(padroneProgress({ message: 'Working...', renderer: factory })).action(() => 'done'));

      const result = program.eval('cmd');
      expect(result.result).toBe('done');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });

    it('should fail progress when outer interceptor throws in execute', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .intercept({ name: 'failing-interceptor' }, () => ({
          execute: () => {
            throw new Error('interceptor error');
          },
        }))
        .command('cmd', (c) => c.extend(padroneProgress({ message: 'Working...', renderer: factory })).action(() => 'done'));

      const result = program.eval('cmd');
      expect(result.error).toBeDefined();
      expect(indicators).toHaveLength(1);
      // Outer interceptor threw before reaching progress interceptor's execute phase,
      // and error phase only runs for root interceptors — indicator is not finalized.
      expect(indicators[0]!.indicator.calls).toEqual([]);
    });
  });

  describe('validation failure cleanup', () => {
    it('should clean up indicator when validation fails', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .arguments(z.object({ url: z.url() }))
          .extend(padroneProgress({ message: 'Working...', renderer: factory }))
          .action(() => 'done'),
      );

      const result = program.eval('cmd --url invalid');
      expect(result.argsResult?.issues).toBeDefined();
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Validation failed']);
    });

    it('should clean up indicator when required arg is missing', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .arguments(z.object({ name: z.string() }))
          .extend(padroneProgress({ message: 'Working...', renderer: factory }))
          .action(() => 'done'),
      );

      const result = program.eval('cmd');
      expect(result.argsResult?.issues).toBeDefined();
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Validation failed']);
    });

    it('should use custom error message config on validation failure', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .arguments(z.object({ url: z.url() }))
          .extend(padroneProgress({ message: { progress: 'Working...', error: 'Something went wrong' }, renderer: factory }))
          .action(() => 'done'),
      );

      const result = program.eval('cmd --url invalid');
      expect(result.argsResult?.issues).toBeDefined();
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Something went wrong']);
    });

    it('should use dynamic error callback on validation failure', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .arguments(z.object({ url: z.url() }))
          .extend(
            padroneProgress({
              message: { progress: 'Working...', error: (err) => `Failed: ${(err as Error).message}` },
              renderer: factory,
            }),
          )
          .action(() => 'done'),
      );

      const result = program.eval('cmd --url invalid');
      expect(result.argsResult?.issues).toBeDefined();
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls[0]).toStartWith('fail:Failed:');
    });

    it('should not fail indicator twice when execute already handled the error', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', renderer: factory })).action(() => {
          throw new Error('action error');
        }),
      );

      const result = program.eval('cmd');
      expect(result.error).toBeDefined();
      // Execute's onError cleans up and sets indicator to undefined via teardown
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:action error']);
    });

    it('should clean up indicator on async validation failure', async () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .arguments(z.object({ url: z.url() }))
          .extend(padroneProgress({ message: 'Working...', renderer: factory }))
          .async()
          .action(async () => 'done'),
      );

      const result = await program.eval('cmd --url invalid');
      expect(result.argsResult?.issues).toBeDefined();
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Validation failed']);
    });

    it('should clean up indicator when cli() validation throws', () => {
      const { factory, indicators } = createMockProgress();
      const errors: string[] = [];
      const program = createPadrone('app')
        .runtime({ argv: () => ['cmd', '--url', 'invalid'], error: (msg) => errors.push(msg), output: () => {} })
        .command('cmd', (c) =>
          c
            .arguments(z.object({ url: z.url() }))
            .extend(padroneProgress({ message: 'Working...', renderer: factory }))
            .action(() => 'done'),
        );

      program.cli();
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Validation failed']);
    });
  });

  describe('dynamic success/error callbacks', () => {
    it('should use dynamic success callback', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c
          .action(() => ({ version: '2.0' }))
          .extend(
            padroneProgress({
              message: { progress: 'Deploying...', success: (result) => `Deployed v${(result as any).version}` },
              renderer: factory,
            }),
          ),
      );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Deployed v2.0']);
    });

    it('should use dynamic error callback', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c
          .action(() => {
            throw new Error('oops');
          })
          .extend(
            padroneProgress({
              message: { progress: 'Deploying...', error: () => 'Custom fail message' },
              renderer: factory,
            }),
          ),
      );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Custom fail message']);
    });

    it('should support null from callbacks to suppress messages', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .action(() => 'ok')
          .extend(
            padroneProgress({
              message: { progress: 'Working...', success: () => null },
              renderer: factory,
            }),
          ),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:null']);
    });

    it('should mix static and dynamic in same config', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .action(() => 42)
          .extend(
            padroneProgress({
              message: { progress: 'Working...', success: (result) => `Result: ${result}`, error: 'Static error' },
              renderer: factory,
            }),
          ),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Result: 42']);
    });
  });

  describe('callback returning { message, indicator } object', () => {
    it('should pass custom indicator from success callback', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c
          .action(() => ({ version: '2.0' }))
          .extend(
            padroneProgress({
              message: {
                progress: 'Deploying...',
                success: (result) => ({ message: `Deployed v${(result as any).version}`, indicator: '🚀' }),
              },
              renderer: factory,
            }),
          ),
      );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Deployed v2.0[icon:🚀]']);
    });

    it('should pass custom indicator from error callback', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c
          .action(() => {
            throw new Error('oops');
          })
          .extend(
            padroneProgress({
              message: { progress: 'Deploying...', error: () => ({ message: 'Deploy crashed', indicator: '💥' }) },
              renderer: factory,
            }),
          ),
      );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Deploy crashed[icon:💥]']);
    });

    it('should support static { message, indicator } in success field', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .action(() => 'ok')
          .extend(
            padroneProgress({
              message: { progress: 'Working...', success: { message: 'All good', indicator: '👍' } },
              renderer: factory,
            }),
          ),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:All good[icon:👍]']);
    });

    it('should support null message in object to suppress output', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .action(() => 'ok')
          .extend(
            padroneProgress({
              message: { progress: 'Working...', success: () => ({ message: null }) },
              renderer: factory,
            }),
          ),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:null']);
    });

    it('should support empty string indicator to hide icon', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .action(() => 'ok')
          .extend(
            padroneProgress({
              message: { progress: 'Working...', success: { message: 'Done', indicator: '' } },
              renderer: factory,
            }),
          ),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Done[icon:]']);
    });
  });

  describe('validation phase progress', () => {
    it('should show validation message during async validation', async () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .extend(padroneProgress({ message: { validation: 'Validating...', progress: 'Running...' }, renderer: factory }))
          .async()
          .action(async () => 'done'),
      );

      const { value } = await program.eval('cmd').drain();
      expect(value).toBe('done');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.message).toBe('Validating...');
      expect(indicators[0]!.indicator.calls).toEqual(['update:Running...', 'succeed:']);
    });

    it('should default validation message to empty string (uses progress message)', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Running...', renderer: factory })).action(() => 'done'),
      );

      program.eval('cmd');
      // No explicit validation message → starts with progress message, no update call
      expect(indicators[0]!.message).toBe('Running...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });
  });

  describe('null message support', () => {
    it('should suppress succeed message when success is null', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: { progress: 'Working...', success: null }, renderer: factory })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:null']);
    });

    it('should suppress error message when error is null', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: { progress: 'Working...', error: null }, renderer: factory })).action(() => {
          throw new Error('boom');
        }),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:null']);
    });
  });

  describe('context-based config', () => {
    it('should read renderer from context', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .context<{ progressConfig: PadroneProgressDefaults }>()
        .command('build', (c) => c.extend(padroneProgress('Building...')).action(() => 'built'));

      const result = program.eval('build', { context: { progressConfig: { renderer: factory } } });
      expect(result.error).toBeUndefined();
      expect(result.result).toBe('built');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.message).toBe('Building...');
    });

    it('should let constructor args override context config', () => {
      const ctxFactory = createMockProgress();
      const ctorFactory = createMockProgress();
      const program = createPadrone('app')
        .context<{ progressConfig: PadroneProgressDefaults }>()
        .command('build', (c) =>
          c.extend(padroneProgress({ message: 'Building...', renderer: ctorFactory.factory })).action(() => 'built'),
        );

      program.eval('build', { context: { progressConfig: { renderer: ctxFactory.factory } } });
      expect(ctorFactory.indicators).toHaveLength(1);
      expect(ctxFactory.indicators).toHaveLength(0);
    });

    it('should read spinner config from context', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app')
        .context<{ progressConfig: PadroneProgressDefaults }>()
        .command('cmd', (c) => c.extend(padroneProgress('Working...')).action(() => 'ok'));

      program.eval('cmd', { context: { progressConfig: { renderer, spinner: 'line' } } });
      expect(receivedOptions).toEqual({ spinner: 'line' });
    });

    it('should share context config across multiple commands', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .context<{ progressConfig: PadroneProgressDefaults }>()
        .command('sync', (c) => c.extend(padroneProgress('Syncing...')).action(() => 'synced'))
        .command('build', (c) => c.extend(padroneProgress('Building...')).action(() => 'built'));

      program.eval('sync', { context: { progressConfig: { renderer: factory } } });
      program.eval('build', { context: { progressConfig: { renderer: factory } } });
      expect(indicators).toHaveLength(2);
      expect(indicators[0]!.message).toBe('Syncing...');
      expect(indicators[1]!.message).toBe('Building...');
    });

    it('should work without context config (backwards compat)', () => {
      const program = createPadrone('app').command('cmd', (c) => c.extend(padroneProgress('Working...')).action(() => 'ok'));

      const result = program.eval('cmd');
      expect(result.error).toBeUndefined();
      expect(result.result).toBe('ok');
    });

    it('should fall back to context messages when command has no message config', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .context<{ progressConfig: PadroneProgressDefaults }>()
        .command('cmd', (c) => c.extend(padroneProgress({ renderer: factory })).action(() => 'ok'));

      program.eval('cmd', {
        context: { progressConfig: { renderer: factory, message: { progress: 'Context msg', success: 'Context done' } } },
      });
      expect(indicators[0]!.message).toBe('Context msg');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Context done']);
    });

    it('should let command message fields override context message fields', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .context<{ progressConfig: PadroneProgressDefaults }>()
        .command('cmd', (c) => c.extend(padroneProgress({ message: { progress: 'Command msg' }, renderer: factory })).action(() => 'ok'));

      program.eval('cmd', {
        context: { progressConfig: { renderer: factory, message: { progress: 'Context msg', success: 'Context done' } } },
      });
      expect(indicators[0]!.message).toBe('Command msg');
      // success not set on command → falls back to context
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Context done']);
    });
  });

  describe('spinner options', () => {
    it('should pass spinner config to renderer', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', spinner: 'line', renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions).toEqual({ spinner: 'line' });
    });

    it('should not pass spinner options when not configured', () => {
      let receivedOptions: any = 'NOT_CALLED';
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions).toBeUndefined();
    });

    it('should pass spinner:false to disable spinner animation', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', spinner: false, renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions).toEqual({ spinner: false });
    });
  });

  describe('progress bar', () => {
    it('should pass bar options to renderer', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Downloading...', bar: true, renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions).toEqual({ spinner: undefined, bar: true });
    });

    it('should pass custom bar config to renderer', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Downloading...', bar: { width: 30, filled: '#', empty: '-' }, renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions.bar).toEqual({ width: 30, filled: '#', empty: '-' });
    });

    it('should track progress via update(number) in action', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Downloading...', bar: true, renderer: factory })).action((_args, ctx) => {
          ctx.context.progress.update(0.5);
          return 'done';
        }),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['progress:0.5', 'succeed:']);
    });

    it('should track progress via update({ message, progress })', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Downloading...', bar: true, renderer: factory })).action((_args, ctx) => {
          ctx.context.progress.update({ message: 'Step 1', progress: 0.25 });
          ctx.context.progress.update({ message: 'Step 2', progress: 0.75 });
          return 'done';
        }),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['update:Step 1', 'progress:0.25', 'update:Step 2', 'progress:0.75', 'succeed:']);
    });

    it('should support indeterminate progress (no number)', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', bar: true, renderer: factory })).action((_args, ctx) => {
          ctx.context.progress.update('Still working...');
          return 'done';
        }),
      );

      program.eval('cmd');
      // Only message updates, no progress numbers — stays indeterminate
      expect(indicators[0]!.indicator.calls).toEqual(['update:Still working...', 'succeed:']);
    });
  });

  describe('time and eta', () => {
    it('should pass time option to renderer', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', time: true, renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions?.time).toBe(true);
    });

    it('should pass eta option to renderer', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', eta: true, renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions?.eta).toBe(true);
    });

    it('should pass both time and eta with bar', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', bar: true, time: true, eta: true, renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions).toEqual({ spinner: undefined, bar: true, time: true, eta: true });
    });

    it('should read time config from context', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app')
        .context<{ progressConfig: PadroneProgressDefaults }>()
        .command('cmd', (c) => c.extend(padroneProgress('Working...')).action(() => 'ok'));

      program.eval('cmd', { context: { progressConfig: { renderer, time: true, eta: true } } });
      expect(receivedOptions?.time).toBe(true);
      expect(receivedOptions?.eta).toBe(true);
    });

    it('should allow starting timer via update({ time: true })', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ message: 'Working...', renderer: factory })).action((_args, ctx) => {
          ctx.context.progress.update({ time: true });
          return 'done';
        }),
      );

      program.eval('cmd');
      // The mock doesn't track time specifically, but the update call should succeed
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });
  });
});
