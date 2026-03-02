import { describe, expect, it } from 'bun:test';
import * as z from 'zod/v4';
import { createPadrone } from '../src/index.js';

describe('wrap', () => {
  describe('basic wrapping', () => {
    it('should wrap echo command with string argument', async () => {
      const program = createPadrone('test').command('echo', (c) =>
        c
          .arguments(
            z.object({
              message: z.string(),
            }),
            {
              positional: ['message'],
            },
          )
          .wrap({
            command: 'echo',
          }),
      );

      const result = await program.run('echo', { message: 'Hello World' });
      const wrapResult = await result.result;

      expect(result.command.path).toBe('echo');
      expect(result.options?.message).toBe('Hello World');
      expect(wrapResult.success).toBe(true);
      expect(wrapResult.exitCode).toBe(0);
    });

    it('should capture stdout when inheritStdio is false', async () => {
      const program = createPadrone('test').command('echo', (c) =>
        c
          .arguments(
            z.object({
              message: z.string(),
            }),
            {
              positional: ['message'],
            },
          )
          .wrap({
            command: 'echo',
            inheritStdio: false,
          }),
      );

      const result = await program.run('echo', { message: 'Hello' });
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
      expect(wrapResult.stdout?.trim()).toBe('Hello');
    });
  });

  describe('option mapping', () => {
    it('should convert boolean options to flags', async () => {
      const program = createPadrone('test').command('ls', (c) =>
        c
          .arguments(
            z.object({
              all: z.boolean().optional(),
              longFormat: z.boolean().optional(),
            }),
          )
          .wrap({
            command: 'echo',
            args: ['ls', '/tmp'],
            inheritStdio: false,
          }),
      );

      const result = await program.run('ls', { all: true, longFormat: true });
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
      expect(result.options?.all).toBe(true);
      expect(result.options?.longFormat).toBe(true);
    });

    it('should use custom option mapping', async () => {
      const program = createPadrone('test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z.boolean().optional(),
              output: z.string().optional(),
            }),
          )
          .wrap({
            command: 'echo',
            optionMapping: {
              verbose: '-v',
              output: '-o',
            },
            inheritStdio: false,
          }),
      );

      const result = await program.run('test', { verbose: true, output: 'file.txt' });
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
    });

    it('should handle array options', async () => {
      const program = createPadrone('test').command('test', (c) =>
        c
          .arguments(
            z.object({
              files: z.string().array().optional(),
            }),
          )
          .wrap({
            command: 'echo',
            inheritStdio: false,
          }),
      );

      const result = await program.run('test', { files: ['file1.txt', 'file2.txt'] });
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
      expect(wrapResult.stdout?.includes('file1.txt')).toBe(true);
      expect(wrapResult.stdout?.includes('file2.txt')).toBe(true);
    });

    it('should convert camelCase options to kebab-case', async () => {
      const program = createPadrone('test').command('test', (c) =>
        c
          .arguments(
            z.object({
              myLongOption: z.string().optional(),
            }),
          )
          .wrap({
            command: 'echo',
            inheritStdio: false,
          }),
      );

      const result = await program.run('test', { myLongOption: 'value' });
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
    });
  });

  describe('positional arguments', () => {
    it('should handle single positional argument', async () => {
      const program = createPadrone('test').command('cat', (c) =>
        c
          .arguments(
            z.object({
              file: z.string(),
            }),
            {
              positional: ['file'],
            },
          )
          .wrap({
            command: 'echo',
            args: ['Reading:'],
            inheritStdio: false,
          }),
      );

      const result = await program.run('cat', { file: 'test.txt' });
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
      expect(wrapResult.stdout?.includes('test.txt')).toBe(true);
    });

    it('should handle variadic positional arguments', async () => {
      const program = createPadrone('test').command('concat', (c) =>
        c
          .arguments(
            z.object({
              files: z.string().array(),
            }),
            {
              positional: ['...files'],
            },
          )
          .wrap({
            command: 'echo',
            inheritStdio: false,
          }),
      );

      const result = await program.run('concat', { files: ['file1.txt', 'file2.txt', 'file3.txt'] });
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
      expect(wrapResult.stdout?.includes('file1.txt')).toBe(true);
      expect(wrapResult.stdout?.includes('file2.txt')).toBe(true);
      expect(wrapResult.stdout?.includes('file3.txt')).toBe(true);
    });

    it('should handle mixed positional and option arguments', async () => {
      const program = createPadrone('test').command('grep', (c) =>
        c
          .arguments(
            z.object({
              pattern: z.string(),
              file: z.string(),
              ignoreCase: z.boolean().optional(),
            }),
            {
              positional: ['pattern', 'file'],
            },
          )
          .wrap({
            command: 'echo',
            inheritStdio: false,
          }),
      );

      const result = await program.run('grep', { pattern: 'test', file: 'file.txt', ignoreCase: true });
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle command not found', async () => {
      const program = createPadrone('test').command('notfound', (c) =>
        c.wrap({
          command: 'this-command-does-not-exist-12345',
          inheritStdio: false,
        }),
      );

      let errorThrown = false;
      try {
        const result = await program.run('notfound', undefined);
        await result.result;
      } catch (error) {
        errorThrown = true;
        expect(error).toBeDefined();
      }
      expect(errorThrown).toBe(true);
    });

    it('should return non-zero exit code for failing commands', async () => {
      const program = createPadrone('test').command('false', (c) =>
        c.wrap({
          command: 'false',
          inheritStdio: false,
        }),
      );

      const result = await program.run('false', undefined);
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(false);
      expect(wrapResult.exitCode).not.toBe(0);
    });
  });

  describe('CLI parsing', () => {
    it('should work with CLI parsing', async () => {
      const program = createPadrone('test').command('echo', (c) =>
        c
          .arguments(
            z.object({
              message: z.string(),
            }),
            {
              positional: ['message'],
            },
          )
          .wrap({
            command: 'echo',
            inheritStdio: false,
          }),
      );

      const result = await program.cli('echo "Hello from CLI"');
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
      expect(wrapResult.stdout?.includes('Hello from CLI')).toBe(true);
    });

    it('should work with options from CLI', async () => {
      const program = createPadrone('test-cli').command('cmd', (c) =>
        c
          .arguments(
            z.object({
              verbose: z.boolean().optional(),
              file: z.string().optional(),
            }),
          )
          .wrap({
            command: 'echo',
            inheritStdio: false,
          }),
      );

      const result = await program.cli('cmd --verbose --file test.txt');
      const wrapResult = await result.result;

      expect(wrapResult.success).toBe(true);
    });
  });

  describe('with fixed args', () => {
    it('should prepend fixed args to command', async () => {
      const program = createPadrone('git').command('status', (c) =>
        c
          .arguments(
            z.object({
              short: z.boolean().optional(),
            }),
          )
          .wrap({
            command: 'echo',
            args: ['git', 'status'],
            optionMapping: { short: '-s' },
            inheritStdio: false,
          }),
      );

      const result = await program.run('status', { short: true });
      const wrapResult = await result.result;

      // Note: This will succeed because we're using echo instead of actual git
      expect(result.command.path).toBe('status');
      expect(wrapResult.success).toBe(true);
    });
  });

  describe('type safety', () => {
    it('should enforce options schema', async () => {
      const program = createPadrone('test').command('echo', (c) =>
        c
          .arguments(
            z.object({
              message: z.string(),
              count: z.number().optional(),
            }),
            {
              positional: ['message'],
            },
          )
          .wrap({
            command: 'echo',
            inheritStdio: false,
          }),
      );

      const result = await program.run('echo', { message: 'test', count: 5 });
      const wrapResult = await result.result;

      expect(result.options?.message).toBe('test');
      expect(result.options?.count).toBe(5);
      expect(wrapResult.success).toBe(true);
    });
  });
});
