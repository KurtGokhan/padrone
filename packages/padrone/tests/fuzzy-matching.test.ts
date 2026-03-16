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
      expect(() => program.eval('deply')).toThrow(/Did you mean "deploy"/);
    });

    it('should suggest similar command for single char typo', () => {
      expect(() => program.eval('listt')).toThrow(/Did you mean "list"/);
    });

    it('should not suggest when input is too different', () => {
      expect(() => program.eval('xyz')).toThrow('Unknown command: xyz');
      expect(() => program.eval('xyz')).not.toThrow(/Did you mean/);
    });

    it('should still include the unknown command name', () => {
      expect(() => program.eval('deply')).toThrow(/Unknown command: deply/);
    });
  });

  describe('command alias suggestions', () => {
    const program = createPadrone('app')
      .command(['deploy', 'dp'], (c) => c.action(() => 'deployed'))
      .command(['list', 'ls'], (c) => c.action(() => 'listed'));

    it('should suggest alias when it matches better', () => {
      expect(() => program.eval('ls2')).toThrow(/Did you mean "ls"/);
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
      expect(() => program.eval('git comit')).toThrow(/Did you mean "commit"/);
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

      try {
        p.cli();
      } catch {
        // expected
      }
      expect(errors.some((e) => e.includes('Did you mean "verbose"'))).toBe(true);
    });

    it('should suggest similar option for typo in validation error (soft mode)', () => {
      const p = createPadrone('app').command('run', (c) =>
        c.arguments(z.object({ verbose: z.boolean().optional(), output: z.string().optional() }).strict()).action(() => 'ran'),
      );

      const result = p.eval('run --vrebose');
      expect(result.argsResult?.issues).toBeDefined();
    });
  });
});
