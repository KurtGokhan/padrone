import { describe, expect, it, mock } from 'bun:test';
import { createPadrone, padroneTiming } from 'padrone';

describe('timing', () => {
  it('should not output timing when --time is not passed', () => {
    const error = mock();
    const program = createPadrone('test')
      .runtime({ error })
      .extend(padroneTiming())
      .command('greet', (c) => c.action(() => 'hello'));

    program.eval('greet');
    expect(error).not.toHaveBeenCalled();
  });

  it('should output timing when --time is passed', async () => {
    const error = mock();
    const program = createPadrone('test')
      .runtime({ error })
      .extend(padroneTiming())
      .command('greet', (c) => c.action(() => 'hello'));

    await program.eval('greet --time');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toMatch(/\nDone in \d/);
  });

  it('should output timing when --timing is passed', async () => {
    const error = mock();
    const program = createPadrone('test')
      .runtime({ error })
      .extend(padroneTiming())
      .command('greet', (c) => c.action(() => 'hello'));

    await program.eval('greet --timing');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toMatch(/\nDone in \d/);
  });

  it('should not output timing when --no-time is passed', async () => {
    const error = mock();
    const program = createPadrone('test')
      .runtime({ error })
      .extend(padroneTiming())
      .command('greet', (c) => c.action(() => 'hello'));

    await program.eval('greet --no-time');
    expect(error).not.toHaveBeenCalled();
  });

  it('should not treat --time as a command argument', async () => {
    const error = mock();
    const program = createPadrone('test')
      .runtime({ error })
      .extend(padroneTiming())
      .command('greet', (c) => c.action(() => 'hello'));

    const result = await program.eval('greet --time');
    expect(result.result).toBe('hello');
  });

  it('should output timing by default when enabled option is true', async () => {
    const error = mock();
    const program = createPadrone('test')
      .runtime({ error })
      .extend(padroneTiming({ enabled: true }))
      .command('greet', (c) => c.action(() => 'hello'));

    await program.eval('greet');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toMatch(/\nDone in \d/);
  });

  it('should disable timing with --no-time when enabled by default', async () => {
    const error = mock();
    const program = createPadrone('test')
      .runtime({ error })
      .extend(padroneTiming({ enabled: true }))
      .command('greet', (c) => c.action(() => 'hello'));

    await program.eval('greet --no-time');
    expect(error).not.toHaveBeenCalled();
  });

  it('should format milliseconds', async () => {
    const error = mock();
    const program = createPadrone('test')
      .runtime({ error })
      .extend(padroneTiming())
      .command('fast', (c) => c.action(() => 'done'));

    await program.eval('fast --time');
    expect(error).toHaveBeenCalledTimes(1);
    // Fast command should complete in <1s, so expect ms or s format
    expect(error.mock.calls[0]![0]).toMatch(/\nDone in \d+(\.\d+)?(ms|s)/);
  });
});
