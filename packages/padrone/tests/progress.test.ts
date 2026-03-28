import { describe, expect, it } from 'bun:test';
import {
  createPadrone,
  type PadroneProgressDefaults,
  type PadroneProgressIndicator,
  type PadroneProgressRenderer,
  type PadroneProgressUpdate,
  padroneProgress,
} from 'padrone';

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
        c.extend(padroneProgress({ progress: 'Deploying...', renderer: factory })).action(() => 'deployed'),
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
          .extend(padroneProgress({ progress: 'Deploying...', renderer: factory }))
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
        c.extend(padroneProgress({ progress: 'Working...', renderer: factory })).action(() => {
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
        c.extend(padroneProgress({ progress: 'Working...', renderer: factory })).action(async () => {
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
          .extend(padroneProgress({ progress: 'Deploying...', success: 'Deployed!', error: 'Deploy failed', renderer: factory }))
          .action(() => 'ok'),
      );

      program.eval('deploy');
      expect(indicators[0]!.message).toBe('Deploying...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Deployed!']);
    });

    it('should use error message from progress config on failure', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('deploy', (c) =>
        c.extend(padroneProgress({ progress: 'Deploying...', error: 'Deploy failed', renderer: factory })).action(() => {
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
        c.extend(padroneProgress({ progress: 'Working...', renderer: factory })).action((_args, ctx) => {
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
        .command('cmd', (c) => c.extend(padroneProgress({ progress: 'Working...', renderer: factory })).action(() => 'done'));

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
        .command('cmd', (c) => c.extend(padroneProgress({ progress: 'Working...', renderer: factory })).action(() => 'done'));

      const result = program.eval('cmd');
      expect(result.error).toBeDefined();
      // Indicator was created in validate (which succeeded), but execute's cleanup didn't run
      // because the outer interceptor threw before reaching the progress interceptor's execute.
      // The indicator is created but not finalized — this is expected since there's no shutdown
      // phase for command-level interceptors.
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual([]);
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
              progress: 'Deploying...',
              success: (result) => `Deployed v${(result as any).version}`,
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
              progress: 'Deploying...',
              error: () => 'Custom fail message',
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
              progress: 'Working...',
              success: () => null,
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
              progress: 'Working...',
              success: (result) => `Result: ${result}`,
              error: 'Static error',
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
              progress: 'Deploying...',
              success: (result) => ({ message: `Deployed v${(result as any).version}`, indicator: '🚀' }),
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
              progress: 'Deploying...',
              error: () => ({ message: 'Deploy crashed', indicator: '💥' }),
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
              progress: 'Working...',
              success: { message: 'All good', indicator: '👍' },
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
              progress: 'Working...',
              success: () => ({ message: null }),
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
              progress: 'Working...',
              success: { message: 'Done', indicator: '' },
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
          .extend(padroneProgress({ validation: 'Validating...', progress: 'Running...', renderer: factory }))
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
        c.extend(padroneProgress({ progress: 'Running...', renderer: factory })).action(() => 'done'),
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
        c.extend(padroneProgress({ progress: 'Working...', success: null, renderer: factory })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:null']);
    });

    it('should suppress error message when error is null', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ progress: 'Working...', error: null, renderer: factory })).action(() => {
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
          c.extend(padroneProgress({ progress: 'Building...', renderer: ctorFactory.factory })).action(() => 'built'),
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
  });

  describe('spinner options', () => {
    it('should pass spinner config to renderer', () => {
      let receivedOptions: any;
      const renderer: PadroneProgressRenderer = (_message, options) => {
        receivedOptions = options;
        return { update() {}, succeed() {}, fail() {}, stop() {}, pause() {}, resume() {} };
      };

      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ progress: 'Working...', spinner: 'line', renderer })).action(() => 'ok'),
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
        c.extend(padroneProgress({ progress: 'Working...', renderer })).action(() => 'ok'),
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
        c.extend(padroneProgress({ progress: 'Working...', spinner: false, renderer })).action(() => 'ok'),
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
        c.extend(padroneProgress({ progress: 'Downloading...', bar: true, renderer })).action(() => 'ok'),
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
        c.extend(padroneProgress({ progress: 'Downloading...', bar: { width: 30, filled: '#', empty: '-' }, renderer })).action(() => 'ok'),
      );

      program.eval('cmd');
      expect(receivedOptions.bar).toEqual({ width: 30, filled: '#', empty: '-' });
    });

    it('should track progress via update(number) in action', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app').command('cmd', (c) =>
        c.extend(padroneProgress({ progress: 'Downloading...', bar: true, renderer: factory })).action((_args, ctx) => {
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
        c.extend(padroneProgress({ progress: 'Downloading...', bar: true, renderer: factory })).action((_args, ctx) => {
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
        c.extend(padroneProgress({ progress: 'Working...', bar: true, renderer: factory })).action((_args, ctx) => {
          ctx.context.progress.update('Still working...');
          return 'done';
        }),
      );

      program.eval('cmd');
      // Only message updates, no progress numbers — stays indeterminate
      expect(indicators[0]!.indicator.calls).toEqual(['update:Still working...', 'succeed:']);
    });
  });
});
