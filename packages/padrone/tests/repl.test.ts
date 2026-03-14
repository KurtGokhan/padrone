import { describe, expect, it, mock } from 'bun:test';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

/**
 * Creates a mock readLine that returns inputs in sequence, then null (EOF).
 */
function mockReadLine(inputs: (string | null)[]): (prompt: string) => Promise<string | null> {
  let index = 0;
  return mock(async (_prompt: string): Promise<string | null> => {
    if (index >= inputs.length) return null;
    return inputs[index++] ?? null;
  });
}

function createTestProgram(readLine: ReturnType<typeof mockReadLine>) {
  return createPadrone('test')
    .runtime({ readLine, output: () => {}, error: () => {} })
    .command('greet', (c) => c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`))
    .command('add', (c) =>
      c
        .arguments(
          z.object({
            a: z.coerce.number(),
            b: z.coerce.number(),
          }),
        )
        .action((args) => args.a + args.b),
    );
}

describe('REPL', () => {
  createConsoleMocker();

  it('should execute commands and yield results', async () => {
    const readLine = mockReadLine(['greet World', 'add --a=2 --b=3', null]);
    const program = createTestProgram(readLine);

    const results: any[] = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    expect(results).toHaveLength(2);
    expect(results[0]!.result).toBe('Hello, World!');
    expect(results[1]!.result).toBe(5);
  });

  it('should stop on exit command', async () => {
    const readLine = mockReadLine(['greet Alice', 'exit', 'greet Bob']);
    const program = createTestProgram(readLine);

    const results: any[] = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    expect(results).toHaveLength(1);
    expect(results[0]!.result).toBe('Hello, Alice!');
  });

  it('should stop on quit command', async () => {
    const readLine = mockReadLine(['greet Alice', 'quit']);
    const program = createTestProgram(readLine);

    const results = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    expect(results).toHaveLength(1);
  });

  it('should stop on EOF (null)', async () => {
    const readLine = mockReadLine(['greet Alice', null]);
    const program = createTestProgram(readLine);

    const results = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    expect(results).toHaveLength(1);
  });

  it('should skip empty input lines', async () => {
    const readLine = mockReadLine(['', '   ', 'greet World', '', null]);
    const program = createTestProgram(readLine);

    const results: any[] = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    expect(results).toHaveLength(1);
    expect(results[0]!.result).toBe('Hello, World!');
  });

  it('should not crash on validation errors', async () => {
    const errors: string[] = [];
    const readLine = mockReadLine(['add --a=notanumber --b=3', 'greet World', null]);
    const program = createPadrone('test')
      .runtime({ readLine, output: () => {}, error: (msg) => errors.push(msg) })
      .command('add', (c) => c.arguments(z.object({ a: z.coerce.number().min(0), b: z.coerce.number() })).action((args) => args.a + args.b))
      .command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

    const results: any[] = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    // The validation error command still yields (cli returns result with issues, doesn't throw when given explicit input)
    // The greet command succeeds
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.at(-1)!.result).toBe('Hello, World!');
  });

  it('should not crash when handler throws', async () => {
    const errors: string[] = [];
    const readLine = mockReadLine(['boom', 'greet World', null]);
    const program = createPadrone('test')
      .runtime({ readLine, output: () => {}, error: (msg) => errors.push(msg) })
      .command('boom', (c) =>
        c.action(() => {
          throw new Error('kaboom');
        }),
      )
      .command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

    const results: any[] = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    // The error was caught and printed
    expect(errors.some((e) => e.includes('kaboom'))).toBe(true);
    // The second command still ran
    expect(results.some((r: any) => r.result === 'Hello, World!')).toBe(true);
  });

  it('should display greeting message', async () => {
    const output: string[] = [];
    const readLine = mockReadLine([null]);
    const program = createPadrone('test').runtime({ readLine, output: (msg) => output.push(msg), error: () => {} });

    for await (const _ of program.repl({ greeting: 'Welcome to the REPL!' })) {
      // no commands
    }

    expect(output).toContain('Welcome to the REPL!');
  });

  it('should use custom prompt string', async () => {
    const readLine = mockReadLine([null]);
    const program = createPadrone('test').runtime({ readLine, output: () => {}, error: () => {} });

    for await (const _ of program.repl({ prompt: 'custom> ' })) {
      // no commands
    }

    expect(readLine).toHaveBeenCalledWith('custom> ');
  });

  it('should use custom prompt function', async () => {
    let callCount = 0;
    const readLine = mockReadLine(['greet A', 'greet B', null]);
    const program = createPadrone('test')
      .runtime({ readLine, output: () => {}, error: () => {} })
      .command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

    for await (const _ of program.repl({ prompt: () => `[${++callCount}]> ` })) {
      // consume
    }

    expect((readLine as ReturnType<typeof mock>).mock.calls[0]![0]).toBe('[1]> ');
    expect((readLine as ReturnType<typeof mock>).mock.calls[1]![0]).toBe('[2]> ');
  });

  it('should use default prompt with program name', async () => {
    const readLine = mockReadLine([null]);
    const program = createPadrone('myapp').runtime({ readLine, output: () => {}, error: () => {} });

    for await (const _ of program.repl()) {
      // no commands
    }

    expect(readLine).toHaveBeenCalledWith('myapp> ');
  });

  it('should handle clear command', async () => {
    const output: string[] = [];
    const readLine = mockReadLine(['clear', null]);
    const program = createPadrone('test').runtime({ readLine, output: (msg) => output.push(msg), error: () => {} });

    for await (const _ of program.repl()) {
      // no commands
    }

    expect(output.some((o) => o.includes('\x1B[2J'))).toBe(true);
  });

  it('should use user-defined exit command instead of built-in', async () => {
    const readLine = mockReadLine(['exit', null]);
    const program = createPadrone('test')
      .runtime({ readLine, output: () => {}, error: () => {} })
      .command('exit', (c) => c.action(() => 'custom-exit'));

    const results: any[] = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    // User's exit command was executed, not the built-in
    expect(results).toHaveLength(1);
    expect(results[0]!.result).toBe('custom-exit');
  });

  it('should use user-defined clear command instead of built-in', async () => {
    const readLine = mockReadLine(['clear', null]);
    const program = createPadrone('test')
      .runtime({ readLine, output: () => {}, error: () => {} })
      .command('clear', (c) => c.action(() => 'custom-clear'));

    const results: any[] = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    expect(results).toHaveLength(1);
    expect(results[0]!.result).toBe('custom-clear');
  });

  it('should always have readLine from resolved runtime defaults', async () => {
    // resolveRuntime always provides a default readLine, so repl() should not throw
    const readLine = mockReadLine([null]);
    const program = createPadrone('test').runtime({ readLine, output: () => {}, error: () => {} });

    const results = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    expect(results).toHaveLength(0);
  });
});
