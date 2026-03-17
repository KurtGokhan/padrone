import { describe, expect, it } from 'bun:test';
import type { PadronePlugin } from 'padrone';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

describe('plugins', () => {
  createConsoleMocker();

  const makeProgram = () =>
    createPadrone('test')
      .command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      )
      .command('add', (c) => c.arguments(z.object({ a: z.coerce.number(), b: z.coerce.number() })).action((args) => args.a + args.b));

  describe('registration and chaining', () => {
    it('should return a new program for chaining (immutable builder)', () => {
      const program = makeProgram();
      const result = program.use({ name: 'test' });
      expect(result).not.toBe(program);
      // Should still be usable
      expect(result.eval('greet World').result).toBe('Hello, World!');
    });

    it('should allow multiple plugins via chaining', () => {
      const log: string[] = [];
      const result = makeProgram()
        .use({
          name: 'a',
          execute: (_ctx, next) => {
            log.push('a');
            return next();
          },
        })
        .use({
          name: 'b',
          execute: (_ctx, next) => {
            log.push('b');
            return next();
          },
        });

      result.eval('greet World');
      expect(log).toEqual(['a', 'b']);
    });
  });

  describe('execute phase', () => {
    it('should intercept handler execution', () => {
      const log: string[] = [];
      const plugin: PadronePlugin = {
        name: 'logger',
        execute: (ctx, next) => {
          log.push(`before:${ctx.command.path}`);
          const result = next();
          log.push('after');
          return result;
        },
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet World');

      expect(result.result).toBe('Hello, World!');
      expect(log).toEqual(['before:greet', 'after']);
    });

    it('should allow short-circuiting (not calling next)', () => {
      const plugin: PadronePlugin = {
        name: 'blocker',
        execute: (_ctx, _next) => {
          return { result: 'blocked' };
        },
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet World');

      expect(result.result).toBe('blocked');
    });

    it('should allow transforming the result', () => {
      const plugin: PadronePlugin = {
        name: 'upper',
        execute: (_ctx, next) => {
          const result = next();
          if (result instanceof Promise) return result;
          return { result: String(result.result).toUpperCase() };
        },
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet World');

      expect(result.result).toBe('HELLO, WORLD!');
    });

    it('should allow error handling via try/catch', () => {
      const errorProgram = createPadrone('test')
        .command('fail', (c) =>
          c.action(() => {
            throw new Error('boom');
          }),
        )
        .use({
          name: 'error-handler',
          execute: (_ctx, next) => {
            try {
              return next();
            } catch {
              return { result: 'caught' };
            }
          },
        });

      const result = errorProgram.eval('fail');
      expect(result.result as string).toBe('caught');
    });
  });

  describe('parse phase', () => {
    it('should provide input and root command in context', () => {
      let capturedInput: string | undefined;
      let capturedCommandName: string | undefined;

      const plugin: PadronePlugin = {
        name: 'parse-spy',
        parse: (ctx, next) => {
          capturedInput = ctx.input;
          capturedCommandName = ctx.command.name;
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet World');

      expect(capturedInput).toBe('greet World');
      expect(capturedCommandName).toBe('test');
    });

    it('should allow modifying input before routing', () => {
      const plugin: PadronePlugin = {
        name: 'alias',
        parse: (ctx, next) => {
          // Rewrite input
          if (ctx.input === 'hi World') {
            ctx.input = 'greet World';
          }
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('hi World');

      expect(result.result as string).toBe('Hello, World!');
    });
  });

  describe('validate phase', () => {
    it('should provide resolved command and raw args in context', () => {
      let capturedCommandPath: string | undefined;
      let capturedRawArgs: Record<string, unknown> | undefined;

      const plugin: PadronePlugin = {
        name: 'validate-spy',
        validate: (ctx, next) => {
          capturedCommandPath = ctx.command.path;
          capturedRawArgs = { ...ctx.rawArgs };
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('add --a=2 --b=3');

      expect(capturedCommandPath).toBe('add');
      expect(capturedRawArgs).toEqual({ a: '2', b: '3' });
    });

    it('should allow injecting args before validation', () => {
      const plugin: PadronePlugin = {
        name: 'default-name',
        validate: (ctx, next) => {
          if (ctx.command.path === 'greet' && !ctx.rawArgs.name && ctx.positionalArgs.length === 0) {
            ctx.positionalArgs = ['DefaultUser'];
          }
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet');

      expect(result.result).toBe('Hello, DefaultUser!');
    });
  });

  describe('state sharing', () => {
    it('should share state across phases within one execution', () => {
      const stateLog: Record<string, unknown>[] = [];

      const plugin: PadronePlugin = {
        name: 'state-test',
        parse: (ctx, next) => {
          ctx.state.startTime = 1;
          return next();
        },
        validate: (ctx, next) => {
          stateLog.push({ fromParse: ctx.state.startTime });
          ctx.state.validated = true;
          return next();
        },
        execute: (ctx, next) => {
          stateLog.push({ fromParse: ctx.state.startTime, validated: ctx.state.validated });
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet World');

      expect(stateLog).toEqual([{ fromParse: 1 }, { fromParse: 1, validated: true }]);
    });

    it('should create fresh state per execution', () => {
      const states: Record<string, unknown>[] = [];

      const plugin: PadronePlugin = {
        name: 'state-isolation',
        execute: (ctx, next) => {
          ctx.state.count = ((ctx.state.count as number) || 0) + 1;
          states.push({ ...ctx.state });
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet A');
      program.eval('greet B');

      // Each execution should start with fresh state
      expect(states).toEqual([{ count: 1 }, { count: 1 }]);
    });
  });

  describe('ordering', () => {
    it('should execute first-registered as outermost (before others, after others on return)', () => {
      const log: string[] = [];

      const pluginA: PadronePlugin = {
        name: 'A',
        execute: (_ctx, next) => {
          log.push('A:before');
          const result = next();
          log.push('A:after');
          return result;
        },
      };

      const pluginB: PadronePlugin = {
        name: 'B',
        execute: (_ctx, next) => {
          log.push('B:before');
          const result = next();
          log.push('B:after');
          return result;
        },
      };

      const program = makeProgram().use(pluginA).use(pluginB);
      program.eval('greet World');

      expect(log).toEqual(['A:before', 'B:before', 'B:after', 'A:after']);
    });

    it('should respect order parameter (lower = outermost)', () => {
      const log: string[] = [];

      const innerPlugin: PadronePlugin = {
        name: 'inner',
        order: 10,
        execute: (_ctx, next) => {
          log.push('inner:before');
          const result = next();
          log.push('inner:after');
          return result;
        },
      };

      const outerPlugin: PadronePlugin = {
        name: 'outer',
        order: -10,
        execute: (_ctx, next) => {
          log.push('outer:before');
          const result = next();
          log.push('outer:after');
          return result;
        },
      };

      // Register inner first, but outer has lower order so it should be outermost
      const program = makeProgram().use(innerPlugin).use(outerPlugin);
      program.eval('greet World');

      expect(log).toEqual(['outer:before', 'inner:before', 'inner:after', 'outer:after']);
    });

    it('should preserve registration order for same order value', () => {
      const log: string[] = [];

      const makePlugin = (name: string): PadronePlugin => ({
        name,
        order: 0,
        execute: (_ctx, next) => {
          log.push(`${name}:before`);
          const result = next();
          log.push(`${name}:after`);
          return result;
        },
      });

      const program = makeProgram().use(makePlugin('A')).use(makePlugin('B')).use(makePlugin('C'));
      program.eval('greet World');

      expect(log).toEqual(['A:before', 'B:before', 'C:before', 'C:after', 'B:after', 'A:after']);
    });
  });

  describe('command filtering', () => {
    it('should allow plugins to skip based on command path', () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'greet-only',
        execute: (ctx, next) => {
          if (ctx.command.path !== 'greet') return next();
          log.push(`intercepted:${ctx.command.path}`);
          return next();
        },
      };

      const program = makeProgram().use(plugin);

      program.eval('greet World');
      program.eval('add --a=1 --b=2');

      expect(log).toEqual(['intercepted:greet']);
    });
  });

  describe('run() integration', () => {
    it('should apply execute plugins to run()', () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'run-spy',
        execute: (ctx, next) => {
          log.push(`execute:${ctx.command.path}`);
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      const result = program.run('greet', { name: 'World' });

      expect(result.result).toBe('Hello, World!');
      expect(log).toEqual(['execute:greet']);
    });
  });

  describe('parse() integration', () => {
    it('should apply parse and validate plugins to parse()', () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'parse-spy',
        parse: (ctx, next) => {
          log.push(`parse:${ctx.input}`);
          return next();
        },
        validate: (ctx, next) => {
          log.push(`validate:${ctx.command.path}`);
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.parse('greet World');

      expect(log).toEqual(['parse:greet World', 'validate:greet']);
    });
  });

  describe('sync preservation', () => {
    it('should stay sync when all plugins are sync', () => {
      const plugin: PadronePlugin = {
        name: 'sync-plugin',
        execute: (_ctx, next) => next(),
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet World');

      // Should not be a Promise
      expect(result).not.toBeInstanceOf(Promise);
      expect(result.result).toBe('Hello, World!');
    });

    it('should become async when a plugin returns a Promise', async () => {
      const plugin: PadronePlugin = {
        name: 'async-plugin',
        execute: async (_ctx, next) => {
          const result = await next();
          return result;
        },
      };

      const program = makeProgram().use(plugin);
      const resultOrPromise = program.eval('greet World');

      expect(resultOrPromise).toBeInstanceOf(Promise);
      const result = await resultOrPromise;
      expect(result.result).toBe('Hello, World!');
    });
  });

  describe('no plugins (passthrough)', () => {
    it('should work normally without any plugins', () => {
      const program = makeProgram();
      const result = program.eval('greet World');
      expect(result.result).toBe('Hello, World!');
    });

    it('should work with plugins that have no handlers for the phase', () => {
      const plugin: PadronePlugin = {
        name: 'empty',
        // No parse, validate, or execute handlers
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet World');
      expect(result.result).toBe('Hello, World!');
    });
  });

  describe('multiple phases in one plugin', () => {
    it('should intercept all configured phases', () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'full-lifecycle',
        parse: (ctx, next) => {
          log.push(`parse:${ctx.input}`);
          return next();
        },
        validate: (ctx, next) => {
          log.push(`validate:${ctx.command.path}`);
          return next();
        },
        execute: (ctx, next) => {
          log.push(`execute:${ctx.command.path}`);
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet World');

      expect(log).toEqual(['parse:greet World', 'validate:greet', 'execute:greet']);
    });
  });

  describe('args mutation in execute context', () => {
    it('should allow modifying args before handler runs', () => {
      const plugin: PadronePlugin = {
        name: 'args-mutator',
        execute: (ctx, next) => {
          (ctx.args as Record<string, unknown>).name = 'Overridden';
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet World');

      expect(result.result).toBe('Hello, Overridden!');
    });
  });

  describe('start phase', () => {
    it('should run before parse phase', () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'lifecycle',
        start: (_ctx, next) => {
          log.push('start');
          return next();
        },
        parse: (_ctx, next) => {
          log.push('parse');
          return next();
        },
        execute: (_ctx, next) => {
          log.push('execute');
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet World');

      expect(log).toEqual(['start', 'parse', 'execute']);
    });

    it('should provide input and root command in context', () => {
      let capturedInput: string | undefined;
      let capturedCommandName: string | undefined;

      const plugin: PadronePlugin = {
        name: 'start-spy',
        start: (ctx, next) => {
          capturedInput = ctx.input;
          capturedCommandName = ctx.command.name;
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet World');

      expect(capturedInput).toBe('greet World');
      expect(capturedCommandName).toBe('test');
    });

    it('should allow short-circuiting the pipeline', () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'blocker',
        start: (_ctx, _next) => {
          log.push('start:blocked');
          return { command: {}, result: 'blocked' };
        },
        parse: (_ctx, next) => {
          log.push('parse');
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet World');

      expect(result.result).toBe('blocked');
      expect(log).toEqual(['start:blocked']);
    });

    it('should share state with other phases', () => {
      const stateLog: Record<string, unknown>[] = [];

      const plugin: PadronePlugin = {
        name: 'state-test',
        start: (ctx, next) => {
          ctx.state.initialized = true;
          return next();
        },
        execute: (ctx, next) => {
          stateLog.push({ initialized: ctx.state.initialized });
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet World');

      expect(stateLog).toEqual([{ initialized: true }]);
    });

    it('should support async start hooks', async () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'async-start',
        start: async (_ctx, next) => {
          log.push('async-start');
          const result = await next();
          log.push('async-start:after');
          return result;
        },
      };

      const program = makeProgram().use(plugin);
      const result = await program.eval('greet World');

      expect(result.result).toBe('Hello, World!');
      expect(log).toEqual(['async-start', 'async-start:after']);
    });

    it('should not run for parse() calls', () => {
      let startCalled = false;

      const plugin: PadronePlugin = {
        name: 'start-spy',
        start: (_ctx, next) => {
          startCalled = true;
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.parse('greet World');

      expect(startCalled).toBe(false);
    });

    it('should not run for run() calls', () => {
      let startCalled = false;

      const plugin: PadronePlugin = {
        name: 'start-spy',
        start: (_ctx, next) => {
          startCalled = true;
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.run('greet', { name: 'World' });

      expect(startCalled).toBe(false);
    });
  });

  describe('error phase', () => {
    it('should catch errors from the pipeline', () => {
      const errorProgram = createPadrone('test')
        .command('fail', (c) =>
          c.action(() => {
            throw new Error('boom');
          }),
        )
        .use({
          name: 'error-handler',
          error: (ctx) => {
            return { error: undefined, result: `caught: ${(ctx.error as Error).message}` };
          },
        });

      const result = errorProgram.eval('fail');
      expect(result.result as string).toBe('caught: boom');
    });

    it('should allow transforming errors', () => {
      const errorProgram = createPadrone('test')
        .command('fail', (c) =>
          c.action(() => {
            throw new Error('original');
          }),
        )
        .use({
          name: 'transformer',
          error: (ctx, _next) => {
            return { error: new Error(`transformed: ${(ctx.error as Error).message}`) };
          },
        });

      expect(() => errorProgram.eval('fail')).toThrow('transformed: original');
    });

    it('should pass to next error handler via next()', () => {
      const log: string[] = [];

      const errorProgram = createPadrone('test')
        .command('fail', (c) =>
          c.action(() => {
            throw new Error('boom');
          }),
        )
        .use({
          name: 'outer',
          error: (_ctx, next) => {
            log.push('outer:before');
            const result = next();
            log.push('outer:after');
            return result;
          },
        })
        .use({
          name: 'inner',
          error: (_ctx, _next) => {
            log.push('inner:suppress');
            return { error: undefined, result: 'suppressed' };
          },
        });

      const result = errorProgram.eval('fail');
      expect(result.result as string).toBe('suppressed');
      expect(log).toEqual(['outer:before', 'inner:suppress', 'outer:after']);
    });

    it('should re-throw if no error handler suppresses', () => {
      const log: string[] = [];

      const errorProgram = createPadrone('test')
        .command('fail', (c) =>
          c.action(() => {
            throw new Error('boom');
          }),
        )
        .use({
          name: 'logger',
          error: (ctx, next) => {
            log.push(`logged: ${(ctx.error as Error).message}`);
            return next();
          },
        });

      expect(() => errorProgram.eval('fail')).toThrow('boom');
      expect(log).toEqual(['logged: boom']);
    });

    it('should not run when pipeline succeeds', () => {
      let errorCalled = false;

      const program = makeProgram().use({
        name: 'error-spy',
        error: (_ctx, next) => {
          errorCalled = true;
          return next();
        },
      });

      program.eval('greet World');
      expect(errorCalled).toBe(false);
    });

    it('should handle async errors', async () => {
      const errorProgram = createPadrone('test')
        .command('fail', (c) =>
          c.action(async () => {
            throw new Error('async-boom');
          }),
        )
        .use({
          name: 'error-handler',
          error: (ctx, _next) => {
            return { error: undefined, result: `caught: ${(ctx.error as Error).message}` };
          },
        });

      const result = await errorProgram.eval('fail');
      expect(result.result as unknown as string).toBe('caught: async-boom');
    });
  });

  describe('shutdown phase', () => {
    it('should run after successful execution', () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'shutdown-spy',
        execute: (_ctx, next) => {
          log.push('execute');
          return next();
        },
        shutdown: (ctx, next) => {
          log.push(`shutdown:result=${(ctx.result as any)?.result}`);
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet World');

      expect(log).toEqual(['execute', 'shutdown:result=Hello, World!']);
    });

    it('should run after errors (with error in context)', () => {
      const log: string[] = [];

      const errorProgram = createPadrone('test')
        .command('fail', (c) =>
          c.action(() => {
            throw new Error('boom');
          }),
        )
        .use({
          name: 'lifecycle',
          shutdown: (ctx, next) => {
            log.push(`shutdown:error=${(ctx.error as Error)?.message}`);
            return next();
          },
        });

      expect(() => errorProgram.eval('fail')).toThrow('boom');
      expect(log).toEqual(['shutdown:error=boom']);
    });

    it('should run after error phase suppresses an error', () => {
      const log: string[] = [];

      const errorProgram = createPadrone('test')
        .command('fail', (c) =>
          c.action(() => {
            throw new Error('boom');
          }),
        )
        .use({
          name: 'lifecycle',
          error: (_ctx, _next) => {
            log.push('error:suppress');
            return { error: undefined, result: 'recovered' };
          },
          shutdown: (ctx, next) => {
            log.push(`shutdown:error=${ctx.error}:result=${(ctx.result as any)?.result}`);
            return next();
          },
        });

      const result = errorProgram.eval('fail');
      expect(result.result as string).toBe('recovered');
      expect(log).toEqual(['error:suppress', 'shutdown:error=undefined:result=recovered']);
    });

    it('should respect onion ordering', () => {
      const log: string[] = [];

      const program = makeProgram()
        .use({
          name: 'outer',
          shutdown: (_ctx, next) => {
            log.push('outer:before');
            next();
            log.push('outer:after');
          },
        })
        .use({
          name: 'inner',
          shutdown: (_ctx, next) => {
            log.push('inner');
            next();
          },
        });

      program.eval('greet World');
      expect(log).toEqual(['outer:before', 'inner', 'outer:after']);
    });

    it('should support async shutdown', async () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'async-shutdown',
        shutdown: async (_ctx, next) => {
          log.push('shutdown');
          await next();
        },
      };

      const program = makeProgram().use(plugin);
      const result = await program.eval('greet World');

      expect(result.result).toBe('Hello, World!');
      expect(log).toEqual(['shutdown']);
    });
  });

  describe('full lifecycle', () => {
    it('should run all phases in order: start → parse → validate → execute → shutdown', () => {
      const log: string[] = [];

      const plugin: PadronePlugin = {
        name: 'full',
        start: (_ctx, next) => {
          log.push('start');
          return next();
        },
        parse: (_ctx, next) => {
          log.push('parse');
          return next();
        },
        validate: (_ctx, next) => {
          log.push('validate');
          return next();
        },
        execute: (_ctx, next) => {
          log.push('execute');
          return next();
        },
        shutdown: (_ctx, next) => {
          log.push('shutdown');
          return next();
        },
      };

      const program = makeProgram().use(plugin);
      program.eval('greet World');

      expect(log).toEqual(['start', 'parse', 'validate', 'execute', 'shutdown']);
    });

    it('should run start → error → shutdown on pipeline failure', () => {
      const log: string[] = [];

      const program = createPadrone('test')
        .command('fail', (c) =>
          c.action(() => {
            throw new Error('boom');
          }),
        )
        .use({
          name: 'full',
          start: (_ctx, next) => {
            log.push('start');
            return next();
          },
          error: (ctx, _next) => {
            log.push(`error:${(ctx.error as Error).message}`);
            return { error: undefined, result: 'recovered' };
          },
          shutdown: (_ctx, next) => {
            log.push('shutdown');
            return next();
          },
        });

      const result = program.eval('fail');
      expect(result.result as string).toBe('recovered');
      expect(log).toEqual(['start', 'error:boom', 'shutdown']);
    });

    it('should preserve sync when all hooks are sync', () => {
      const plugin: PadronePlugin = {
        name: 'sync-lifecycle',
        start: (_ctx, next) => next(),
        shutdown: (_ctx, next) => next(),
      };

      const program = makeProgram().use(plugin);
      const result = program.eval('greet World');

      expect(result).not.toBeInstanceOf(Promise);
      expect(result.result).toBe('Hello, World!');
    });
  });

  describe('subcommand plugins', () => {
    it('should apply subcommand plugin only to that command', () => {
      const log: string[] = [];

      const program = createPadrone('test')
        .command('greet', (c) =>
          c
            .arguments(z.object({ name: z.string() }), { positional: ['name'] })
            .action((args) => `Hello, ${args.name}!`)
            .use({
              name: 'greet-only',
              execute: (ctx, next) => {
                log.push(`greet-plugin:${ctx.command.path}`);
                return next();
              },
            }),
        )
        .command('add', (c) => c.arguments(z.object({ a: z.coerce.number(), b: z.coerce.number() })).action((args) => args.a + args.b));

      program.eval('greet World');
      program.eval('add --a=1 --b=2');

      expect(log).toEqual(['greet-plugin:greet']);
    });

    it('should inherit program plugins and compose with subcommand plugins', () => {
      const log: string[] = [];

      const program = createPadrone('test')
        .command('greet', (c) =>
          c
            .arguments(z.object({ name: z.string() }), { positional: ['name'] })
            .action((args) => `Hello, ${args.name}!`)
            .use({
              name: 'sub-plugin',
              execute: (_ctx, next) => {
                log.push('sub:before');
                const r = next();
                log.push('sub:after');
                return r;
              },
            }),
        )
        .use({
          name: 'root-plugin',
          execute: (_ctx, next) => {
            log.push('root:before');
            const r = next();
            log.push('root:after');
            return r;
          },
        });

      program.eval('greet World');

      // Root plugin is outermost, subcommand plugin is innermost
      expect(log).toEqual(['root:before', 'sub:before', 'sub:after', 'root:after']);
    });

    it('should apply subcommand validate plugin', () => {
      let intercepted = false;

      const program = createPadrone('test').command('greet', (c) =>
        c
          .arguments(z.object({ name: z.string() }), { positional: ['name'] })
          .action((args) => `Hello, ${args.name}!`)
          .use({
            name: 'validate-spy',
            validate: (ctx, next) => {
              intercepted = true;
              expect(ctx.command.path).toBe('greet');
              return next();
            },
          }),
      );

      const result = program.eval('greet World');
      expect(result.result).toBe('Hello, World!');
      expect(intercepted).toBe(true);
    });

    it('should not apply subcommand parse plugin (parse is root-only)', () => {
      let parseCalled = false;

      const program = createPadrone('test').command('greet', (c) =>
        c
          .arguments(z.object({ name: z.string() }), { positional: ['name'] })
          .action((args) => `Hello, ${args.name}!`)
          .use({
            name: 'sub-parse',
            parse: (_ctx, next) => {
              parseCalled = true;
              return next();
            },
          }),
      );

      const result = program.eval('greet World');
      expect(result.result).toBe('Hello, World!');
      expect(parseCalled).toBe(false);
    });

    it('should work with nested subcommands', () => {
      const log: string[] = [];

      const program = createPadrone('test')
        .command('db', (c) =>
          c
            .use({
              name: 'db-plugin',
              execute: (_ctx, next) => {
                log.push('db');
                return next();
              },
            })
            .command('migrate', (sub) =>
              sub
                .action(() => 'migrated')
                .use({
                  name: 'migrate-plugin',
                  execute: (_ctx, next) => {
                    log.push('migrate');
                    return next();
                  },
                }),
            ),
        )
        .use({
          name: 'root-plugin',
          execute: (_ctx, next) => {
            log.push('root');
            return next();
          },
        });

      const result = program.eval('db migrate');
      expect(result.result).toBe('migrated');
      // Root → db → migrate (outermost to innermost)
      expect(log).toEqual(['root', 'db', 'migrate']);
    });
  });
});
