import { describe, expect, it, mock } from 'bun:test';
import { asyncSchema, createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createTasksProgram } from './common.ts';
import { createConsoleMocker } from './console-mocker.ts';

describe('CLI', () => {
  const program = createTasksProgram();
  createConsoleMocker();

  describe('programmatic execution', () => {
    it('should execute a simple command with args and args', () => {
      const result = program.run('show', { id: 'task-1', priority: 'high', verbose: true });

      expect(result.command.path).toBe('show');
      expect(result.args).toMatchInlineSnapshot(`
        {
          "id": "task-1",
          "priority": "high",
          "verbose": true,
        }
      `);
      expect(result.result.id).toBe('task-1');
      expect(result.result.title).toBe('Important Task');
      expect(result.result.stats?.total).toBe(5);
    });

    it('should execute a command with default args', () => {
      const result = program.run('show', { id: 'task-2' });

      expect(result.command.path).toBe('show');
      expect(result.result.title).toBe('Regular Task'); // Default medium priority
      expect(result.result.stats).toBeUndefined(); // verbose not set
    });

    it('should execute nested commands', () => {
      const result = program.run('list extended', { status: 'pending', priority: 'high' });

      expect(result.command.path).toBe('list extended');
      expect(result.args?.status).toEqual('pending');
      expect(result.args?.priority).toEqual('high');
      expect(result.result.status).toBe('pending');
      expect(result.result.extendedList).toBeDefined();
    });

    it('should execute a command with array args', () => {
      const result = program.run('batch', { ids: ['task-1', 'task-2', 'task-3'] });

      expect(result.command.path).toBe('batch');
      expect(result.args?.ids).toEqual(['task-1', 'task-2', 'task-3']);
      expect(result.result.ids).toEqual(['task-1', 'task-2', 'task-3']);
      expect(result.result.results).toHaveLength(3);
    });

    it('should execute a command with void args and args', () => {
      const result = program.run('noop', undefined);

      expect(result.command.path).toBe('noop');
      expect(result.args).toBeUndefined();
      expect(result.result).toBeUndefined();
    });
  });

  describe('CLI parsing', () => {
    it('should parse simple command with args', () => {
      const result = program.parse('show task-1');

      expect(result.command.path).toBe('show');
      expect(result.args?.id).toEqual('task-1');
      expect(result.args?.priority).toEqual('medium');
    });

    it('should parse command with args', () => {
      const result = program.parse('show task-2 --priority high --verbose');

      expect(result.command.path).toBe('show');
      expect(result.args?.id).toEqual('task-2');
      expect(result.args?.priority).toEqual('high');
      expect(result.args?.verbose).toBe(true);
    });

    it('should parse command with option values', () => {
      const result = program.parse('list --limit=5 --priority high');

      expect(result.command.path).toBe('list');
      expect(result.args?.limit).toEqual(5);
      expect(result.args?.priority).toEqual('high');
    });

    it('should parse nested commands', () => {
      const result = program.parse('list extended --status pending --priority high');

      expect(result.command.path).toBe('list extended');
      expect(result.args?.status).toEqual('pending');
      expect(result.args?.priority).toEqual('high');
    });

    it('should parse command with multiple args', () => {
      const result = program.parse('batch task-1 task-2 task-3 task-4');

      expect(result.command.path).toBe('batch');
      expect(result.args?.ids).toEqual(['task-1', 'task-2', 'task-3', 'task-4']);
    });

    it('should parse command with complex args', () => {
      const result = program.parse('filter --status "in_progress" --priority high');

      expect(result.command.path).toBe('filter');
      expect(result.args).toEqual({ status: 'in_progress', priority: 'high' }); // Note: quotes are now properly parsed
    });

    it('should handle empty input', () => {
      const result = program.parse('');

      expect(result.command.path).toBe('');
      expect(result.args).toBeUndefined();
    });
  });

  describe('CLI execution', () => {
    it('should execute command via CLI string', () => {
      const result = program.cli('show task-1 --priority high');

      expect(result).toBeDefined();
      if (!result) throw new Error('Result is undefined');
      expect(result.command.path).toBe('show');
      expect(result.args?.id).toEqual('task-1');
      expect(result.result.id).toBe('task-1');
      expect(result.result.title).toBe('Important Task');
    });

    it('should return undefined for empty CLI input', () => {
      expect(() => program.cli('')).toThrow('Command "" has no handler');
    });

    it('should execute nested command via CLI', () => {
      const result = program.cli('list extended --status pending --priority high');

      expect(result).toBeDefined();
      expect(result?.command.path).toBe('list extended');
      expect(result?.result.status).toBe('pending');
    });

    it('should throw error for non-existent command', () => {
      expect(() => {
        program.run('nonexistent', {});
      }).toThrow('Command "nonexistent" not found');
    });
  });

  describe('command finding', () => {
    it('should find a top-level command', () => {
      const command = program.find('show');

      expect(command).toBeDefined();
      expect(command?.name).toBe('show');
    });

    it('should find a nested command', () => {
      const command = program.find('list extended');

      expect(command).toBeDefined();
      expect(command?.name).toBe('extended');
      expect(command?.path).toBe('list extended');
    });

    it('should return undefined for non-existent command', () => {
      const command = program.find('nonexistent');

      expect(command).toBeUndefined();
    });
  });

  describe('API generation', () => {
    it('should generate type-safe API for top-level commands', () => {
      const api = program.api();

      expect(api.show).toBeDefined();
      expect(typeof api.show).toBe('function');

      const result = api.show({ id: 'task-1', priority: 'high', verbose: true });
      // API returns PadroneCommandResult, so access .result property
      expect(result.id).toBe('task-1');
      expect(result.title).toBe('Important Task');
    });

    it('should generate nested API structure', () => {
      const api = program.api();
      expect(api.list).toBeDefined();
      expect(typeof api.list).toBe('function');
      expect(api.list.extended).toBeDefined();
      expect(typeof api.list.extended).toBe('function');

      const result = api.list.extended({ status: 'pending', priority: 'high' });
      // API returns PadroneCommandResult, so access .result property
      expect(result.status).toBe('pending');
      expect(result.extendedList).toBeDefined();
    });

    it('should generate API for all commands', () => {
      const api = program.api();

      expect(api.show).toBeDefined();
      expect(api.list).toBeDefined();
      expect(api.filter).toBeDefined();
      expect(api.batch).toBeDefined();
      expect(api.noop).toBeDefined();
    });

    it('should execute commands through API', () => {
      const api = program.api();

      const batchResult = api.batch({ ids: ['task-1', 'task-2'] });
      // API returns PadroneCommandResult, so access .result property
      expect(batchResult.ids).toEqual(['task-1', 'task-2']);

      const filterResult = api.filter({ status: 'pending', priority: 'high' });
      expect(filterResult.status).toBe('pending');
    });
  });

  describe('edge cases', () => {
    it('should handle command with no args schema', () => {
      const program = createPadrone('padrone-test').command('test', (c) => c.action(() => ({ message: 'success' })));

      const result = program.run('test', undefined);
      expect(result.result?.message).toBe('success');
    });

    it('should handle command with positional args', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c.arguments(z.object({ id: z.string() }), { positional: ['id'] }).action((args) => ({ id: args.id })),
      );

      const result = program.run('test', { id: 'task-1' });
      expect(result.result.id).toBe('task-1');
    });

    it('should handle deeply nested commands', () => {
      const program = createPadrone('padrone-test').command('level1', (c) =>
        c.command('level2', (c2) => c2.command('level3', (c3) => c3.action(() => ({ depth: 3 })))).action(() => ({ depth: 1 })),
      );

      const result = program.run('level1 level2 level3', undefined);
      expect(result.result.depth).toBe(3);
    });

    it('should handle command names with spaces in parsing', () => {
      // Note: This tests the parsing behavior - spaces typically separate commands
      const result = program.parse('list extended');

      expect(result.command.path).toBe('list extended');
    });

    it('should handle args without values', () => {
      const result = program.parse('filter --ascending');

      expect(result.command.path).toBe('filter');
      expect(result.args?.ascending).toBe(true);
    });

    it('should handle multiple boolean args', () => {
      const result = program.parse('show task-1 --verbose --priority high');

      expect(result.command.path).toBe('show');
      expect(result.args?.verbose).toBe(true);
      expect(result.args?.priority).toBe('high');
    });
  });

  describe('real-world task CLI scenarios', () => {
    it('should handle showing tasks for multiple IDs sequentially', () => {
      const ids = ['task-1', 'task-2', 'task-3'];
      const results = ids.map((id) => program.run('show', { id, priority: 'high' }));

      expect(results).toHaveLength(3);
      results.forEach((result, i) => {
        expect(result.result.id).toBe(ids[i]!);
        expect(result.result.title).toBe('Important Task');
      });
    });

    it('should handle listing tasks with custom limit', () => {
      const result = program.run('list', { limit: 5, priority: 'medium' });

      expect(result.result.limit).toBe(5);
      expect(result.result.tasks).toHaveLength(2); // Mock data only has 2 tasks
    });

    it('should handle batch operations across multiple tasks', () => {
      const ids = ['task-1', 'task-2', 'task-3'];
      const result = program.run('batch', { ids });

      expect(result.result?.results).toHaveLength(3);
      result.result?.results.forEach((res: any, i: number) => {
        expect(res.id).toBe(ids[i]);
        expect(res.status).toBeDefined();
        expect(res.title).toBeDefined();
      });
    });

    it('should handle filtering tasks with args', () => {
      const result = program.run('filter', {
        status: 'pending',
        priority: 'high',
      });

      expect(result.result.status).toBe('pending');
      expect(result.result.priority).toBe('high');
      expect(result.result.tasks).toBeDefined();
    });
  });

  describe('alias functionality', () => {
    it('should resolve aliases to full option names when parsing', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .meta({ alias: ['v'] }),
              help: z
                .boolean()
                .optional()
                .meta({ alias: ['h'] }),
            }),
          )
          .action((args) => ({
            verbose: args?.verbose,
            help: args?.help,
          })),
      );

      const result = program.parse('test -v -h');

      expect(result.command.path).toBe('test');
      expect(result.args?.verbose).toBe(true);
      expect(result.args?.help).toBe(true);
    });

    it('should resolve aliases with values', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              unit: z
                .string()
                .optional()
                .meta({ alias: ['u'] }),
              count: z.coerce
                .number()
                .optional()
                .meta({ alias: ['c'] }),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test -u celsius -c=5');

      expect(result.args?.unit).toBe('celsius');
      expect(result.args?.count).toBe(5);
    });

    it('should execute commands with aliases via CLI', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .meta({ alias: ['v'] }),
            }),
          )
          .action((args) => ({
            verbose: args?.verbose || false,
          })),
      );

      const result = program.cli('test -v');

      expect(result?.args?.verbose).toBe(true);
      expect(result?.result.verbose).toBe(true);
    });

    it('should handle aliases mixed with full option names', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .meta({ alias: ['v'] }),
              help: z
                .boolean()
                .optional()
                .meta({ alias: ['h'] }),
              output: z
                .string()
                .optional()
                .meta({ alias: ['o'] }),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test -v --help -o=file.txt');

      expect(result.args?.verbose).toBe(true);
      expect(result.args?.help).toBe(true);
      expect(result.args?.output).toBe('file.txt');
    });

    it('should handle undefined aliases gracefully', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z.boolean().optional(),
              v: z.boolean().optional(), // Include 'v' in schema to test without alias
            }),
          )
          .action((args) => args),
      );

      // No aliases defined, -v should work as 'v' key if it's in the schema
      const result = program.parse('test -v');

      expect(result.args?.v).toBe(true);
      expect(result.args?.verbose).toBeUndefined();
    });

    it('should display aliases in help text', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .describe('Enable verbose output')
                .meta({ alias: ['v'] }),
              help: z
                .boolean()
                .optional()
                .describe('Show help information')
                .meta({ alias: ['h'] }),
            }),
          )
          .action(),
      );

      const helpText = program.help('test');

      expect(helpText).toContain('--[no-]verbose');
      expect(helpText).toContain('--[no-]help');
      expect(helpText).toContain('-v');
      expect(helpText).toContain('-h');
    });

    it('should work with nested commands', () => {
      const program = createPadrone('padrone-test').command('parent', (c) =>
        c
          .command('child', (c2) =>
            c2
              .arguments(
                z.object({
                  verbose: z
                    .boolean()
                    .optional()
                    .meta({ alias: ['v'] }),
                }),
              )
              .action((args) => ({
                verbose: args?.verbose || false,
              })),
          )
          .action(),
      );

      const result = program.parse('parent child -v');

      expect(result.command.path).toBe('parent child');
      expect(result.args?.verbose).toBe(true);
    });

    it('should work with meta object', () => {
      const program = createPadrone('padrone-test').command('parent', (c) =>
        c
          .command('child', (c2) =>
            c2
              .arguments(
                z.object({
                  verbose: z.boolean().optional(),
                }),
                {
                  fields: {
                    verbose: {
                      alias: ['v'],
                    },
                  },
                },
              )
              .action((args) => ({
                verbose: args?.verbose || false,
              })),
          )
          .action(),
      );

      const result = program.parse('parent child -v');

      expect(result.command.path).toBe('parent child');
      expect(result.args?.verbose).toBe(true);
    });

    it('should handle multiple aliases for the same option', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .meta({ alias: ['v', 'verbose'] }),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test -v');

      expect(result.args?.verbose).toBe(true);
    });
  });

  describe('stringify', () => {
    it('should stringify a simple command with args', () => {
      const result = program.stringify('show', { id: 'task 1', priority: 'medium' });

      expect(result).toBe('show "task 1" --priority=medium');
    });

    it('should stringify a command with args and args', () => {
      const result = program.stringify('show', { id: 'task-1', priority: 'high', verbose: true });

      expect(result).toBe('show task-1 --priority=high --verbose');
    });

    it('should stringify a nested command', () => {
      const result = program.stringify('list extended', { status: 'pending', priority: 'medium' });

      expect(result).toBe('list extended --status=pending --priority=medium');
    });

    it('should stringify a command with multiple args', () => {
      const result = program.stringify('batch', { ids: ['task-1', 'task-2', 'task-3'] });

      expect(result).toBe('batch task-1 task-2 task-3');
    });

    it('should stringify args with spaces using quotes', () => {
      const result = program.stringify('batch', { ids: ['task one', 'task two'] });

      expect(result).toBe('batch "task one" "task two"');
    });

    it('should stringify args with string values containing spaces', () => {
      const result = program.stringify('filter', { status: 'in_progress', priority: 'high' });

      expect(result).toBe('filter --status=in_progress --priority=high');
    });

    it('should stringify false boolean args with no- prefix', () => {
      const result = program.stringify('filter', { ascending: false });

      expect(result).toBe('filter --no-ascending');
    });

    it('should stringify numeric args', () => {
      const result = program.stringify('list', { limit: 5, priority: 'high' });

      expect(result).toBe('list --limit=5 --priority=high');
    });

    it('should omit undefined args', () => {
      const result = program.stringify('show', { id: 'task-1', priority: 'high', verbose: undefined });

      expect(result).toBe('show task-1 --priority=high');
    });

    it('should handle command with no args and no args', () => {
      const result = program.stringify('noop', undefined);

      expect(result).toBe('noop');
    });

    it('should throw error for non-existent command', () => {
      expect(() => {
        program.stringify('nonexistent', {});
      }).toThrow('Command "nonexistent" not found');
    });

    it('should handle empty ids array', () => {
      const result = program.stringify('batch', { ids: [] });

      expect(result).toBe('batch');
    });

    it('should roundtrip: stringify then parse produces same result', () => {
      const original = { command: 'show' as const, args: { id: 'task-1', priority: 'high' as const, verbose: true } };
      const stringified = program.stringify(original.command, original.args);
      const parsed = program.parse<'show'>(stringified);

      expect(parsed.command.path).toBe(original.command);
      expect(parsed.args?.id).toEqual(original.args.id);
      expect(parsed.args?.priority).toBe(original.args.priority);
      expect(parsed.args?.verbose).toBe(original.args.verbose);
    });

    it('should stringify variadic args as multiple flags', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              include: z.array(z.string()).optional(),
            }),
          )
          .action(),
      );

      const result = program.stringify('test', { include: ['src', 'lib', 'tests'] });
      expect(result).toBe('test --include=src --include=lib --include=tests');
    });
  });

  describe('variadic args', () => {
    it('should collect repeated args into an array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              include: z.array(z.string()).optional(),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --include=src --include=lib --include=tests');

      expect(result.args?.include).toEqual(['src', 'lib', 'tests']);
    });

    it('should work with aliases for variadic args', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              include: z.array(z.string()).optional(),
            }),
            { fields: { include: { alias: ['i'] } } },
          )
          .action((args) => args),
      );

      const result = program.parse('test -i=src -i=lib --include=tests');

      expect(result.args?.include).toEqual(['src', 'lib', 'tests']);
    });

    it('should handle variadic args with space-separated values', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              tag: z.array(z.string()).optional(),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --tag one --tag two --tag three');

      expect(result.args?.tag).toEqual(['one', 'two', 'three']);
    });

    it('should display variadic args in help text', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              include: z.array(z.string()).optional().describe('Files to include'),
            }),
          )
          .action(),
      );

      const helpText = program.help('test');

      expect(helpText).toContain('--include');
      expect(helpText).toContain('(repeatable)');
    });
  });

  describe('negatable boolean args', () => {
    it('should parse --no-<option> as false', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z.boolean().optional().default(true),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --no-verbose');

      expect(result.args?.verbose).toBe(false);
    });

    it('should parse --<option> as true', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z.boolean().optional().default(false),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --verbose');

      expect(result.args?.verbose).toBe(true);
    });

    it('should display negatable args in help text', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z.boolean().optional().describe('Enable verbose output'),
            }),
          )
          .action(),
      );

      const helpText = program.help('test');

      expect(helpText).toContain('--[no-]verbose');
    });

    it('should stringify false boolean to --no-<option>', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z.boolean().optional(),
            }),
          )
          .action(),
      );

      const result = program.stringify('test', { verbose: false });

      expect(result).toBe('test --no-verbose');
    });

    it('should not show --[no-] prefix when explicit noOption property exists', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              verbose: z.boolean().optional().describe('Enable verbose output'),
              noVerbose: z.boolean().optional().describe('Disable verbose output'),
            }),
          )
          .action(),
      );

      const helpText = program.help('test');

      // verbose should NOT be shown as --[no-]verbose since noVerbose exists
      expect(helpText).toContain('--verbose');
      expect(helpText).not.toContain('--[no-]verbose');
      // noVerbose should also not be negatable (it's the negation itself)
      expect(helpText).toContain('--noVerbose');
      expect(helpText).not.toContain('--[no-]noVerbose');
    });

    it('should handle kebab-case no-option property', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              debug: z.boolean().optional().describe('Enable debug mode'),
              'no-debug': z.never(),
            }),
          )
          .action(),
      );

      const helpText = program.help('test');

      // debug should NOT be shown as --[no-]debug since no-debug exists
      expect(helpText).toContain('--debug');
      expect(helpText).not.toContain('--[no-]debug');
    });
  });

  describe('environment variable binding', () => {
    it('should apply env var when option is not provided', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              apiKey: z.string().optional(),
            }),
          )
          .env(z.object({ API_KEY: z.string().optional() }).transform((env) => ({ apiKey: env.API_KEY })))
          .action((args) => args),
      );

      const result = program.parse('test', { env: { API_KEY: 'secret123' } });

      expect(result.args?.apiKey).toBe('secret123');
    });

    it('should prefer CLI value over env var', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              apiKey: z.string().optional(),
            }),
          )
          .env(z.object({ API_KEY: z.string().optional() }).transform((env) => ({ apiKey: env.API_KEY })))
          .action((args) => args),
      );

      const result = program.parse('test --apiKey=from-cli', { env: { API_KEY: 'from-env' } });

      expect(result.args?.apiKey).toBe('from-cli');
    });

    it('should support multiple env var names (fallback)', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.coerce.number().optional(),
            }),
          )
          .env(
            z
              .object({ PORT: z.string().optional(), APP_PORT: z.string().optional() })
              .transform((env) => ({ port: env.PORT ? Number(env.PORT) : env.APP_PORT ? Number(env.APP_PORT) : undefined })),
          )
          .action((args) => args),
      );

      // First env var not set, second one is
      const result = program.parse('test', { env: { APP_PORT: '8080' } });

      expect(result.args?.port).toBe(8080);
    });

    it('should parse boolean env vars correctly', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              debug: z.boolean().optional(),
            }),
          )
          .env(z.object({ DEBUG: z.string().optional() }).transform((env) => ({ debug: env.DEBUG === 'true' ? true : undefined })))
          .action((args) => args),
      );

      const result = program.parse('test', { env: { DEBUG: 'true' } });

      expect(result.args?.debug).toBe(true);
    });
  });

  describe('quoted string parsing', () => {
    it('should parse double-quoted strings with spaces', () => {
      const result = program.parse('show "task one" --priority high');

      expect(result.args?.id).toEqual('task one');
      expect(result.args?.priority).toBe('high');
    });

    it('should parse single-quoted strings with spaces', () => {
      const result = program.parse("show 'task two' --priority high");

      expect(result.args?.id).toEqual('task two');
      expect(result.args?.priority).toBe('high');
    });

    it('should parse quoted option values', () => {
      const result = program.parse('filter --status="in_progress" --priority high');

      expect(result.args?.status).toBe('in_progress');
      expect(result.args?.priority).toBe('high');
    });

    it('should handle escaped quotes within quoted strings', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c.arguments(z.object({ message: z.string() }), { positional: ['message'] }).action((args) => ({ message: args.message })),
      );

      const result = program.parse('test "He said \\"hello\\""');

      expect(result.args?.message).toBe('He said "hello"');
    });

    it('should handle multiple quoted arguments', () => {
      const result = program.parse('batch "task one" "task two" "task three"');

      expect(result.args?.ids).toEqual(['task one', 'task two', 'task three']);
    });
  });

  describe('config file support', () => {
    it('should apply config values when args are not provided', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.coerce.number().optional(),
              host: z.string().optional(),
            }),
          )
          .configFile(
            'config.json',
            z.object({ server: z.object({ port: z.number(), host: z.string() }) }).transform((data) => data.server),
          )
          .action((args) => args),
      );

      const configData = {
        server: {
          port: 3000,
          host: 'localhost',
        },
      };

      const result = program.cli('test', { configData });

      expect(result.args?.port).toBe(3000);
      expect(result.args?.host).toBe('localhost');
    });

    it('should prefer CLI value over config value', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.coerce.number().optional(),
            }),
          )
          .configFile(
            'config.json',
            z.object({ server: z.object({ port: z.number() }) }).transform((data) => ({ port: data.server.port })),
          )
          .action((args) => args),
      );

      const configData = { server: { port: 3000 } };
      const result = program.cli('test --port=8080', { configData });

      expect(result.args?.port).toBe(8080);
    });

    it('should prefer env value over config value', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.coerce.number().optional(),
            }),
          )
          .env(z.object({ PORT: z.string().optional() }).transform((env) => ({ port: env.PORT ? Number(env.PORT) : undefined })))
          .configFile(
            'config.json',
            z.object({ server: z.object({ port: z.number() }) }).transform((data) => ({ port: data.server.port })),
          )
          .action((args) => args),
      );

      const configData = { server: { port: 3000 } };
      const result = program.cli('test', { configData, env: { PORT: '9000' } });

      expect(result.args?.port).toBe(9000);
    });

    it('should handle deeply nested config with schema transforms', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              timeout: z.coerce.number().optional(),
            }),
          )
          .configFile(
            'config.json',
            z
              .object({ services: z.object({ api: z.object({ connection: z.object({ timeout: z.number() }) }) }) })
              .transform((data) => ({ timeout: data.services.api.connection.timeout })),
          )
          .action((args) => args),
      );

      const configData = {
        services: {
          api: {
            connection: {
              timeout: 5000,
            },
          },
        },
      };

      const result = program.cli('test', { configData });

      expect(result.args?.timeout).toBe(5000);
    });
  });

  describe('configFile method', () => {
    it('should validate config data against schema', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.number().optional(),
              host: z.string().optional(),
            }),
          )
          .configFile('config.json', z.object({ port: z.number(), host: z.string() }))
          .action((args) => args),
      );

      const configData = { port: 3000, host: 'localhost' };
      const result = program.cli('test', { configData });

      expect(result.args?.port).toBe(3000);
      expect(result.args?.host).toBe('localhost');
    });

    it('should throw error when config data fails validation', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.number().optional(),
            }),
          )
          .configFile('config.json', z.object({ port: z.number() }))
          .action((args) => args),
      );

      const configData = { port: 'not-a-number' };

      expect(() => program.cli('test', { configData })).toThrow(/Invalid config file/);
    });

    it('should transform config data using schema', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.number().optional(),
            }),
          )
          .configFile(
            'config.json',
            z.object({ serverPort: z.number() }).transform((data) => ({ port: data.serverPort })),
          )
          .action((args) => args),
      );

      const configData = { serverPort: 8080 };
      const result = program.cli('test', { configData });

      expect(result.args?.port).toBe(8080);
    });

    it('should use function-based schema with access to args schema', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.number().optional(),
              host: z.string().optional(),
            }),
          )
          .configFile('config.json', (argsSchema) => argsSchema.partial())
          .action((args) => args),
      );

      const configData = { port: 3000 };
      const result = program.cli('test', { configData });

      expect(result.args?.port).toBe(3000);
    });

    it('should set configFiles as array when given string', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(z.object({ name: z.string().optional() }))
          .configFile('myapp.config.json')
          .action((args) => args),
      );

      const command = program.find('test');
      expect(command?.configFiles).toEqual(['myapp.config.json']);
    });

    it('should set configFiles as array when given array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(z.object({ name: z.string().optional() }))
          .configFile(['myapp.config.json', '.myapprc'])
          .action((args) => args),
      );

      const command = program.find('test');
      expect(command?.configFiles).toEqual(['myapp.config.json', '.myapprc']);
    });

    it('should inherit config schema from parent command', () => {
      const configSchema = z.object({ port: z.number() });

      const program = createPadrone('padrone-test')
        .configFile('config.json', configSchema)
        .command('sub', (c) => c.arguments(z.object({ port: z.number().optional() })).action((args) => args));

      const configData = { port: 3000 };
      const result = program.cli('sub', { configData });

      expect(result.args?.port).toBe(3000);
    });

    it('should allow CLI args to override validated config values', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              port: z.coerce.number().optional(),
            }),
          )
          .configFile('config.json', z.object({ port: z.number() }))
          .action((args) => args),
      );

      const configData = { port: 3000 };
      const result = program.cli('test --port=8080', { configData });

      expect(result.args?.port).toBe(8080);
    });
  });

  describe('array syntax with brackets', () => {
    it('should parse [a,b,c] as an array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              tags: z.array(z.string()).optional(),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --tags=[a,b,c]');

      expect(result.args?.tags).toEqual(['a', 'b', 'c']);
    });

    it('should parse empty brackets as empty array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              tags: z.array(z.string()).optional(),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --tags=[]');

      expect(result.args?.tags).toEqual([]);
    });

    it('should handle quoted values within array brackets', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              names: z.array(z.string()).optional(),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --names=["hello world","foo bar"]');

      expect(result.args?.names).toEqual(['hello world', 'foo bar']);
    });

    it('should handle mixed quoted and unquoted values in array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              items: z.array(z.string()).optional(),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --items=[simple,"with space",another]');

      expect(result.args?.items).toEqual(['simple', 'with space', 'another']);
    });

    it('should combine array syntax with variadic args', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              include: z.array(z.string()).optional(),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --include=[a,b] --include=c --include=[d,e]');

      expect(result.args?.include).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('should work with short aliases', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              tags: z.array(z.string()).optional(),
            }),
            { fields: { tags: { alias: ['t'] } } },
          )
          .action((args) => args),
      );

      const result = program.parse('test -t=[one,two,three]');

      expect(result.args?.tags).toEqual(['one', 'two', 'three']);
    });

    it('should trim whitespace from array items', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .arguments(
            z.object({
              items: z.array(z.string()).optional(),
            }),
          )
          .action((args) => args),
      );

      const result = program.parse('test --items=[  a  ,  b  ,  c  ]');

      expect(result.args?.items).toEqual(['a', 'b', 'c']);
    });
  });

  describe('help and version commands', () => {
    it('should show help with --help flag', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'A test CLI application', version: '1.2.3' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('--help');

      expect(result.result as string).toContain('test-cli');
    });

    it('should show help with -h flag', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'A test CLI application', version: '1.2.3' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('-h');

      expect(result.result as string).toContain('test-cli');
    });

    it('should show help for specific command with --help flag', () => {
      const program = createPadrone('test-cli').command('greet', (c) =>
        c
          .arguments(z.object({ name: z.string().describe('Name to greet') }), { positional: ['name'] })
          .action((args) => `Hello, ${args.name}!`),
      );

      const result = program.cli('greet --help');

      expect(result.result as string).toContain('greet');
    });

    it('should show help for nested command with --help flag', () => {
      const program = createPadrone('test-cli').command('git', (c) =>
        c.command('commit', (c) =>
          c.arguments(z.object({ message: z.string().describe('Commit message') })).action((args) => args?.message),
        ),
      );

      const result = program.cli('git commit --help');

      expect(result.result as string).toContain('commit');
      expect(result.result as string).toContain('message');
    });

    it('should show help with help command', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'A test CLI application', version: '1.2.3' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('help');

      expect(result.result as string).toContain('test-cli');
    });

    it('should show help for specific command with help command', () => {
      const program = createPadrone('test-cli').command('greet', (c) =>
        c
          .arguments(z.object({ name: z.string().describe('Name to greet') }), { positional: ['name'] })
          .action((args) => `Hello, ${args.name}!`),
      );

      const result = program.cli('help greet');

      expect(result.result as string).toContain('greet');
    });

    it('should show help for nested command with help command', () => {
      const program = createPadrone('test-cli').command('git', (c) =>
        c.command('commit', (c) =>
          c.arguments(z.object({ message: z.string().describe('Commit message') })).action((args) => args?.message),
        ),
      );

      const result = program.cli('help git commit');

      expect(result.result as string).toContain('commit');
      expect(result.result as string).toContain('message');
    });

    it('should show version with --version flag', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'A test CLI application', version: '1.2.3' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('--version');

      expect(result.result as string).toBe('1.2.3');
    });

    it('should show version with -v flag', () => {
      const program = createPadrone('test-cli')
        .configure({ version: '2.0.0' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('-v');

      expect(result.result as string).toBe('2.0.0');
    });

    it('should show version with -V flag', () => {
      const program = createPadrone('test-cli')
        .configure({ version: '3.0.0' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('-V');

      expect(result.result as string).toBe('3.0.0');
    });

    it('should show version with version command', () => {
      const program = createPadrone('test-cli')
        .configure({ version: '4.0.0' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('version');

      expect(result.result as string).toBe('4.0.0');
    });

    it('should auto-detect version from package.json when not explicitly set', () => {
      const program = createPadrone('test-cli').command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('--version');

      // Should auto-detect from package.json (0.0.1) or npm_package_version env var
      // The actual value depends on the environment, so we just check it's not empty
      expect(result.result as string).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should allow user to override help command', () => {
      const program = createPadrone('test-cli')
        .configure({ version: '1.0.0' })
        .command('help', (c) => c.action(() => 'Custom help!'))
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('help');

      expect(result.result).toBe('Custom help!');
    });

    it('should allow user to override version command', () => {
      const program = createPadrone('test-cli')
        .configure({ version: '1.0.0' })
        .command('version', (c) => c.action(() => 'Custom version info'))
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('version');

      expect(result.result).toBe('Custom version info');
    });

    it('should still show help with --help flag even when help command is overridden', () => {
      const program = createPadrone('test-cli')
        .configure({ version: '1.0.0' })
        .command('help', (c) => c.action(() => 'Custom help!'))
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('--help');

      // --help flag should still use built-in help
      expect(result.result as string).toContain('test-cli');
    });

    it('should set description on program', () => {
      const program = createPadrone('test-cli').configure({ description: 'My awesome CLI tool' });

      const result = program.cli('--help');

      expect(result.result as string).toContain('My awesome CLI tool');
    });

    it('should chain description and version', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'My awesome CLI tool', version: '5.0.0' })
        .command('greet', (c) => c.action(() => 'hello'));

      const helpResult = program.cli('--help');
      const versionResult = program.cli('--version');

      expect(helpResult.result as string).toContain('My awesome CLI tool');
      expect(versionResult.result as string).toBe('5.0.0');
    });

    it('should accept --detail flag for help', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'My CLI' })
        .command('greet', (c) => c.action(() => 'hello'));

      const minimalResult = program.cli('--help --detail=minimal');
      const standardResult = program.cli('--help --detail=standard');
      const fullResult = program.cli('--help --detail=full');

      // All should produce help output
      expect(minimalResult.result as string).toContain('test-cli');
      expect(standardResult.result as string).toContain('test-cli');
      expect(fullResult.result as string).toContain('test-cli');
    });

    it('should accept -d shorthand for detail flag', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'My CLI' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('--help -d full');

      expect(result.result as string).toContain('test-cli');
    });

    it('should accept detail flag with help command', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'My CLI' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('help --detail=full');

      expect(result.result as string).toContain('test-cli');
    });

    it('should accept detail flag for subcommand help', () => {
      const program = createPadrone('test-cli').command('greet', (c) =>
        c.arguments(z.object({ name: z.string().describe('Name') }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

      const result = program.cli('greet --help --detail=full');

      expect(result.result as string).toContain('greet');
    });

    it('should accept --format flag for help', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'My CLI' })
        .command('greet', (c) => c.action(() => 'hello'));

      const textResult = program.cli('--help --format=text');
      const markdownResult = program.cli('--help --format=markdown');
      const jsonResult = program.cli('--help --format=json');

      // All should produce help output
      expect(textResult.result as string).toContain('test-cli');
      expect(markdownResult.result as string).toContain('test-cli');
      expect(jsonResult.result as string).toContain('test-cli');
    });

    it('should accept -f shorthand for format flag', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'My CLI' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('--help -f markdown');

      expect(result.result as string).toContain('test-cli');
    });

    it('should accept format flag with help command', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'My CLI' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('help --format=json');

      expect(result.result as string).toContain('test-cli');
    });

    it('should combine format and detail flags', () => {
      const program = createPadrone('test-cli')
        .configure({ description: 'My CLI' })
        .command('greet', (c) => c.action(() => 'hello'));

      const result = program.cli('--help --format=markdown --detail=full');

      expect(result.result as string).toContain('test-cli');
    });

    it('should load config from --config flag', () => {
      // Create a temp config file
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');

      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'padrone-test-'));
      const configPath = path.join(configDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ server: { port: 9999 } }));

      try {
        const program = createPadrone('test-cli').command('serve', (c) =>
          c
            .arguments(z.object({ port: z.coerce.number().optional() }))
            .configFile(
              'config.json',
              z.object({ server: z.object({ port: z.number() }) }).transform((data) => ({ port: data.server.port })),
            )
            .action((args) => args?.port),
        );

        const result = program.cli(`serve --config=${configPath}`);

        expect(result.result).toBe(9999);
      } finally {
        fs.unlinkSync(configPath);
        fs.rmdirSync(configDir);
      }
    });

    it('should load config from -c shorthand', () => {
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');

      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'padrone-test-'));
      const configPath = path.join(configDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ host: 'example.com' }));

      try {
        const program = createPadrone('test-cli').command('connect', (c) =>
          c
            .arguments(z.object({ host: z.string().optional() }))
            .configFile('config.json', z.object({ host: z.string() }))
            .action((args) => args?.host),
        );

        const result = program.cli(`connect -c ${configPath}`);

        expect(result.result).toBe('example.com');
      } finally {
        fs.unlinkSync(configPath);
        fs.rmdirSync(configDir);
      }
    });

    it('should allow CLI args to override config file values', () => {
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');

      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'padrone-test-'));
      const configPath = path.join(configDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ server: { port: 3000 } }));

      try {
        const program = createPadrone('test-cli').command('serve', (c) =>
          c
            .arguments(z.object({ port: z.coerce.number().optional() }))
            .configFile(
              'config.json',
              z.object({ server: z.object({ port: z.number() }) }).transform((data) => ({ port: data.server.port })),
            )
            .action((args) => args?.port),
        );

        const result = program.cli(`serve --config=${configPath} --port=8080`);

        // CLI option should override config file
        expect(result.result).toBe(8080);
      } finally {
        fs.unlinkSync(configPath);
        fs.rmdirSync(configDir);
      }
    });
  });

  describe('nested object args (dot notation)', () => {
    it('should parse --key.nested=value as nested object', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ user: z.object({ id: z.coerce.number() }).optional() })).action((args) => args),
      );

      const result = program.parse('test --user.id=123');

      expect(result.args?.user).toEqual({ id: 123 });
    });

    it('should parse deeply nested args', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ server: z.object({ database: z.object({ host: z.string() }) }).optional() })).action((args) => args),
      );

      const result = program.parse('test --server.database.host=localhost');

      expect(result.args?.server).toEqual({ database: { host: 'localhost' } });
    });

    it('should combine multiple nested args into same object', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ user: z.object({ name: z.string(), age: z.coerce.number() }).optional() })).action((args) => args),
      );

      const result = program.parse('test --user.name=John --user.age=30');

      expect(result.args?.user).toEqual({ name: 'John', age: 30 });
    });

    it('should handle nested boolean values', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ config: z.object({ debug: z.boolean() }).optional() })).action((args) => args),
      );

      const result = program.parse('test --config.debug');

      expect(result.args?.config).toEqual({ debug: true });
    });

    it('should handle negated nested boolean values', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ config: z.object({ debug: z.boolean().default(true) }).optional() })).action((args) => args),
      );

      const result = program.parse('test --no-config.debug');

      expect(result.args?.config).toEqual({ debug: false });
    });

    it('should stringify nested objects to dot notation', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ user: z.object({ id: z.number(), name: z.string() }).optional() })).action((args) => args),
      );

      const result = program.stringify('test', { user: { id: 123, name: 'John' } });

      expect(result).toContain('--user.id=123');
      expect(result).toContain('--user.name=John');
    });

    it('should stringify deeply nested objects', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ server: z.object({ db: z.object({ host: z.string() }) }).optional() })).action((args) => args),
      );

      const result = program.stringify('test', { server: { db: { host: 'localhost' } } });

      expect(result).toBe('test --server.db.host=localhost');
    });

    it('should roundtrip nested objects through stringify and parse', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ config: z.object({ port: z.coerce.number(), host: z.string() }).optional() })).action((args) => args),
      );

      const original = { config: { port: 8080, host: 'example.com' } };
      const stringified = program.stringify('test', original);
      const parsed = program.parse(stringified);

      expect(parsed.args?.config).toEqual(original.config);
    });

    it('should handle nested args with quoted string values', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ message: z.object({ text: z.string() }).optional() })).action((args) => args),
      );

      const result = program.parse('test --message.text="Hello World"');

      expect(result.args?.message).toEqual({ text: 'Hello World' });
    });

    it('should work with CLI execution', () => {
      const program = createPadrone('test-cli').command('test', (c) =>
        c.arguments(z.object({ settings: z.object({ verbose: z.boolean().default(false) }).optional() })).action((args) => args?.settings),
      );

      const result = program.cli('test --settings.verbose');

      expect(result.result).toEqual({ verbose: true });
    });
  });

  describe('validation errors', () => {
    it('should return result with issues when called with explicit input and option fails url validation', () => {
      const handler = mock((args: any) => args);
      const program = createPadrone('test-cli').command('fetch', (c) =>
        c.arguments(z.object({ url: z.url().describe('URL to fetch') })).action(handler),
      );

      const result = program.cli('fetch --url not-a-valid-url');

      expect(result.argsResult?.issues).toBeDefined();
      expect(result.args).toBeUndefined();
      expect(result.result).toBeUndefined();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return result with issues for enum option with invalid value', () => {
      const program = createPadrone('test-cli').command('cmd', (c) =>
        c.arguments(z.object({ priority: z.enum(['low', 'medium', 'high']).describe('Priority') })).action((args) => args),
      );

      const result = program.cli('cmd --priority invalid');

      expect(result.argsResult?.issues).toBeDefined();
      expect(result.args).toBeUndefined();
    });

    it('should not call action when validation fails with explicit input', () => {
      const handler = mock(() => 'called');
      const program = createPadrone('test-cli').command('fetch', (c) =>
        c.arguments(z.object({ url: z.url().describe('URL to fetch') })).action(handler),
      );

      program.cli('fetch --url not-a-valid-url');

      expect(handler).not.toHaveBeenCalled();
    });

    it('should throw and print error when called without arguments and validation fails', () => {
      const originalArgv = process.argv;
      process.argv = ['node', 'test-cli', 'fetch', '--url', 'not-a-valid-url'];

      const program = createPadrone('test-cli').command('fetch', (c) =>
        c.arguments(z.object({ url: z.url().describe('URL to fetch') })).action((args) => args),
      );

      try {
        program.cli();
        expect.unreachable('Expected cli() to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain('Validation error:');
        expect(console.error).toHaveBeenCalledTimes(2);
      } finally {
        process.argv = originalArgv;
      }
    });

    it('should not throw when validation passes', () => {
      const program = createPadrone('test-cli').command('fetch', (c) =>
        c.arguments(z.object({ url: z.url().describe('URL to fetch') })).action((args) => args),
      );

      expect(() => program.cli('fetch --url https://example.com')).not.toThrow();
    });
  });

  describe('async validation', () => {
    it('should return a Promise when using asyncSchema()', async () => {
      const schema = asyncSchema(
        z.object({ name: z.string() }).check(async (_ctx) => {
          // async refinement
        }),
      );

      const program = createPadrone('test-async').command('greet', (c) => c.arguments(schema).action((args) => `Hello, ${args.name}!`));

      const parseResult = program.parse('greet --name Alice');
      expect(parseResult).toBeInstanceOf(Promise);
      const resolved = await parseResult;
      expect(resolved.args).toEqual({ name: 'Alice' });

      const cliResult = program.cli('greet --name Alice');
      expect(cliResult).toBeInstanceOf(Promise);
      const resolvedCli = await cliResult;
      expect(resolvedCli.result).toBe('Hello, Alice!');
    });

    it('should return a Promise when using .async()', async () => {
      const program = createPadrone('test-async').command('greet', (c) =>
        c
          .arguments(z.object({ name: z.string() }))
          .async()
          .action((args) => `Hello, ${args.name}!`),
      );

      const result = program.parse('greet --name Bob');
      // .async() marks the type as async, but if the schema is actually sync,
      // thenMaybe will return synchronously at runtime
      const resolved = await result;
      expect(resolved.args).toEqual({ name: 'Bob' });
    });

    it('should return sync value for non-async commands', () => {
      const program = createPadrone('test-sync').command('greet', (c) =>
        c.arguments(z.object({ name: z.string() })).action((args) => `Hello, ${args.name}!`),
      );

      const result = program.parse('greet --name Charlie');
      expect(result).not.toBeInstanceOf(Promise);
      expect((result as any).args).toEqual({ name: 'Charlie' });
    });

    it('should warn when validation returns Promise but command not marked async', async () => {
      const errorSpy = mock();
      const originalError = console.error;
      console.error = errorSpy;

      try {
        // Create a schema with async validation but DON'T brand it
        const schema = z.object({ name: z.string() }).check(async (_ctx) => {
          // async refinement without branding
        });

        const program = createPadrone('test-warn').command('greet', (c) =>
          c.arguments(schema as any).action((args: any) => `Hello, ${args.name}!`),
        );

        const result = program.parse('greet --name Alice');
        // Should still work, just with a warning via runtime.error
        if (result instanceof Promise) {
          await result;
          expect(errorSpy).toHaveBeenCalledTimes(1);
          expect(errorSpy.mock.calls[0]![0]).toContain('[padrone]');
          expect(errorSpy.mock.calls[0]![0]).toContain('not marked as async');
        }
      } finally {
        console.error = originalError;
      }
    });
  });
});
