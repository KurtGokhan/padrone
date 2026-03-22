import { describe, expect, it } from 'bun:test';
import { ActionError, ConfigError, createPadrone, PadroneError, RoutingError, ValidationError } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

describe('structured errors', () => {
  createConsoleMocker();

  describe('PadroneError base class', () => {
    it('should have default exitCode of 1', () => {
      const err = new PadroneError('test');
      expect(err.exitCode).toBe(1);
      expect(err.message).toBe('test');
      expect(err.name).toBe('PadroneError');
      expect(err.suggestions).toEqual([]);
    });

    it('should accept custom options', () => {
      const err = new PadroneError('test', {
        exitCode: 2,
        suggestions: ['try --help'],
        command: 'deploy',
        phase: 'execute',
      });
      expect(err.exitCode).toBe(2);
      expect(err.suggestions).toEqual(['try --help']);
      expect(err.command).toBe('deploy');
      expect(err.phase).toBe('execute');
    });

    it('should support cause chaining', () => {
      const cause = new Error('root cause');
      const err = new PadroneError('wrapper', { cause });
      expect(err.cause).toBe(cause);
    });

    it('should serialize to JSON', () => {
      const err = new PadroneError('test', {
        exitCode: 2,
        suggestions: ['try --help'],
        command: 'deploy',
        phase: 'execute',
      });
      const json = err.toJSON();
      expect(json).toEqual({
        name: 'PadroneError',
        message: 'test',
        exitCode: 2,
        suggestions: ['try --help'],
        command: 'deploy',
        phase: 'execute',
      });
    });

    it('should be instanceof Error', () => {
      const err = new PadroneError('test');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PadroneError);
    });
  });

  describe('RoutingError', () => {
    it('should default to parse phase', () => {
      const err = new RoutingError('not found');
      expect(err.name).toBe('RoutingError');
      expect(err.phase).toBe('parse');
      expect(err).toBeInstanceOf(PadroneError);
    });

    it('should be thrown for unknown commands', () => {
      const program = createPadrone('app').command('deploy', (c) => c.action(() => 'ok'));

      const result = program.eval('nonexistent');
      expect(result.error).toBeInstanceOf(RoutingError);
    });

    it('should carry suggestions for similar commands', () => {
      const program = createPadrone('app').command('deploy', (c) => c.action(() => 'ok'));

      const result = program.eval('deply');
      expect(result.error).toBeInstanceOf(RoutingError);
      const err = result.error as RoutingError;
      expect(err.suggestions).toContain('Did you mean "deploy"?');
    });

    it('should be thrown when command not found in run()', () => {
      const program = createPadrone('app').command('deploy', (c) => c.action(() => 'ok'));

      const result = program.run('nonexistent' as any, {});
      expect(result.error).toBeInstanceOf(RoutingError);
    });

    it('should be thrown when command has no action in run()', () => {
      const program = createPadrone('app').command('empty', (c) => c);

      const result = program.run('empty', undefined as any);
      expect(result.error).toBeInstanceOf(RoutingError);
      expect((result.error as Error).message).toContain('has no action');
    });
  });

  describe('ValidationError', () => {
    it('should carry issues and default to validate phase', () => {
      const issues = [{ path: ['url'], message: 'Invalid url' }];
      const err = new ValidationError('Validation failed', issues);
      expect(err.name).toBe('ValidationError');
      expect(err.phase).toBe('validate');
      expect(err.issues).toEqual(issues);
      expect(err).toBeInstanceOf(PadroneError);
    });

    it('should serialize issues to JSON', () => {
      const issues = [{ path: ['url' as PropertyKey], message: 'Invalid url' }];
      const err = new ValidationError('fail', issues);
      const json = err.toJSON();
      expect(json.issues).toEqual([{ path: ['url'], message: 'Invalid url' }]);
    });

    it('should be thrown by cli() on validation errors', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'test', 'fetch', '--url', 'not-a-url'];

      const p = createPadrone('test').command('fetch', (c) => c.arguments(z.object({ url: z.url() })).action((args) => args));

      const result = p.cli();
      expect(result.error).toBeInstanceOf(ValidationError);
      const err = result.error as ValidationError;
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.command).toBe('fetch');

      process.argv = originalArgv;
    });

    it('should NOT be thrown by eval() on validation errors (soft mode)', () => {
      const p = createPadrone('test').command('fetch', (c) => c.arguments(z.object({ url: z.url() })).action((args) => args));

      // eval returns soft result, not a throw
      const result = p.eval('fetch --url not-a-url');
      expect(result.argsResult?.issues).toBeDefined();
      expect(result.result).toBeUndefined();
    });
  });

  describe('ConfigError', () => {
    it('should default to config phase', () => {
      const err = new ConfigError('bad config');
      expect(err.name).toBe('ConfigError');
      expect(err.phase).toBe('config');
      expect(err).toBeInstanceOf(PadroneError);
    });
  });

  describe('ActionError', () => {
    it('should default to execute phase', () => {
      const err = new ActionError('action failed');
      expect(err.name).toBe('ActionError');
      expect(err.phase).toBe('execute');
      expect(err).toBeInstanceOf(PadroneError);
    });

    it('should be throwable from action handlers', () => {
      const program = createPadrone('app').command('deploy', (c) =>
        c.arguments(z.object({ env: z.string().optional() })).action((args) => {
          if (!args.env) {
            throw new ActionError('Missing environment', {
              exitCode: 1,
              suggestions: ['Use --env production or --env staging'],
            });
          }
          return `deployed to ${args.env}`;
        }),
      );

      const result = program.eval('deploy');
      expect(result.error).toBeInstanceOf(ActionError);
      const err = result.error as ActionError;
      expect(err.message).toBe('Missing environment');
      expect(err.exitCode).toBe(1);
      expect(err.suggestions).toContain('Use --env production or --env staging');
    });

    it('should propagate through eval without being swallowed', () => {
      const program = createPadrone('app').command('fail', (c) =>
        c.action(() => {
          throw new ActionError('intentional failure', { exitCode: 42 });
        }),
      );

      const result = program.eval('fail');
      expect(result.error).toBeInstanceOf(ActionError);
      expect((result.error as ActionError).exitCode).toBe(42);
    });
  });

  describe('error hierarchy', () => {
    it('all subclasses should be instanceof PadroneError', () => {
      expect(new RoutingError('r')).toBeInstanceOf(PadroneError);
      expect(new ValidationError('v', [])).toBeInstanceOf(PadroneError);
      expect(new ConfigError('c')).toBeInstanceOf(PadroneError);
      expect(new ActionError('a')).toBeInstanceOf(PadroneError);
    });

    it('all subclasses should be instanceof Error', () => {
      expect(new RoutingError('r')).toBeInstanceOf(Error);
      expect(new ValidationError('v', [])).toBeInstanceOf(Error);
      expect(new ConfigError('c')).toBeInstanceOf(Error);
      expect(new ActionError('a')).toBeInstanceOf(Error);
    });

    it('subclasses should not cross-match', () => {
      expect(new RoutingError('r')).not.toBeInstanceOf(ValidationError);
      expect(new ValidationError('v', [])).not.toBeInstanceOf(RoutingError);
      expect(new ConfigError('c')).not.toBeInstanceOf(ActionError);
      expect(new ActionError('a')).not.toBeInstanceOf(ConfigError);
    });
  });
});
