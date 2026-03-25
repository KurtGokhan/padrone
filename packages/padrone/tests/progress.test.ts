import { describe, expect, it } from 'bun:test';
import { createPadrone, type PadroneProgressIndicator } from 'padrone';
import { createConsoleMocker } from './console-mocker.ts';

function createMockProgress() {
  const indicators: { message: string; indicator: PadroneProgressIndicator & { calls: string[] } }[] = [];

  const factory = (message: string) => {
    const calls: string[] = [];
    const indicator: PadroneProgressIndicator & { calls: string[] } = {
      calls,
      update: (msg: string) => {
        calls.push(`update:${msg}`);
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
  createConsoleMocker();

  describe('auto-progress via .progress()', () => {
    it('should start and succeed progress for a sync command', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) => c.progress('Deploying...').action(() => 'deployed'));

      const result = program.eval('deploy');
      expect(result.error).toBeUndefined();
      expect(result.result).toBe('deployed');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.message).toBe('Deploying...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });

    it('should start and succeed progress for an async command', async () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c
            .progress('Deploying...')
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
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('fail', (c) =>
          c.progress('Working...').action(() => {
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
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('fail', (c) =>
          c.progress('Working...').action(async () => {
            throw new Error('async boom');
          }),
        );

      const result = await program.eval('fail');
      expect(result.error).toBeInstanceOf(Error);
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['fail:async boom']);
    });

    it('should use generic message when progress is true', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) => c.progress(true).action(() => 'ok'));

      program.eval('deploy');
      expect(indicators[0]!.message).toBe('Running deploy...');
    });

    it('should use per-state messages from progress config object', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c.progress({ progress: 'Deploying...', success: 'Deployed!', error: 'Deploy failed' }).action(() => 'ok'),
        );

      program.eval('deploy');
      expect(indicators[0]!.message).toBe('Deploying...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Deployed!']);
    });

    it('should use error message from progress config on failure', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c.progress({ progress: 'Deploying...', error: 'Deploy failed' }).action(() => {
            throw new Error('boom');
          }),
        );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Deploy failed']);
    });

    it('should fall back to default message when config object has no progress field', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) => c.progress({ success: 'Done!' }).action(() => 'ok'));

      program.eval('deploy');
      expect(indicators[0]!.message).toBe('Running deploy...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Done!']);
    });

    it('should skip progress when runtime has no progress factory', () => {
      const program = createPadrone('app').command('deploy', (c) => c.progress('Deploying...').action(() => 'ok'));

      const result = program.eval('deploy');
      expect(result.error).toBeUndefined();
      expect(result.result).toBe('ok');
    });

    it('should not start progress for commands without progress config', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('simple', (c) => c.action(() => 'ok'));

      program.eval('simple');
      expect(indicators).toHaveLength(0);
    });
  });

  describe('ctx.progress', () => {
    it('should expose auto-managed indicator on action context', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c.progress('Working...').action((_args, ctx) => {
            ctx.progress.update('halfway');
            return 'done';
          }),
        );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['update:halfway', 'succeed:']);
    });

    it('should be no-op when no progress config', () => {
      let called = false;
      const program = createPadrone('app').command('cmd', (c) =>
        c.action((_args, ctx) => {
          ctx.progress.update('msg');
          ctx.progress.succeed();
          ctx.progress.fail();
          ctx.progress.stop();
          called = true;
          return 'ok';
        }),
      );

      const result = program.eval('cmd');
      expect(result.result).toBe('ok');
      expect(called).toBe(true);
    });
  });

  describe('with interceptors', () => {
    it('should succeed progress when interceptors wrap execution', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .intercept({
          name: 'test-interceptor',
          execute: (_ctx, next) => next(),
        })
        .command('cmd', (c) => c.progress('Working...').action(() => 'done'));

      const result = program.eval('cmd');
      expect(result.result).toBe('done');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });

    it('should fail progress when interceptor throws', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .intercept({
          name: 'failing-interceptor',
          execute: () => {
            throw new Error('interceptor error');
          },
        })
        .command('cmd', (c) => c.progress('Working...').action(() => 'done'));

      const result = program.eval('cmd');
      expect(result.error).toBeDefined();
      expect(indicators[0]!.indicator.calls).toEqual(['fail:interceptor error']);
    });
  });

  describe('dynamic success/error callbacks', () => {
    it('should use dynamic success callback', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c
            .action(() => ({ version: '2.0' }))
            .progress({
              progress: 'Deploying...',
              success: (result) => `Deployed v${result.version}`,
            }),
        );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Deployed v2.0']);
    });

    it('should use dynamic error callback', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c
            .action(() => {
              throw new Error('oops');
            })
            .progress({
              progress: 'Deploying...',
              error: () => 'Custom fail message',
            }),
        );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Custom fail message']);
    });

    it('should support null from callbacks to suppress messages', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c
            .action(() => 'ok')
            .progress({
              progress: 'Working...',
              success: () => null,
            }),
        );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:null']);
    });

    it('should mix static and dynamic in same config', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c
            .action(() => 42)
            .progress({
              progress: 'Working...',
              success: (result) => `Result: ${result}`,
              error: 'Static error',
            }),
        );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Result: 42']);
    });
  });

  describe('callback returning { message, indicator } object', () => {
    it('should pass custom indicator from success callback', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c
            .action(() => ({ version: '2.0' }))
            .progress({
              progress: 'Deploying...',
              success: (result) => ({ message: `Deployed v${result.version}`, indicator: '🚀' }),
            }),
        );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Deployed v2.0[icon:🚀]']);
    });

    it('should pass custom indicator from error callback', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c
            .action(() => {
              throw new Error('oops');
            })
            .progress({
              progress: 'Deploying...',
              error: () => ({ message: 'Deploy crashed', indicator: '💥' }),
            }),
        );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Deploy crashed[icon:💥]']);
    });

    it('should support static { message, indicator } in success field', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c
            .action(() => 'ok')
            .progress({
              progress: 'Working...',
              success: { message: 'All good', indicator: '👍' },
            }),
        );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:All good[icon:👍]']);
    });

    it('should support null message in object to suppress output', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c
            .action(() => 'ok')
            .progress({
              progress: 'Working...',
              success: () => ({ message: null }),
            }),
        );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:null']);
    });

    it('should support empty string indicator to hide icon', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c
            .action(() => 'ok')
            .progress({
              progress: 'Working...',
              success: { message: 'Done', indicator: '' },
            }),
        );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Done[icon:]']);
    });
  });

  describe('validation phase progress', () => {
    it('should show validation message during async validation', async () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c
            .progress({ validation: 'Validating...', progress: 'Running...' })
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
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) => c.progress({ progress: 'Running...' }).action(() => 'done'));

      program.eval('cmd');
      // No explicit validation message → starts with progress message, no update call
      expect(indicators[0]!.message).toBe('Running...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });
  });

  describe('null message support', () => {
    it('should suppress succeed message when success is null', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) => c.progress({ progress: 'Working...', success: null }).action(() => 'ok'));

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:null']);
    });

    it('should suppress error message when error is null', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c.progress({ progress: 'Working...', error: null }).action(() => {
            throw new Error('boom');
          }),
        );

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:null']);
    });
  });

  describe('spinner options', () => {
    it('should pass spinner config to progress factory', () => {
      let receivedOptions: any;
      const factory = (_message: string, options?: any) => {
        receivedOptions = options;
        return {
          update() {},
          succeed() {},
          fail() {},
          stop() {},
          pause() {},
          resume() {},
        };
      };

      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) => c.progress({ progress: 'Working...', spinner: 'line' }).action(() => 'ok'));

      program.eval('cmd');
      expect(receivedOptions).toEqual({ spinner: 'line' });
    });

    it('should not pass spinner options when not configured', () => {
      let receivedOptions: any = 'NOT_CALLED';
      const factory = (_message: string, options?: any) => {
        receivedOptions = options;
        return {
          update() {},
          succeed() {},
          fail() {},
          stop() {},
          pause() {},
          resume() {},
        };
      };

      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) => c.progress('Working...').action(() => 'ok'));

      program.eval('cmd');
      expect(receivedOptions).toBeUndefined();
    });

    it('should pass spinner:false to disable spinner animation', () => {
      let receivedOptions: any;
      const factory = (_message: string, options?: any) => {
        receivedOptions = options;
        return {
          update() {},
          succeed() {},
          fail() {},
          stop() {},
          pause() {},
          resume() {},
        };
      };

      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) => c.progress({ progress: 'Working...', spinner: false }).action(() => 'ok'));

      program.eval('cmd');
      expect(receivedOptions).toEqual({ spinner: false });
    });
  });

  describe('lazy progress (manual usage without .progress())', () => {
    it('should create a real indicator on first ctx.progress.update() call', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c.action((_args, ctx) => {
            ctx.progress.update('doing work');
            return 'done';
          }),
        );

      program.eval('cmd');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toContain('update:doing work');
    });

    it('should auto-stop lazy indicator after execution', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c.action((_args, ctx) => {
            ctx.progress.update('working');
            return 'done';
          }),
        );

      program.eval('cmd');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['update:working', 'stop']);
    });

    it('should not create indicator if ctx.progress is never used', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) => c.action(() => 'done'));

      program.eval('cmd');
      expect(indicators).toHaveLength(0);
    });

    it('should be noop when runtime has no progress factory', () => {
      let called = false;
      const program = createPadrone('app').command('cmd', (c) =>
        c.action((_args, ctx) => {
          ctx.progress.update('test');
          called = true;
          return 'ok';
        }),
      );

      const result = program.eval('cmd');
      expect(result.result).toBe('ok');
      expect(called).toBe(true);
    });

    it('should auto-stop lazy indicator on async command completion', async () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c.async().action(async (_args, ctx) => {
            ctx.progress.update('async work');
            return 'done';
          }),
        );

      await program.eval('cmd');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['update:async work', 'stop']);
    });
  });
});
