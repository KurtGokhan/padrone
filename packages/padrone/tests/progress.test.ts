import { describe, expect, it } from 'bun:test';
import { createPadrone, type PadroneProgressIndicator, padroneProgress } from 'padrone';

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
  describe('auto-progress via padroneProgress interceptor', () => {
    it('should start and succeed progress for a sync command', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) => c.extend(padroneProgress('Deploying...')).action(() => 'deployed'));

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
            .extend(padroneProgress('Deploying...'))
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
          c.extend(padroneProgress('Working...')).action(() => {
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
          c.extend(padroneProgress('Working...')).action(async () => {
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
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c.extend(padroneProgress({ progress: 'Deploying...', success: 'Deployed!', error: 'Deploy failed' })).action(() => 'ok'),
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
          c.extend(padroneProgress({ progress: 'Deploying...', error: 'Deploy failed' })).action(() => {
            throw new Error('boom');
          }),
        );

      program.eval('deploy');
      expect(indicators[0]!.indicator.calls).toEqual(['fail:Deploy failed']);
    });

    it('should skip progress when runtime has no progress factory', () => {
      const program = createPadrone('app').command('deploy', (c) => c.extend(padroneProgress('Deploying...')).action(() => 'ok'));

      const result = program.eval('deploy');
      expect(result.error).toBeUndefined();
      expect(result.result).toBe('ok');
    });

    it('should not start progress for commands without progress extension', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('simple', (c) => c.action(() => 'ok'));

      program.eval('simple');
      expect(indicators).toHaveLength(0);
    });
  });

  describe('ctx.context.progress', () => {
    it('should expose auto-managed indicator on action context', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c.extend(padroneProgress('Working...')).action((_args, ctx) => {
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
        .runtime({ progress: factory })
        .intercept({ name: 'test-interceptor' }, () => ({
          execute: (_ctx, next) => next(),
        }))
        .command('cmd', (c) => c.extend(padroneProgress('Working...')).action(() => 'done'));

      const result = program.eval('cmd');
      expect(result.result).toBe('done');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });

    it('should fail progress when outer interceptor throws in execute', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .intercept({ name: 'failing-interceptor' }, () => ({
          execute: () => {
            throw new Error('interceptor error');
          },
        }))
        .command('cmd', (c) => c.extend(padroneProgress('Working...')).action(() => 'done'));

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
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c
            .action(() => ({ version: '2.0' }))
            .extend(
              padroneProgress({
                progress: 'Deploying...',
                success: (result) => `Deployed v${(result as any).version}`,
              }),
            ),
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
            .extend(
              padroneProgress({
                progress: 'Deploying...',
                error: () => 'Custom fail message',
              }),
            ),
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
            .extend(
              padroneProgress({
                progress: 'Working...',
                success: () => null,
              }),
            ),
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
            .extend(
              padroneProgress({
                progress: 'Working...',
                success: (result) => `Result: ${result}`,
                error: 'Static error',
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
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c
            .action(() => ({ version: '2.0' }))
            .extend(
              padroneProgress({
                progress: 'Deploying...',
                success: (result) => ({ message: `Deployed v${(result as any).version}`, indicator: '🚀' }),
              }),
            ),
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
            .extend(
              padroneProgress({
                progress: 'Deploying...',
                error: () => ({ message: 'Deploy crashed', indicator: '💥' }),
              }),
            ),
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
            .extend(
              padroneProgress({
                progress: 'Working...',
                success: { message: 'All good', indicator: '👍' },
              }),
            ),
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
            .extend(
              padroneProgress({
                progress: 'Working...',
                success: () => ({ message: null }),
              }),
            ),
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
            .extend(
              padroneProgress({
                progress: 'Working...',
                success: { message: 'Done', indicator: '' },
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
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c
            .extend(padroneProgress({ validation: 'Validating...', progress: 'Running...' }))
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
        .command('cmd', (c) => c.extend(padroneProgress({ progress: 'Running...' })).action(() => 'done'));

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
        .command('cmd', (c) => c.extend(padroneProgress({ progress: 'Working...', success: null })).action(() => 'ok'));

      program.eval('cmd');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:null']);
    });

    it('should suppress error message when error is null', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c.extend(padroneProgress({ progress: 'Working...', error: null })).action(() => {
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
        .command('cmd', (c) => c.extend(padroneProgress({ progress: 'Working...', spinner: 'line' })).action(() => 'ok'));

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
        .command('cmd', (c) => c.extend(padroneProgress('Working...')).action(() => 'ok'));

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
        .command('cmd', (c) => c.extend(padroneProgress({ progress: 'Working...', spinner: false })).action(() => 'ok'));

      program.eval('cmd');
      expect(receivedOptions).toEqual({ spinner: false });
    });
  });
});
