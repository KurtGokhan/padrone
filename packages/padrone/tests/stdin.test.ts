import { describe, expect, it } from 'bun:test';
import { createPadrone } from 'padrone';
import { testCli } from 'padrone/test';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

describe('stdin', () => {
  createConsoleMocker();

  describe('text mode (default)', () => {
    const program = createPadrone('test').command('process', (c) =>
      c.arguments(z.object({ data: z.string() }), { stdin: 'data' }).action((args) => `processed: ${args.data}`),
    );

    it('should read stdin as text into the specified field', async () => {
      const result = await testCli(program).stdin('hello world').run('process');

      expect(result.result).toBe('processed: hello world');
      expect(result.args).toEqual({ data: 'hello world' });
    });

    it('should allow CLI flag to override stdin', async () => {
      const result = await testCli(program).stdin('from stdin').run('process --data="from flag"');

      expect(result.result).toBe('processed: from flag');
    });

    it('should fail validation when no stdin and field is required', async () => {
      const result = await testCli(program).run('process');

      expect(result.issues).toBeDefined();
      expect(result.issues!.length).toBeGreaterThan(0);
    });
  });

  describe('text mode with optional field', () => {
    const program = createPadrone('test').command('process', (c) =>
      c.arguments(z.object({ data: z.string().optional() }), { stdin: 'data' }).action((args) => args.data ?? 'no data'),
    );

    it('should work without stdin when field is optional', async () => {
      const result = await testCli(program).run('process');

      expect(result.result).toBe('no data');
      expect(result.issues).toBeUndefined();
    });
  });

  describe('explicit text mode', () => {
    const program = createPadrone('test').command('process', (c) =>
      c.arguments(z.object({ content: z.string() }), { stdin: { field: 'content', as: 'text' } }).action((args) => args.content),
    );

    it('should read stdin as text with explicit config', async () => {
      const result = await testCli(program).stdin('explicit text').run('process');

      expect(result.result).toBe('explicit text');
    });
  });

  describe('lines mode', () => {
    const program = createPadrone('test').command('count', (c) =>
      c.arguments(z.object({ lines: z.string().array() }), { stdin: { field: 'lines', as: 'lines' } }).action((args) => args.lines.length),
    );

    it('should read stdin as lines into an array field', async () => {
      const result = await testCli(program).stdin('line1\nline2\nline3\n').run('count');

      expect(result.result).toBe(3);
      expect(result.args).toEqual({ lines: ['line1', 'line2', 'line3'] });
    });

    it('should handle single line without trailing newline', async () => {
      const result = await testCli(program).stdin('single line').run('count');

      expect(result.result).toBe(1);
      expect(result.args).toEqual({ lines: ['single line'] });
    });
  });

  describe('precedence: CLI > stdin > env > config', () => {
    const program = createPadrone('test').command('greet', (c) =>
      c
        .arguments(z.object({ name: z.string() }), { stdin: 'name' })
        .env(z.object({ GREET_NAME: z.string().optional() }).transform((e) => ({ name: e.GREET_NAME! })))
        .configFile('config.json')
        .action((args) => `Hello, ${args.name}!`),
    );

    it('stdin should take precedence over env', async () => {
      const result = await testCli(program).stdin('stdin-name').env({ GREET_NAME: 'env-name' }).run('greet');

      expect(result.result).toBe('Hello, stdin-name!');
    });

    it('stdin should take precedence over config', async () => {
      const result = await testCli(program)
        .stdin('stdin-name')
        .config({ 'config.json': { name: 'config-name' } })
        .run('greet');

      expect(result.result).toBe('Hello, stdin-name!');
    });

    it('CLI flag should take precedence over stdin', async () => {
      const result = await testCli(program).stdin('stdin-name').run('greet --name="cli-name"');

      expect(result.result).toBe('Hello, cli-name!');
    });

    it('env should be used when no stdin', async () => {
      const result = await testCli(program).env({ GREET_NAME: 'env-name' }).run('greet');

      expect(result.result).toBe('Hello, env-name!');
    });
  });

  describe('stdin with positional args', () => {
    const program = createPadrone('test').command('transform', (c) =>
      c
        .arguments(z.object({ format: z.string(), data: z.string() }), { positional: ['format'], stdin: 'data' })
        .action((args) => `${args.format}: ${args.data}`),
    );

    it('should combine positional args with stdin data', async () => {
      const result = await testCli(program).stdin('raw data').run('transform json');

      expect(result.result).toBe('json: raw data');
    });
  });

  describe('help output', () => {
    it('should show stdin field in usage line', () => {
      const program = createPadrone('test').command('process', (c) =>
        c.arguments(z.object({ data: z.string() }), { stdin: 'data' }).action((args) => args.data),
      );

      const help = program.help('process');
      expect(help).toContain('stdin');
      expect(help).toContain('data');
    });
  });
});
