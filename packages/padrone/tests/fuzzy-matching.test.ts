import { describe, expect, it } from 'bun:test';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

describe('fuzzy matching', () => {
  createConsoleMocker();

  describe('command suggestions', () => {
    const program = createPadrone('app')
      .command('deploy', (c) => c.action(() => 'deployed'))
      .command('list', (c) => c.action(() => 'listed'))
      .command('verbose', (c) => c.action(() => 'verbose'));

    it('should suggest similar command for typo', () => {
      const result = program.eval('deply');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Did you mean "deploy"/);
    });

    it('should suggest similar command for single char typo', () => {
      const result = program.eval('listt');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Did you mean "list"/);
    });

    it('should not suggest when input is too different', () => {
      const result = program.eval('xyz');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toContain('Unknown command: xyz');
      expect((result.error as Error).message).not.toMatch(/Did you mean/);
    });

    it('should still include the unknown command name', () => {
      const result = program.eval('deply');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Unknown command: deply/);
    });
  });

  describe('command alias suggestions', () => {
    const program = createPadrone('app')
      .command(['deploy', 'dp'], (c) => c.action(() => 'deployed'))
      .command(['list', 'ls'], (c) => c.action(() => 'listed'));

    it('should suggest alias when it matches better', () => {
      const result = program.eval('ls2');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Did you mean "ls"/);
    });
  });

  describe('subcommand suggestions', () => {
    const program = createPadrone('app').command('git', (c) =>
      c
        .command('commit', (s) => s.action(() => 'committed'))
        .command('push', (s) => s.action(() => 'pushed'))
        .command('pull', (s) => s.action(() => 'pulled')),
    );

    it('should suggest subcommand typo', () => {
      const result = program.eval('git comit');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Did you mean "commit"/);
    });
  });

  describe('unknown option suggestions', () => {
    it('should suggest similar option for typo in validation error (hard mode)', () => {
      const errors: string[] = [];
      const p = createPadrone('app')
        .runtime({
          error: (msg) => errors.push(msg),
          argv: () => ['run', '--vrebose'],
        })
        .command('run', (c) =>
          c.arguments(z.object({ verbose: z.boolean().optional(), output: z.string().optional() }).strict()).action(() => 'ran'),
        );

      p.cli();
      // cli() no longer throws, but error handler should still be called
      expect(errors.some((e) => e.includes('Did you mean "--verbose"'))).toBe(true);
    });

    it('should suggest similar option for typo in validation error (soft mode)', () => {
      const p = createPadrone('app').command('run', (c) =>
        c.arguments(z.object({ verbose: z.boolean().optional(), output: z.string().optional() }).strict()).action(() => 'ran'),
      );

      const result = p.eval('run --vrebose');
      expect(result.argsResult?.issues).toBeDefined();
    });

    it('should include -- prefix in option suggestions', () => {
      const p = createPadrone('app').command('run', (c) => c.arguments(z.object({ verbose: z.boolean().optional() })).action(() => 'ran'));

      const result = p.eval('run --vrebose');
      expect(result.argsResult?.issues?.[0]?.message).toContain('Did you mean "--verbose"');
    });
  });

  describe('prefix/substring matching', () => {
    const program = createPadrone('app')
      .command('deploy', (c) => c.action(() => 'deployed'))
      .command('destroy', (c) => c.action(() => 'destroyed'))
      .command('changelog', (c) => c.action(() => 'changelog'));

    it('should suggest prefix match for commands when input > 3 chars', () => {
      const result = program.eval('depl');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Did you mean "deploy"/);
    });

    it('should suggest substring match for commands when input > 3 chars', () => {
      const result = program.eval('change');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Did you mean "changelog"/);
    });

    it('should not prefix match when input is 2 chars or fewer', () => {
      const p = createPadrone('app').command('changelog', (c) => c.action(() => 'changelog'));
      const result = p.eval('ch');
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).not.toMatch(/Did you mean/);
    });

    it('should suggest prefix match for options when input > 3 chars', () => {
      const p = createPadrone('app').command('run', (c) =>
        c.arguments(z.object({ verbose: z.boolean().optional(), version: z.string().optional() })).action(() => 'ran'),
      );

      const result = p.eval('run --verb');
      expect(result.argsResult?.issues?.[0]?.message).toContain('Did you mean "--verbose"');
    });
  });

  describe('multiple suggestions', () => {
    it('should suggest multiple similar commands', () => {
      const program = createPadrone('app')
        .command('deploy', (c) => c.action(() => 'deployed'))
        .command('delete', (c) => c.action(() => 'deleted'));

      const result = program.eval('delet');
      expect(result.error).toBeInstanceOf(Error);
      const msg = (result.error as Error).message;
      // Should suggest "delete" (edit distance 1) — "deploy" is too far
      expect(msg).toMatch(/Did you mean "delete"/);
    });

    it('should suggest multiple similar options with -- prefix', () => {
      const p = createPadrone('app').command('run', (c) =>
        c
          .arguments(z.object({ verbose: z.boolean().optional(), version: z.string().optional(), verify: z.boolean().optional() }))
          .action(() => 'ran'),
      );

      const result = p.eval('run --verbo');
      expect(result.argsResult?.issues?.[0]?.message).toContain('--verbose');
    });
  });
});
