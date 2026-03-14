import { describe, expect, it } from 'bun:test';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

describe('command routing', () => {
  createConsoleMocker();

  describe('default command (empty name)', () => {
    const program = createPadrone('app')
      .configure({ version: '1.0.0' })
      .command(['', 'repl'], (c) => c.configure({ title: 'Start interactive mode' }).action(() => 'default-executed'))
      .command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

    it('should match empty-name command when no input is provided', () => {
      const result = program.eval('');
      expect(result.command.name).toBe('');
      expect(result.result).toBe('default-executed');
    });

    it('should match empty-name command via alias', () => {
      const result = program.eval('repl');
      expect(result.command.name).toBe('');
      expect(result.result).toBe('default-executed');
    });

    it('should still match named commands normally', () => {
      const result = program.eval('greet World');
      expect(result.result).toBe('Hello, World!');
    });

    it('should match empty-name command via cli() with no argv', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'app'];
      try {
        const result = program.cli();
        expect((result as any).command.name).toBe('');
        expect((result as any).result).toBe('default-executed');
      } finally {
        process.argv = originalArgv;
      }
    });

    it('should use alias as display name with [default] marker in help', () => {
      const helpText = program.help();
      // Should show 'repl [default]' — alias as display name, [default] marker
      expect(helpText).toContain('repl');
      expect(helpText).toContain('[default]');
      expect(helpText).not.toContain('(repl)');
    });

    it('should show [default] marker for empty-name command without aliases', () => {
      const p = createPadrone('app')
        .command('', (c) => c.configure({ title: 'Default action' }).action(() => 'ok'))
        .command('list', (c) => c.action(() => 'listed'));
      const helpText = p.help();
      expect(helpText).toContain('(default)');
      expect(helpText).toContain('Default action');
    });

    it('should show [default] marker with multiple aliases', () => {
      const p = createPadrone('app')
        .command(['', 'repl', 'r'], (c) => c.configure({ title: 'REPL' }).action(() => 'ok'))
        .command('list', (c) => c.action(() => 'listed'));
      const helpText = p.help();
      // 'repl' is display name, 'r' is a real alias, [default] is marker
      expect(helpText).toContain('repl');
      expect(helpText).toMatch(/\(r\)/);
      expect(helpText).toContain('[default]');
    });

    it('should show [default] for reversed alias order', () => {
      const p = createPadrone('app')
        .command(['repl', ''], (c) => c.configure({ title: 'REPL' }).action(() => 'ok'))
        .command('list', (c) => c.action(() => 'listed'));
      const helpText = p.help();
      expect(helpText).toContain('repl');
      expect(helpText).toContain('[default]');
    });

    it('should use alias in help for the empty-name command itself', () => {
      const helpText = program.help('repl');
      // Usage line should reference alias, not 'program'
      expect(helpText).toContain('repl');
      expect(helpText).not.toContain('program');
    });

    it('should use alias in error message for empty-name command with extra args', () => {
      expect(() => program.eval('repl bogus')).toThrow("Unexpected arguments for 'repl'");
    });
  });

  describe('default help (no handler, no default command)', () => {
    const program = createPadrone('myapp')
      .configure({ description: 'A test app' })
      .command('list', (c) => c.action(() => 'listed'))
      .command('show', (c) => c.action(() => 'shown'));

    it('should print help when eval is called with empty input', () => {
      const result = program.eval('');
      expect(typeof result.result).toBe('string');
      expect(result.result as unknown as string).toContain('myapp');
      expect(result.result as unknown as string).toContain('list');
      expect(result.result as unknown as string).toContain('show');
    });

    it('should print help when cli() is called with no argv', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'myapp'];
      try {
        const result = program.cli();
        expect(typeof result.result).toBe('string');
        expect(result.result as unknown as string).toContain('myapp');
      } finally {
        process.argv = originalArgv;
      }
    });
  });

  describe('unknown command error', () => {
    const errors: string[] = [];
    const output: string[] = [];
    const program = createPadrone('app')
      .runtime({ error: (msg) => errors.push(msg), output: (msg) => output.push(msg) })
      .command('list', (c) => c.action(() => 'listed'))
      .command('show', (c) => c.action(() => 'shown'));

    it('should throw on unknown command in eval()', () => {
      expect(() => program.eval('bogus')).toThrow('Unknown command: bogus');
    });

    it('should throw on unknown command in cli()', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'app', 'bogus'];
      try {
        expect(() => program.cli()).toThrow('Unknown command: bogus');
      } finally {
        process.argv = originalArgv;
      }
    });

    it('should include help in error output for cli()', () => {
      errors.length = 0;
      const originalArgv = process.argv;
      process.argv = ['node', 'app', 'bogus'];
      try {
        program.cli();
      } catch {
        // expected
      } finally {
        process.argv = originalArgv;
      }
      expect(errors.some((e) => e.includes('Unknown command: bogus'))).toBe(true);
      expect(errors.some((e) => e.includes('list'))).toBe(true);
    });
  });

  describe('extra parameters rejection', () => {
    const program = createPadrone('app')
      .command('repl', (c) => c.action(() => 'repl-started'))
      .command('show', (c) => c.arguments(z.object({ id: z.string() }), { positional: ['id'] }).action((args) => `showing ${args.id}`));

    it('should reject extra terms for command without positionals', () => {
      expect(() => program.eval('repl test')).toThrow(/Unexpected arguments for 'repl'/);
    });

    it('should accept positional args for commands that define them', () => {
      const result = program.eval('show my-id');
      expect(result.result).toBe('showing my-id');
    });

    it('should allow extra args after -- separator', () => {
      // After --, 'test' becomes a positional arg (not a term), so it won't be rejected
      // as an unmatched term. It will be passed through to validation.
      const result = program.eval('repl -- test');
      // repl has no positional config, so 'test' is in args but not mapped.
      // The command runs successfully since the schema is void.
      expect(result.command.name).toBe('repl');
      expect(result.result).toBe('repl-started');
    });

    it('should not reject extra terms for commands with positional config', () => {
      const result = program.eval('show task-123');
      expect(result.result).toBe('showing task-123');
    });
  });

  describe('parent command help', () => {
    it('should show help for parent command with subcommands but no handler', () => {
      const program = createPadrone('app').command('db', (c) =>
        c
          .configure({ title: 'Database operations' })
          .command('migrate', (c) => c.action(() => 'migrated'))
          .command('seed', (c) => c.action(() => 'seeded')),
      );

      const result = program.eval('db');
      expect(typeof result.result).toBe('string');
      const helpText = result.result as unknown as string;
      expect(helpText).toContain('migrate');
      expect(helpText).toContain('seed');
    });

    it('should show <subcommand> indicator in help for commands with subcommands', () => {
      const program = createPadrone('app')
        .command('db', (c) => c.command('migrate', (c) => c.action(() => 'migrated')).command('seed', (c) => c.action(() => 'seeded')))
        .command('simple', (c) => c.action(() => 'done'));

      const helpText = program.help();
      expect(helpText).toContain('db <subcommand>');
      expect(helpText).not.toContain('simple <subcommand>');
    });

    it('should show (default) entry in help when parent has both handler and subcommands', () => {
      const program = createPadrone('app').command('list', (c) =>
        c
          .configure({ title: 'List items' })
          .action(() => 'listed')
          .command('extended', (c) => c.action(() => 'extended')),
      );

      const helpText = program.help('list');
      expect(helpText).toContain('(default)');
      expect(helpText).toContain('extended');
    });

    it('should still execute handler for parent command with both handler and subcommands', () => {
      const program = createPadrone('app').command('list', (c) =>
        c.action(() => 'listed').command('extended', (c) => c.action(() => 'extended')),
      );

      // list has a handler AND subcommands — handler should still run
      const result = program.eval('list');
      expect(result.result).toBe('listed');
    });
  });

  describe('-- separator', () => {
    const program = createPadrone('app').command('run', (c) =>
      c
        .arguments(z.object({ items: z.array(z.string()).optional().default([]) }), {
          positional: ['...items'] as any,
        })
        .action((a) => ({ items: a.items })),
    );

    it('should treat tokens after -- as positional args, not command terms', () => {
      const result = program.eval('run -- --verbose --debug');
      expect(result.result.items).toEqual(['--verbose', '--debug']);
    });

    it('should not parse flags after -- as named args', () => {
      const result = program.eval('run -- --help');
      // --help after -- should NOT trigger help output, should be a positional
      expect(result.result.items).toEqual(['--help']);
    });

    it('should not match terms after -- as commands', () => {
      const result = program.eval('run -- run');
      expect(result.result.items).toEqual(['run']);
    });
  });
});
