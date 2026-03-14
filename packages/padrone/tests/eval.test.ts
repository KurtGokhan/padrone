import { describe, expect, it, mock } from 'bun:test';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

describe('eval', () => {
  createConsoleMocker();

  const program = createPadrone('test')
    .command('greet', (c) => c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`))
    .command('add', (c) => c.arguments(z.object({ a: z.coerce.number(), b: z.coerce.number() })).action((args) => args.a + args.b))
    .command('fetch', (c) => c.arguments(z.object({ url: z.url() })).action((args) => args.url));

  describe('command execution', () => {
    it('should execute a command with positional args', () => {
      const result = program.eval('greet World');
      expect(result.command.path).toBe('greet');
      expect(result.args?.name).toBe('World');
      expect(result.result).toBe('Hello, World!');
    });

    it('should execute a command with named args', () => {
      const result = program.eval('add --a=2 --b=3');
      expect(result.result).toBe(5);
    });

    it('should handle help flag', () => {
      const result = program.eval('--help');
      expect(result.result).toBeDefined();
      expect(typeof result.result).toBe('string');
    });

    it('should handle version flag', () => {
      const versionedProgram = createPadrone('test')
        .configure({ version: '1.0.0' })
        .command('greet', (c) => c.action(() => 'hi'));

      const result = versionedProgram.eval('--version');
      expect(result.result as unknown).toBe('1.0.0');
    });

    it('should handle help for specific command', () => {
      const result = program.eval('help greet');
      expect(typeof result.result).toBe('string');
      expect(result.result as string).toContain('greet');
    });
  });

  describe('soft error handling', () => {
    it('should return result with issues on validation error instead of throwing', () => {
      const result = program.eval('fetch --url not-a-url');

      expect(result.argsResult?.issues).toBeDefined();
      expect(result.args).toBeUndefined();
      expect(result.result).toBeUndefined();
    });

    it('should not call handler when validation fails', () => {
      const handler = mock((args: any) => args);
      const p = createPadrone('test').command('cmd', (c) => c.arguments(z.object({ url: z.url() })).action(handler));

      p.eval('cmd --url invalid');

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not print help or error output on validation failure', () => {
      const errors: string[] = [];
      const output: string[] = [];
      const p = createPadrone('test')
        .runtime({ error: (msg) => errors.push(msg), output: (msg) => output.push(msg) })
        .command('cmd', (c) => c.arguments(z.object({ url: z.url() })).action((args) => args));

      p.eval('cmd --url invalid');

      // eval should NOT print error + help like cli() does
      expect(errors).toHaveLength(0);
    });
  });

  describe('behavioral difference from cli()', () => {
    it('cli() without input throws on validation error, eval() does not', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'test', 'fetch', '--url', 'not-a-url'];

      const p = createPadrone('test').command('fetch', (c) => c.arguments(z.object({ url: z.url() })).action((args) => args));

      // cli() without input: hard error
      try {
        p.cli();
        expect.unreachable('Expected cli() to throw');
      } catch (e) {
        expect((e as Error).message).toContain('Validation error');
      } finally {
        process.argv = originalArgv;
      }

      // eval(): soft error
      const result = p.eval('fetch --url not-a-url');
      expect(result.argsResult?.issues).toBeDefined();
      expect(result.result).toBeUndefined();
    });

    it('eval() returns soft errors while cli() throws', () => {
      // eval: soft error — returns result with issues
      const evalResult = program.eval('fetch --url not-a-url');
      expect(evalResult.argsResult?.issues).toBeDefined();
      expect(evalResult.result).toBeUndefined();
    });
  });
});
