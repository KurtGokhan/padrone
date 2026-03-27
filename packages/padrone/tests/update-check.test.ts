import { describe, expect, it } from 'bun:test';
import { createPadrone, padroneUpdateCheck } from 'padrone';
import { formatUpdateMessage, isNewerVersion, parseInterval } from '../src/feature/update-check.ts';

describe('update-check', () => {
  describe('parseInterval', () => {
    it('should parse milliseconds', () => {
      expect(parseInterval('500ms')).toBe(500);
    });

    it('should parse seconds', () => {
      expect(parseInterval('30s')).toBe(30_000);
    });

    it('should parse minutes', () => {
      expect(parseInterval('30m')).toBe(1_800_000);
    });

    it('should parse hours', () => {
      expect(parseInterval('12h')).toBe(43_200_000);
    });

    it('should parse days', () => {
      expect(parseInterval('1d')).toBe(86_400_000);
    });

    it('should parse weeks', () => {
      expect(parseInterval('1w')).toBe(604_800_000);
    });

    it('should default to 1d for invalid input', () => {
      expect(parseInterval('invalid')).toBe(86_400_000);
      expect(parseInterval('')).toBe(86_400_000);
    });
  });

  describe('isNewerVersion', () => {
    it('should detect newer major versions', () => {
      expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
    });

    it('should detect newer minor versions', () => {
      expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
    });

    it('should detect newer patch versions', () => {
      expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
    });

    it('should return false for same version', () => {
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    });

    it('should return false for older versions', () => {
      expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.1.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.0.1', '1.0.0')).toBe(false);
    });

    it('should handle v prefix', () => {
      expect(isNewerVersion('v1.0.0', 'v1.1.0')).toBe(true);
      expect(isNewerVersion('v1.0.0', '1.1.0')).toBe(true);
    });

    it('should not notify about pre-release if current is stable', () => {
      expect(isNewerVersion('1.0.0', '2.0.0-beta.1')).toBe(false);
    });

    it('should notify about pre-release if current is also pre-release', () => {
      expect(isNewerVersion('1.0.0-alpha.1', '1.0.0-beta.1')).toBe(false); // same major.minor.patch
      expect(isNewerVersion('1.0.0-alpha.1', '1.1.0-beta.1')).toBe(true);
    });
  });

  describe('formatUpdateMessage', () => {
    it('should format a readable update message', () => {
      const msg = formatUpdateMessage('1.0.0', '1.1.0', 'myapp');
      expect(msg).toContain('Update available');
      expect(msg).toContain('1.0.0');
      expect(msg).toContain('1.1.0');
      expect(msg).toContain('npm update -g myapp');
    });
  });

  describe('builder integration', () => {
    it('should add updateCheck via .extend(padroneUpdateCheck())', () => {
      const program = createPadrone('test')
        .configure({ version: '1.0.0' })
        .extend(padroneUpdateCheck({ registry: 'npm', interval: '1d' }));

      // Should still be a valid program
      expect(program.help).toBeDefined();
    });

    it('should return a new builder (immutable)', () => {
      const program = createPadrone('test').configure({ version: '1.0.0' });
      const withCheck = program.extend(padroneUpdateCheck({ interval: '12h' }));
      expect(withCheck).not.toBe(program);
    });

    it('should accept empty config', () => {
      const program = createPadrone('test').configure({ version: '1.0.0' }).extend(padroneUpdateCheck());
      expect(program.help).toBeDefined();
    });
  });

  describe('cli integration', () => {
    it('should not crash cli when updateCheck is configured', () => {
      const outputs: string[] = [];
      const errors: string[] = [];
      const program = createPadrone('test')
        .configure({ version: '1.0.0' })
        .extend(padroneUpdateCheck({ registry: 'npm', interval: '1d' }))
        .runtime({
          argv: () => ['--version'],
          output: (...args) => outputs.push(String(args[0])),
          error: (text) => errors.push(text),
          env: () => ({ CI: 'true' }), // CI disables update check
        })
        .command('hello', (c) => c.action(() => 'hello'));

      const result = program.cli();
      expect((result as any).result).toBe('1.0.0');
    });

    it('should respect CI environment to disable update check', () => {
      const errors: string[] = [];
      const program = createPadrone('test')
        .configure({ version: '1.0.0' })
        .extend(padroneUpdateCheck())
        .runtime({
          argv: () => ['hello'],
          output: () => {},
          error: (text) => errors.push(text),
          env: () => ({ CI: 'true' }),
        })
        .command('hello', (c) => c.action(() => 'hello'));

      program.cli();
      // Should not show any update notification in CI
      expect(errors.filter((e) => e.includes('Update available'))).toHaveLength(0);
    });

    it('should respect custom disable env var', () => {
      const errors: string[] = [];
      const program = createPadrone('test')
        .configure({ version: '1.0.0' })
        .extend(padroneUpdateCheck({ disableEnvVar: 'TEST_NO_UPDATE' }))
        .runtime({
          argv: () => ['hello'],
          output: () => {},
          error: (text) => errors.push(text),
          env: () => ({ TEST_NO_UPDATE: '1' }),
        })
        .command('hello', (c) => c.action(() => 'hello'));

      program.cli();
      expect(errors.filter((e) => e.includes('Update available'))).toHaveLength(0);
    });
  });
});
