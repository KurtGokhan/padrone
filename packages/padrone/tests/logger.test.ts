import { describe, expect, it } from 'bun:test';
import { createPadrone, padroneLogger } from 'padrone';

function createCapture() {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    runtime: {
      output: (...args: unknown[]) => output.push(args.map(String).join(' ')),
      error: (text: string) => errors.push(text),
    },
  };
}

describe('logger', () => {
  it('should inject logger into context', () => {
    const { runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger())
      .command('test', (c) =>
        c.action((_args, ctx) => {
          expect(ctx.context.logger).toBeDefined();
          expect(typeof ctx.context.logger.info).toBe('function');
          expect(typeof ctx.context.logger.debug).toBe('function');
          expect(typeof ctx.context.logger.warn).toBe('function');
          expect(typeof ctx.context.logger.error).toBe('function');
          expect(typeof ctx.context.logger.child).toBe('function');
          return 'ok';
        }),
      );

    const result = program.eval('test');
    expect(result.error).toBeUndefined();
    expect(result.result).toBe('ok');
  });

  it('should respect default log level (info)', () => {
    const { output, errors, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger())
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.debug('hidden');
          ctx.context.logger.info('visible');
          ctx.context.logger.warn('also visible');
          ctx.context.logger.error('error visible');
        }),
      );

    program.eval('test');
    expect(output).toEqual(['[INFO] visible']);
    expect(errors).toEqual(['[WARN] also visible', '[ERROR] error visible']);
  });

  it('should show debug messages when level is debug', () => {
    const { output, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'debug' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.debug('debug msg');
          ctx.context.logger.info('info msg');
        }),
      );

    program.eval('test');
    expect(output).toEqual(['[DEBUG] debug msg', '[INFO] info msg']);
  });

  it('should suppress all messages when level is silent', () => {
    const { output, errors, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'silent' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.debug('nope');
          ctx.context.logger.info('nope');
          ctx.context.logger.warn('nope');
          ctx.context.logger.error('nope');
        }),
      );

    program.eval('test');
    expect(output).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('should only show error when level is error', () => {
    const { output, errors, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'error' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.info('hidden');
          ctx.context.logger.warn('hidden');
          ctx.context.logger.error('shown');
        }),
      );

    program.eval('test');
    expect(output).toEqual([]);
    expect(errors).toEqual(['[ERROR] shown']);
  });

  it('should support prefix', () => {
    const { output, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'info', prefix: '[my-app]' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.info('hello');
        }),
      );

    program.eval('test');
    expect(output).toEqual(['[INFO] [my-app] hello']);
  });

  it('should support timestamps', () => {
    const { output, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'info', timestamps: true }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.info('hello');
        }),
      );

    program.eval('test');
    expect(output).toHaveLength(1);
    // Should contain an ISO timestamp
    expect(output[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] hello$/);
  });

  it('should support child loggers with labels', () => {
    const { output, errors, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'debug' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          const db = ctx.context.logger.child('db');
          db.debug('connecting');
          db.info('connected');
          db.warn('slow query');
          db.error('connection lost');
        }),
      );

    program.eval('test');
    expect(output).toEqual(['[DEBUG] [db] connecting', '[INFO] [db] connected']);
    expect(errors).toEqual(['[WARN] [db] slow query', '[ERROR] [db] connection lost']);
  });

  it('should support nested child loggers', () => {
    const { output, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'info' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          const db = ctx.context.logger.child('db');
          const pool = db.child('pool');
          pool.info('acquired connection');
        }),
      );

    program.eval('test');
    expect(output).toEqual(['[INFO] [db] [pool] acquired connection']);
  });

  it('should serialize non-string arguments as JSON', () => {
    const { output, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'info' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.info('data:', { key: 'value' });
        }),
      );

    program.eval('test');
    expect(output).toEqual(['[INFO] data: {"key":"value"}']);
  });

  it('should expose the current log level', () => {
    const { runtime } = createCapture();
    let capturedLevel: string | undefined;
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'warn' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          capturedLevel = ctx.context.logger.level;
        }),
      );

    program.eval('test');
    expect(capturedLevel).toBe('warn');
  });

  it('should preserve child logger level from parent', () => {
    const { runtime } = createCapture();
    let capturedLevel: string | undefined;
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'error' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          const child = ctx.context.logger.child('sub');
          capturedLevel = child.level;
        }),
      );

    program.eval('test');
    expect(capturedLevel).toBe('error');
  });

  it('should show trace messages when level is trace', () => {
    const { output, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'trace' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.trace('trace msg');
          ctx.context.logger.debug('debug msg');
          ctx.context.logger.info('info msg');
        }),
      );

    program.eval('test');
    expect(output).toEqual(['[TRACE] trace msg', '[DEBUG] debug msg', '[INFO] info msg']);
  });

  it('should hide trace messages at debug level', () => {
    const { output, runtime } = createCapture();
    const program = createPadrone('app')
      .runtime(runtime)
      .extend(padroneLogger({ level: 'debug' }))
      .command('test', (c) =>
        c.action((_args, ctx) => {
          ctx.context.logger.trace('hidden');
          ctx.context.logger.debug('shown');
        }),
      );

    program.eval('test');
    expect(output).toEqual(['[DEBUG] shown']);
  });

  describe('CLI flag overrides', () => {
    it('should set trace level with --trace', () => {
      const { output, runtime } = createCapture();
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger())
        .command('test', (c) =>
          c.action((_args, ctx) => {
            ctx.context.logger.trace('trace msg');
            ctx.context.logger.debug('debug msg');
          }),
        );

      program.eval('test --trace');
      expect(output).toEqual(['[TRACE] trace msg', '[DEBUG] debug msg']);
    });

    it('should set debug level with --verbose', () => {
      const { output, runtime } = createCapture();
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger())
        .command('test', (c) =>
          c.action((_args, ctx) => {
            ctx.context.logger.debug('debug msg');
          }),
        );

      program.eval('test --verbose');
      expect(output).toEqual(['[DEBUG] debug msg']);
    });

    it('should set debug level with --debug', () => {
      const { output, runtime } = createCapture();
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger())
        .command('test', (c) =>
          c.action((_args, ctx) => {
            ctx.context.logger.debug('seen');
          }),
        );

      program.eval('test --debug');
      expect(output).toEqual(['[DEBUG] seen']);
    });

    it('should set silent level with --silent', () => {
      const { output, errors, runtime } = createCapture();
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger({ level: 'debug' }))
        .command('test', (c) =>
          c.action((_args, ctx) => {
            ctx.context.logger.debug('nope');
            ctx.context.logger.error('nope');
          }),
        );

      program.eval('test --silent');
      expect(output).toEqual([]);
      expect(errors).toEqual([]);
    });

    it('should set silent level with --quiet', () => {
      const { output, errors, runtime } = createCapture();
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger())
        .command('test', (c) =>
          c.action((_args, ctx) => {
            ctx.context.logger.info('nope');
            ctx.context.logger.error('nope');
          }),
        );

      program.eval('test --quiet');
      expect(output).toEqual([]);
      expect(errors).toEqual([]);
    });

    it('should set explicit level with --log-level=warn', () => {
      const { output, errors, runtime } = createCapture();
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger())
        .command('test', (c) =>
          c.action((_args, ctx) => {
            ctx.context.logger.info('hidden');
            ctx.context.logger.warn('shown');
            ctx.context.logger.error('shown');
          }),
        );

      program.eval('test --log-level=warn');
      expect(output).toEqual([]);
      expect(errors).toEqual(['[WARN] shown', '[ERROR] shown']);
    });

    it('should override config level with CLI flag', () => {
      const { output, runtime } = createCapture();
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger({ level: 'error' }))
        .command('test', (c) =>
          c.action((_args, ctx) => {
            ctx.context.logger.debug('seen via --verbose');
          }),
        );

      program.eval('test --verbose');
      expect(output).toEqual(['[DEBUG] seen via --verbose']);
    });

    it('should reflect CLI-overridden level in logger.level', () => {
      const { runtime } = createCapture();
      let capturedLevel: string | undefined;
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger({ level: 'info' }))
        .command('test', (c) =>
          c.action((_args, ctx) => {
            capturedLevel = ctx.context.logger.level;
          }),
        );

      program.eval('test --verbose');
      expect(capturedLevel).toBe('debug');
    });

    it('should not pass --verbose to the command args', () => {
      const { runtime } = createCapture();
      let rawResult: unknown;
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger())
        .command('test', (c) =>
          c.action((args) => {
            rawResult = args;
          }),
        );

      program.eval('test --verbose');
      expect(rawResult).toEqual({});
    });

    it('should ignore --no-verbose (negated flag)', () => {
      const { output, runtime } = createCapture();
      const program = createPadrone('app')
        .runtime(runtime)
        .extend(padroneLogger())
        .command('test', (c) =>
          c.action((_args, ctx) => {
            ctx.context.logger.debug('hidden');
            ctx.context.logger.info('shown');
          }),
        );

      program.eval('test --no-verbose');
      expect(output).toEqual(['[INFO] shown']);
    });
  });
});
