import { describe, expect, it } from 'bun:test';
import { createPadrone, type PadroneProgressIndicator } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

function createMockProgress() {
  const indicators: { message: string; indicator: PadroneProgressIndicator & { calls: string[] } }[] = [];

  const factory = (message: string) => {
    const calls: string[] = [];
    const indicator = {
      calls,
      update: (msg: string) => calls.push(`update:${msg}`),
      succeed: (msg?: string) => calls.push(`succeed:${msg ?? ''}`),
      fail: (msg?: string) => calls.push(`fail:${msg ?? ''}`),
      stop: () => calls.push('stop'),
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume'),
    };
    indicators.push({ message, indicator });
    return indicator;
  };

  return { factory, indicators };
}

describe('progress', () => {
  createConsoleMocker();

  describe('auto-progress via configure()', () => {
    it('should start and succeed progress for a sync command', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) => c.configure({ progress: 'Deploying...' }).action(() => 'deployed'));

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
            .configure({ progress: 'Deploying...' })
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
          c.configure({ progress: 'Working...' }).action(() => {
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
          c.configure({ progress: 'Working...' }).action(async () => {
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
        .command('deploy', (c) => c.configure({ progress: true }).action(() => 'ok'));

      program.eval('deploy');
      expect(indicators[0]!.message).toBe('Running deploy...');
    });

    it('should use per-state messages from progress config object', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('deploy', (c) =>
          c.configure({ progress: { progress: 'Deploying...', success: 'Deployed!', error: 'Deploy failed' } }).action(() => 'ok'),
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
          c.configure({ progress: { progress: 'Deploying...', error: 'Deploy failed' } }).action(() => {
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
        .command('deploy', (c) => c.configure({ progress: { success: 'Done!' } }).action(() => 'ok'));

      program.eval('deploy');
      expect(indicators[0]!.message).toBe('Running deploy...');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:Done!']);
    });

    it('should skip progress when runtime has no progress factory', () => {
      const program = createPadrone('app').command('deploy', (c) => c.configure({ progress: 'Deploying...' }).action(() => 'ok'));

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

  describe('ctx.progress() manual control', () => {
    it('should provide progress on action context', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('fetch', (c) =>
          c.action((_args, ctx) => {
            const p = ctx.progress('Fetching...');
            p.update('50%');
            p.succeed('Done!');
            return 'fetched';
          }),
        );

      const result = program.eval('fetch');
      expect(result.result).toBe('fetched');
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.message).toBe('Fetching...');
      expect(indicators[0]!.indicator.calls).toEqual(['update:50%', 'succeed:Done!']);
    });

    it('should return no-op indicator when runtime has no progress factory', () => {
      let progressCalled = false;
      const program = createPadrone('app').command('cmd', (c) =>
        c.action((_args, ctx) => {
          const p = ctx.progress('test');
          p.update('msg');
          p.succeed();
          p.fail();
          p.stop();
          progressCalled = true;
          return 'ok';
        }),
      );

      const result = program.eval('cmd');
      expect(result.result).toBe('ok');
      expect(progressCalled).toBe(true);
    });

    it('should work alongside auto-progress', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('multi', (c) =>
          c.configure({ progress: 'Auto...' }).action((_args, ctx) => {
            const manual = ctx.progress('Manual...');
            manual.succeed('manual done');
            return 'ok';
          }),
        );

      program.eval('multi');
      // Auto-progress + manual progress = 2 indicators
      expect(indicators).toHaveLength(2);
      expect(indicators[0]!.message).toBe('Auto...');
      expect(indicators[1]!.message).toBe('Manual...');
    });
  });

  describe('with plugins', () => {
    it('should succeed progress when plugins wrap execution', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .use({
          name: 'test-plugin',
          execute: (ctx, next) => next(),
        })
        .command('cmd', (c) => c.configure({ progress: 'Working...' }).action(() => 'done'));

      const result = program.eval('cmd');
      expect(result.result).toBe('done');
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });

    it('should fail progress when plugin throws', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .use({
          name: 'failing-plugin',
          execute: () => {
            throw new Error('plugin error');
          },
        })
        .command('cmd', (c) => c.configure({ progress: 'Working...' }).action(() => 'done'));

      const result = program.eval('cmd');
      expect(result.error).toBeDefined();
      expect(indicators[0]!.indicator.calls).toEqual(['fail:plugin error']);
    });
  });

  describe('run() with ctx.progress()', () => {
    it('should provide progress on action context via run()', () => {
      const { factory, indicators } = createMockProgress();
      const program = createPadrone('app')
        .runtime({ progress: factory })
        .command('cmd', (c) =>
          c.arguments(z.object({ x: z.number() })).action((args, ctx) => {
            const p = ctx.progress('Processing...');
            p.succeed();
            return args.x * 2;
          }),
        );

      const result = program.run('cmd', { x: 5 });
      expect(result.result).toBe(10);
      expect(indicators).toHaveLength(1);
      expect(indicators[0]!.indicator.calls).toEqual(['succeed:']);
    });
  });
});
