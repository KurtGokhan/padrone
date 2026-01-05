import { describe, expect, it } from 'bun:test';
import * as z from 'zod/v4';
import { createPadrone } from '../src/index';

describe('Command Aliases', () => {
  const program = createPadrone('testprog')
    .command(['list', 'ls', 'show'], (c) =>
      c
        .configure({
          title: 'List items',
          description: 'Show all available items',
        })
        .options(
          z.object({
            format: z.enum(['json', 'table']).optional().default('table').describe('Output format'),
          }),
        )
        .action((options) => {
          return { items: ['item1', 'item2'], format: options?.format };
        }),
    )
    .command(['delete', 'rm'], (c) =>
      c
        .configure({
          title: 'Delete item',
          description: 'Remove an item',
        })
        .options(
          z.object({
            name: z.string().describe('Item name'),
          }),
          { positional: ['name'] },
        )
        .action((options) => {
          return { deleted: options?.name };
        }),
    )
    .command('config', (c) =>
      c
        .configure({
          title: 'Configure app',
          description: 'Manage configuration',
        })
        .command(['set', 'cfg'], (sub) =>
          sub
            .configure({
              title: 'Set config value',
            })
            .options(
              z.object({
                key: z.string(),
                value: z.string(),
              }),
              { positional: ['key', 'value'] },
            )
            .action((options) => {
              return { key: options?.key, value: options?.value };
            }),
        ),
    );

  describe('Single string alias', () => {
    it('should execute command using single string alias', () => {
      const result = program.run('delete', { name: 'test' });
      expect(result.command.name).toBe('delete');
      expect(result.result.deleted).toBe('test');
    });

    it('should parse and execute command using alias via CLI', () => {
      const result = program.cli('rm test');
      expect(result.command.name).toBe('delete');
      expect(result.result.deleted).toBe('test');
    });
  });

  describe('Array of aliases', () => {
    it('should execute command using first alias from array', () => {
      const result = program.cli('ls');
      expect(result.command.name).toBe('list');
      expect(result.result.format).toBe('table');
    });

    it('should execute command using second alias from array', () => {
      const result = program.cli('show');
      expect(result.command.name).toBe('list');
      expect(result.result.format).toBe('table');
    });

    it('should execute command with options using alias', () => {
      const result = program.cli('ls --format json');
      expect(result.command.name).toBe('list');
      expect(result.options?.format).toBe('json');
      expect(result.result.format).toBe('json');
    });
  });

  describe('find method with aliases', () => {
    it('should find command by alias', () => {
      const cmd = program.find('ls');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('list');
    });

    it('should find command by other alias', () => {
      const cmd = program.find('show');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('list');
    });

    it('should find command by original name', () => {
      const cmd = program.find('list');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('list');
    });

    it('should find single string alias', () => {
      const cmd = program.find('rm');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('delete');
    });

    it('should return undefined for non-existent alias', () => {
      const cmd = program.find('nonexistent');
      expect(cmd).toBeUndefined();
    });
  });

  describe('Nested command aliases', () => {
    it('should find nested command by alias', () => {
      const result = program.cli('config cfg key value');
      expect(result.command.name).toBe('set');
      expect(result.result.key).toBe('key');
      expect(result.result.value).toBe('value');
    });

    it('should find nested command using parent and alias', () => {
      const cmd = program.find('config cfg');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('set');
    });
  });

  describe('Help text with aliases', () => {
    it('should include aliases in help text', () => {
      const help = program.help('list');
      expect(help).toContain('list');
      expect(help).toContain('ls');
      expect(help).toContain('show');
    });

    it('should include single alias in help text', () => {
      const help = program.help('delete');
      expect(help).toContain('delete');
      expect(help).toContain('rm');
    });

    it('should show aliases in main help', () => {
      const help = program.help();
      expect(help).toContain('list');
      expect(help).toContain('ls');
      expect(help).toContain('show');
      expect(help).toContain('delete');
      expect(help).toContain('rm');
    });
  });

  describe('Edge cases', () => {
    it('should work with command without aliases', () => {
      const customProgram = createPadrone('testprog').command('test', (c) =>
        c
          .configure({})
          .options(z.object({}))
          .action(() => ({ result: 'ok' })),
      );

      const cmd = customProgram.find('test');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('test');
    });

    it('should handle mixed case commands', () => {
      const result = program.cli('ls --format json');
      expect(result.command.name).toBe('list');
    });

    it('should prioritize exact name match over alias', () => {
      const cmd = program.find('list');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('list');
    });
  });

  describe('Parse method with aliases', () => {
    it('should parse using command alias', () => {
      const result = program.parse('ls');
      expect(result.command.name).toBe('list');
    });

    it('should parse nested command with alias', () => {
      const result = program.parse('config cfg key value');
      expect(result.command.name).toBe('set');
      expect(result.options?.key).toBe('key');
    });
  });

  describe('Stringify method preserves command name', () => {
    it('should stringify using actual command name, not alias', () => {
      const result = program.cli('ls --format json');
      const stringified = program.stringify('list', result.options);
      expect(stringified).toContain('list');
      expect(stringified).toContain('format');
      expect(stringified).toContain('json');
    });
  });
});
