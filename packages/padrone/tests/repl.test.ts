import { describe, expect, it, mock } from 'bun:test';
import { buildReplCompleter, createPadrone } from 'padrone';
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

    // Validation error was printed
    expect(errors.some((e) => e.includes('Validation error'))).toBe(true);
    // The greet command still succeeded
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

  it('should work with readLine from runtime', async () => {
    const readLine = mockReadLine([null]);
    const program = createPadrone('test').runtime({ readLine, output: () => {}, error: () => {} });

    const results = [];
    for await (const result of program.repl()) {
      results.push(result);
    }

    expect(results).toHaveLength(0);
  });

  describe('output styling', () => {
    it('should add blank lines before and after each command when spacing is true', async () => {
      const output: string[] = [];
      const readLine = mockReadLine(['greet World', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: (msg) => output.push(msg), error: () => {} })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args, rt) => {
            rt.output(`Hello, ${args.name}!`);
          }),
        );

      for await (const _ of program.repl({ spacing: true })) {
        // consume
      }

      expect(output.at(0)).toBe('');
      expect(output).toContain('Hello, World!');
      expect(output.at(-1)).toBe('');
    });

    it('should use single-char spacing as repeated separator before and after', async () => {
      const output: string[] = [];
      const readLine = mockReadLine(['greet World', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: (msg) => output.push(msg), error: () => {} })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args, rt) => {
            rt.output(`Hello, ${args.name}!`);
          }),
        );

      for await (const _ of program.repl({ spacing: '─' })) {
        // consume
      }

      const firstLine = output.at(0)!;
      expect(firstLine.length).toBeGreaterThanOrEqual(80);
      expect(firstLine).toBe('─'.repeat(firstLine.length));
      expect(output.at(1)).toBe('Hello, World!');
      // Also after
      expect(output.at(-1)).toBe(firstLine);
    });

    it('should use multi-char spacing string as-is', async () => {
      const output: string[] = [];
      const readLine = mockReadLine(['greet World', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: (msg) => output.push(msg), error: () => {} })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args, rt) => {
            rt.output(`Hello, ${args.name}!`);
          }),
        );

      for await (const _ of program.repl({ spacing: '---' })) {
        // consume
      }

      expect(output.at(0)).toBe('---');
      expect(output.at(-1)).toBe('---');
    });

    it('should support object form with only before or only after', async () => {
      const output: string[] = [];
      const readLine = mockReadLine(['greet World', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: (msg) => output.push(msg), error: () => {} })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args, rt) => {
            rt.output(`Hello, ${args.name}!`);
          }),
        );

      for await (const _ of program.repl({ spacing: { before: '─' } })) {
        // consume
      }

      // Separator before, nothing after
      const firstLine = output.at(0)!;
      expect(firstLine.length).toBeGreaterThanOrEqual(80);
      expect(firstLine).toBe('─'.repeat(firstLine.length));
      expect(output.at(-1)).toBe('Hello, World!');
    });

    it('should support different before and after spacing', async () => {
      const output: string[] = [];
      const readLine = mockReadLine(['greet World', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: (msg) => output.push(msg), error: () => {} })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args, rt) => {
            rt.output(`Hello, ${args.name}!`);
          }),
        );

      for await (const _ of program.repl({ spacing: { before: '─', after: true } })) {
        // consume
      }

      const firstLine = output.at(0)!;
      expect(firstLine).toBe('─'.repeat(firstLine.length));
      expect(output.at(-1)).toBe('');
    });

    it('should prefix command output lines with outputPrefix', async () => {
      const output: string[] = [];
      const readLine = mockReadLine(['greet World', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: (msg) => output.push(msg), error: () => {} })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args, rt) => {
            rt.output(`Hello, ${args.name}!`);
          }),
        );

      for await (const _ of program.repl({ outputPrefix: '│ ' })) {
        // consume
      }

      expect(output).toContain('│ Hello, World!');
    });

    it('should prefix error output with outputPrefix', async () => {
      const errors: string[] = [];
      const readLine = mockReadLine(['boom', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: () => {}, error: (msg) => errors.push(msg) })
        .command('boom', (c) =>
          c.action(() => {
            throw new Error('kaboom');
          }),
        );

      for await (const _ of program.repl({ outputPrefix: '│ ' })) {
        // consume
      }

      expect(errors.some((e) => e.startsWith('│ '))).toBe(true);
    });

    it('should restore output functions after command completes', async () => {
      const output: string[] = [];
      const readLine = mockReadLine(['greet World', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: (msg) => output.push(msg), error: () => {} })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args, rt) => {
            rt.output(`Hello, ${args.name}!`);
          }),
        );

      for await (const _ of program.repl({ outputPrefix: '│ ', spacing: true })) {
        // consume
      }

      // Spacing lines should NOT be prefixed (before: printed before prefix patching, after: printed after restoring)
      expect(output.at(0)).toBe('');
      expect(output.at(-1)).toBe('');
      // Command output should be prefixed
      expect(output).toContain('│ Hello, World!');
    });

    it('should support array spacing for multiple lines', async () => {
      const output: string[] = [];
      const readLine = mockReadLine(['greet World', null]);
      const program = createPadrone('test')
        .runtime({ readLine, output: (msg) => output.push(msg), error: () => {} })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args, rt) => {
            rt.output(`Hello, ${args.name}!`);
          }),
        );

      for await (const _ of program.repl({ spacing: { before: [true, '─'], after: true } })) {
        // consume
      }

      // Before: blank line, then separator
      expect(output.at(0)).toBe('');
      const sep = output.at(1)!;
      expect(sep).toBe('─'.repeat(sep.length));
      // Command output
      expect(output.at(2)).toBe('Hello, World!');
      // After: blank line
      expect(output.at(-1)).toBe('');
    });
  });

  describe('tab completion', () => {
    function getCompleter(program: any, builtinOverrides?: { hasUserExit?: boolean; hasUserClear?: boolean }) {
      // Get the root command via parse() with empty argv
      const rootCommand = program.runtime({ argv: () => [] }).parse().command;
      return buildReplCompleter(rootCommand, {
        hasUserExit: builtinOverrides?.hasUserExit ?? false,
        hasUserClear: builtinOverrides?.hasUserClear ?? false,
      });
    }

    it('should complete command names', () => {
      const completer = getCompleter(
        createPadrone('test')
          .command('greet', (c) => c.action(() => 'hi'))
          .command('goodbye', (c) => c.action(() => 'bye')),
      );

      const [hits] = completer('gr');
      expect(hits).toContain('greet');
      expect(hits).not.toContain('goodbye');
    });

    it('should complete option names with --', () => {
      const completer = getCompleter(
        createPadrone('test').command('greet', (c) =>
          c.arguments(z.object({ name: z.string(), loud: z.boolean().default(false) })).action((args) => args.name),
        ),
      );

      const [hits] = completer('greet --n');
      expect(hits).toContain('--name');
      expect(hits).not.toContain('--loud');
    });

    it('should complete alias flags with -', () => {
      const completer = getCompleter(
        createPadrone('test').command('list', (c) =>
          c
            .arguments(z.object({ priority: z.string(), verbose: z.boolean().default(false) }), {
              fields: { priority: { alias: 'p' }, verbose: { alias: 'v' } },
            })
            .action(() => 'listed'),
        ),
      );

      const [hits] = completer('list -');
      expect(hits).toContain('-p');
      expect(hits).toContain('-v');
      expect(hits).not.toContain('-priority');
      expect(hits).not.toContain('-verbose');
    });

    it('should include built-in commands in completions', () => {
      const completer = getCompleter(createPadrone('test').command('greet', (c) => c.action(() => 'hi')));

      const [hits] = completer('');
      expect(hits).toContain('help');
      expect(hits).toContain('exit');
      expect(hits).toContain('quit');
      expect(hits).toContain('clear');
      expect(hits).toContain('greet');
    });

    it('should not include exit/quit if user has those commands', () => {
      const completer = getCompleter(
        createPadrone('test')
          .command('exit', (c) => c.action(() => 'custom-exit'))
          .command('greet', (c) => c.action(() => 'hi')),
        { hasUserExit: true },
      );

      const [hits] = completer('');
      expect(hits).toContain('exit');
      expect(hits).not.toContain('quit');
    });

    it('should complete subcommand names', () => {
      const completer = getCompleter(
        createPadrone('test').command('db', (c) =>
          c.command('migrate', (s) => s.action(() => 'migrated')).command('seed', (s) => s.action(() => 'seeded')),
        ),
      );

      const [hits] = completer('db mi');
      expect(hits).toContain('migrate');
      expect(hits).not.toContain('seed');
    });

    it('should include --help in option completions', () => {
      const completer = getCompleter(
        createPadrone('test').command('greet', (c) => c.arguments(z.object({ name: z.string() })).action((args) => args.name)),
      );

      const [hits] = completer('greet --');
      expect(hits).toContain('--help');
      expect(hits).toContain('--name');
    });

    it('should return all candidates when no match', () => {
      const completer = getCompleter(
        createPadrone('test')
          .command('greet', (c) => c.action(() => 'hi'))
          .command('goodbye', (c) => c.action(() => 'bye')),
      );

      const [hits] = completer('xyz');
      // Falls back to all candidates
      expect(hits).toContain('greet');
      expect(hits).toContain('goodbye');
    });
  });
});
