import { describe, expect, it } from 'bun:test';
import * as z from 'zod/v4';
import { createPadrone } from '../src/index';
import { createWeatherProgram } from './common';
import { createConsoleMocker } from './console-mocker';

describe('CLI', () => {
  const program = createWeatherProgram();
  createConsoleMocker();

  describe('programmatic execution', () => {
    it('should execute a simple command with args and options', () => {
      const result = program.run('current', { city: 'New York', unit: 'celsius', verbose: true });

      expect(result.command.path).toBe('current');
      expect(result.options).toMatchInlineSnapshot(`
        {
          "city": "New York",
          "unit": "celsius",
          "verbose": true,
        }
      `);
      expect(result.result.city).toBe('New York');
      expect(result.result.temperature).toBe(22);
      expect(result.result.humidity).toBe(65);
    });

    it('should execute a command with default options', () => {
      const result = program.run('current', { city: 'London' });

      expect(result.command.path).toBe('current');
      expect(result.result.temperature).toBe(72); // Default fahrenheit
      expect(result.result.humidity).toBeUndefined(); // verbose not set
    });

    it('should execute nested commands', () => {
      const result = program.run('forecast extended', { city: 'Tokyo', unit: 'celsius' });

      expect(result.command.path).toBe('forecast extended');
      expect(result.options?.city).toEqual('Tokyo');
      expect(result.options?.unit).toEqual('celsius');
      expect(result.result.city).toBe('Tokyo');
      expect(result.result.extendedForecast).toBeDefined();
    });

    it('should execute a command with array args', () => {
      const result = program.run('compare', { cities: ['New York', 'London', 'Tokyo'] });

      expect(result.command.path).toBe('compare');
      expect(result.options?.cities).toEqual(['New York', 'London', 'Tokyo']);
      expect(result.result.cities).toEqual(['New York', 'London', 'Tokyo']);
      expect(result.result.comparison).toHaveLength(3);
    });

    it('should execute a command with void args and options', () => {
      const result = program.run('noop', undefined);

      expect(result.command.path).toBe('noop');
      expect(result.options).toBeUndefined();
      expect(result.result).toBeUndefined();
    });
  });

  describe('CLI parsing', () => {
    it('should parse simple command with args', () => {
      const result = program.parse('current Paris');

      expect(result.command.path).toBe('current');
      expect(result.options?.city).toEqual('Paris');
      expect(result.options?.unit).toEqual('fahrenheit');
    });

    it('should parse command with options', () => {
      const result = program.parse('current London --unit celsius --verbose');

      expect(result.command.path).toBe('current');
      expect(result.options?.city).toEqual('London');
      expect(result.options?.unit).toEqual('celsius');
      expect(result.options?.verbose).toBe(true);
    });

    it('should parse command with option values', () => {
      const result = program.parse('forecast Tokyo --days=5 --unit fahrenheit');

      expect(result.command.path).toBe('forecast');
      expect(result.options?.city).toEqual('Tokyo');
      expect(result.options?.days).toEqual(5);
      expect(result.options?.unit).toEqual('fahrenheit');
    });

    it('should parse nested commands', () => {
      const result = program.parse('forecast extended Berlin --unit celsius');

      expect(result.command.path).toBe('forecast extended');
      expect(result.options?.city).toEqual('Berlin');
      expect(result.options?.unit).toEqual('celsius');
    });

    it('should parse command with multiple args', () => {
      const result = program.parse('compare New York London Tokyo');

      expect(result.command.path).toBe('compare');
      // Note: Parser splits on spaces, so "New York" becomes separate elements
      expect(result.options?.cities).toEqual(['New', 'York', 'London', 'Tokyo']);
    });

    it('should parse command with complex options', () => {
      const result = program.parse('alerts --region "West Coast" --severity high');

      expect(result.command.path).toBe('alerts');
      expect(result.options).toEqual({ region: 'West Coast', severity: 'high' }); // Note: quotes are now properly parsed
    });

    it('should handle empty input', () => {
      const result = program.parse('');

      expect(result.command.path).toBe('');
      expect(result.options).toBeUndefined();
    });
  });

  describe('CLI execution', () => {
    it('should execute command via CLI string', () => {
      const result = program.cli('current Madrid --unit celsius');

      expect(result).toBeDefined();
      if (!result) throw new Error('Result is undefined');
      expect(result.command.path).toBe('current');
      expect(result.options?.city).toEqual('Madrid');
      expect(result.result.city).toBe('Madrid');
      expect(result.result.temperature).toBe(22);
    });

    it('should return undefined for empty CLI input', () => {
      expect(() => program.cli('')).toThrow('Command "" has no handler');
    });

    it('should execute nested command via CLI', () => {
      const result = program.cli('forecast extended Sydney --unit celsius');

      expect(result).toBeDefined();
      expect(result?.command.path).toBe('forecast extended');
      expect(result?.result.city).toBe('Sydney');
    });

    it('should throw error for non-existent command', () => {
      expect(() => {
        program.run('nonexistent' as any, {});
      }).toThrow('Command "nonexistent" not found');
    });
  });

  describe('command finding', () => {
    it('should find a top-level command', () => {
      const command = program.find('current');

      expect(command).toBeDefined();
      expect(command?.name).toBe('current');
    });

    it('should find a nested command', () => {
      const command = program.find('forecast extended');

      expect(command).toBeDefined();
      expect(command?.name).toBe('extended');
      expect(command?.path).toBe('forecast extended');
    });

    it('should return undefined for non-existent command', () => {
      const command = program.find('nonexistent');

      expect(command).toBeUndefined();
    });
  });

  describe('API generation', () => {
    it('should generate type-safe API for top-level commands', () => {
      const api = program.api();

      expect(api.current).toBeDefined();
      expect(typeof api.current).toBe('function');

      const result = api.current({ city: 'Berlin', unit: 'celsius', verbose: true });
      // API returns PadroneCommandResult, so access .result property
      expect(result.city).toBe('Berlin');
      expect(result.temperature).toBe(22);
    });

    it('should generate nested API structure', () => {
      const api = program.api();

      expect(api.forecast).toBeDefined();
      expect(typeof api.forecast).toBe('function');
      expect(api.forecast.extended).toBeDefined();
      expect(typeof api.forecast.extended).toBe('function');

      const result = api.forecast.extended({ city: 'Paris', unit: 'celsius' });
      // API returns PadroneCommandResult, so access .result property
      expect(result.city).toBe('Paris');
      expect(result.extendedForecast).toBeDefined();
    });

    it('should generate API for all commands', () => {
      const api = program.api();

      expect(api.current).toBeDefined();
      expect(api.forecast).toBeDefined();
      expect(api.alerts).toBeDefined();
      expect(api.compare).toBeDefined();
      expect(api.noop).toBeDefined();
    });

    it('should execute commands through API', () => {
      const api = program.api();

      const compareResult = api.compare({ cities: ['NYC', 'LA'] });
      // API returns PadroneCommandResult, so access .result property
      expect(compareResult.cities).toEqual(['NYC', 'LA']);

      const alertsResult = api.alerts({ region: 'California', severity: 'high' });
      expect(alertsResult.region).toBe('California');
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
        c.options(z.object({ city: z.string() }), { positional: ['city'] }).action((options) => ({ city: options.city })),
      );

      const result = program.run('test', { city: 'City' });
      expect(result.result.city).toBe('City');
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
      const result = program.parse('forecast extended');

      expect(result.command.path).toBe('forecast extended');
    });

    it('should handle options without values', () => {
      const result = program.parse('alerts --ascending');

      expect(result.command.path).toBe('alerts');
      expect(result.options?.ascending).toBe(true);
    });

    it('should handle multiple boolean options', () => {
      const result = program.parse('current Paris --verbose --unit celsius');

      expect(result.command.path).toBe('current');
      expect(result.options?.verbose).toBe(true);
      expect(result.options?.unit).toBe('celsius');
    });
  });

  describe('real-world weather CLI scenarios', () => {
    it('should handle checking current weather for multiple cities sequentially', () => {
      const cities = ['New York', 'London', 'Tokyo'];
      const results = cities.map((city) => program.run('current', { city, unit: 'celsius' }));

      expect(results).toHaveLength(3);
      results.forEach((result, i) => {
        expect(result.result.city).toBe(cities[i]!);
        expect(result.result.temperature).toBe(22);
      });
    });

    it('should handle getting forecast with custom days', () => {
      const result = program.run('forecast', { city: 'Miami', days: 5, unit: 'fahrenheit' });

      expect(result.result.days).toBe(5);
      expect(result.result.forecast).toHaveLength(2); // Mock data only has 2 days
    });

    it('should handle comparing weather across multiple cities', () => {
      const cities = ['Seattle', 'Portland', 'Vancouver'];
      const result = program.run('compare', { cities });

      expect(result.result?.comparison).toHaveLength(3);
      result.result?.comparison.forEach((comp: any, i: number) => {
        expect(comp.city).toBe(cities[i]);
        expect(comp.temp).toBeDefined();
        expect(comp.condition).toBeDefined();
      });
    });

    it('should handle checking alerts with filters', () => {
      const result = program.run('alerts', {
        region: 'West Coast',
        severity: 'high',
      });

      expect(result.result.region).toBe('West Coast');
      expect(result.result.severity).toBe('high');
      expect(result.result.alerts).toBeDefined();
    });
  });

  describe('alias functionality', () => {
    it('should resolve aliases to full option names when parsing', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
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
          .action((options) => ({
            verbose: options?.verbose,
            help: options?.help,
          })),
      );

      const result = program.parse('test -v -h');

      expect(result.command.path).toBe('test');
      expect(result.options?.verbose).toBe(true);
      expect(result.options?.help).toBe(true);
    });

    it('should resolve aliases with values', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
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
          .action((options) => options),
      );

      const result = program.parse('test -u celsius -c=5');

      expect(result.options?.unit).toBe('celsius');
      expect(result.options?.count).toBe(5);
    });

    it('should execute commands with aliases via CLI', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .meta({ alias: ['v'] }),
            }),
          )
          .action((options) => ({
            verbose: options?.verbose || false,
          })),
      );

      const result = program.cli('test -v');

      expect(result?.options?.verbose).toBe(true);
      expect(result?.result.verbose).toBe(true);
    });

    it('should handle aliases mixed with full option names', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
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
          .action((options) => options),
      );

      const result = program.parse('test -v --help -o=file.txt');

      expect(result.options?.verbose).toBe(true);
      expect(result.options?.help).toBe(true);
      expect(result.options?.output).toBe('file.txt');
    });

    it('should handle undefined aliases gracefully', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              verbose: z.boolean().optional(),
              v: z.boolean().optional(), // Include 'v' in schema to test without alias
            }),
          )
          .action((options) => options),
      );

      // No aliases defined, -v should work as 'v' key if it's in the schema
      const result = program.parse('test -v');

      expect(result.options?.v).toBe(true);
      expect(result.options?.verbose).toBeUndefined();
    });

    it('should display aliases in help text', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
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
              .options(
                z.object({
                  verbose: z
                    .boolean()
                    .optional()
                    .meta({ alias: ['v'] }),
                }),
              )
              .action((options) => ({
                verbose: options?.verbose || false,
              })),
          )
          .action(),
      );

      const result = program.parse('parent child -v');

      expect(result.command.path).toBe('parent child');
      expect(result.options?.verbose).toBe(true);
    });

    it('should work with meta object', () => {
      const program = createPadrone('padrone-test').command('parent', (c) =>
        c
          .command('child', (c2) =>
            c2
              .options(
                z.object({
                  verbose: z.boolean().optional(),
                }),
                {
                  options: {
                    verbose: {
                      alias: ['v'],
                    },
                  },
                },
              )
              .action((options) => ({
                verbose: options?.verbose || false,
              })),
          )
          .action(),
      );

      const result = program.parse('parent child -v');

      expect(result.command.path).toBe('parent child');
      expect(result.options?.verbose).toBe(true);
    });

    it('should handle multiple aliases for the same option', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .meta({ alias: ['v', 'verbose'] }),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test -v');

      expect(result.options?.verbose).toBe(true);
    });
  });

  describe('stringify', () => {
    it('should stringify a simple command with args', () => {
      const result = program.stringify('current', { city: 'New York', unit: 'fahrenheit' });

      expect(result).toBe('current "New York" --unit=fahrenheit');
    });

    it('should stringify a command with args and options', () => {
      const result = program.stringify('current', { city: 'London', unit: 'celsius', verbose: true });

      expect(result).toBe('current London --unit=celsius --verbose');
    });

    it('should stringify a nested command', () => {
      const result = program.stringify('forecast extended', { city: 'Tokyo', unit: 'fahrenheit' });

      expect(result).toBe('forecast extended Tokyo --unit=fahrenheit');
    });

    it('should stringify a command with multiple args', () => {
      const result = program.stringify('compare', { cities: ['NYC', 'LA', 'Chicago'] });

      expect(result).toBe('compare NYC LA Chicago');
    });

    it('should stringify args with spaces using quotes', () => {
      const result = program.stringify('compare', { cities: ['New York', 'Los Angeles'] });

      expect(result).toBe('compare "New York" "Los Angeles"');
    });

    it('should stringify options with string values containing spaces', () => {
      const result = program.stringify('alerts', { region: 'West Coast', severity: 'high' });

      expect(result).toBe('alerts --region="West Coast" --severity=high');
    });

    it('should stringify false boolean options with no- prefix', () => {
      const result = program.stringify('alerts', { ascending: false });

      expect(result).toBe('alerts --no-ascending');
    });

    it('should stringify numeric options', () => {
      const result = program.stringify('forecast', { city: 'Berlin', days: 5, unit: 'celsius' });

      expect(result).toBe('forecast Berlin --days=5 --unit=celsius');
    });

    it('should omit undefined options', () => {
      const result = program.stringify('current', { city: 'Paris', unit: 'celsius', verbose: undefined });

      expect(result).toBe('current Paris --unit=celsius');
    });

    it('should handle command with no args and no options', () => {
      const result = program.stringify('noop', undefined);

      expect(result).toBe('noop');
    });

    it('should throw error for non-existent command', () => {
      expect(() => {
        program.stringify('nonexistent' as any, {});
      }).toThrow('Command "nonexistent" not found');
    });

    it('should handle empty cities array', () => {
      const result = program.stringify('compare', { cities: [] });

      expect(result).toBe('compare');
    });

    it('should roundtrip: stringify then parse produces same result', () => {
      const original = { command: 'current' as const, options: { city: 'Tokyo', unit: 'celsius' as const, verbose: true } };
      const stringified = program.stringify(original.command, original.options);
      const parsed = program.parse(stringified);

      expect(parsed.command.path).toBe(original.command);
      expect((parsed.options as typeof original.options)?.city).toEqual(original.options.city);
      expect((parsed.options as typeof original.options)?.unit).toBe(original.options.unit);
      expect((parsed.options as typeof original.options)?.verbose).toBe(original.options.verbose);
    });

    it('should stringify variadic options as multiple flags', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
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

  describe('variadic options', () => {
    it('should collect repeated options into an array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              include: z.array(z.string()).optional(),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --include=src --include=lib --include=tests');

      expect(result.options?.include).toEqual(['src', 'lib', 'tests']);
    });

    it('should work with aliases for variadic options', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              include: z.array(z.string()).optional(),
            }),
            { options: { include: { alias: ['i'] } } },
          )
          .action((options) => options),
      );

      const result = program.parse('test -i=src -i=lib --include=tests');

      expect(result.options?.include).toEqual(['src', 'lib', 'tests']);
    });

    it('should handle variadic options with space-separated values', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              tag: z.array(z.string()).optional(),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --tag one --tag two --tag three');

      expect(result.options?.tag).toEqual(['one', 'two', 'three']);
    });

    it('should display variadic options in help text', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
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

  describe('negatable boolean options', () => {
    it('should parse --no-<option> as false', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              verbose: z.boolean().optional().default(true),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --no-verbose');

      expect(result.options?.verbose).toBe(false);
    });

    it('should parse --<option> as true', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              verbose: z.boolean().optional().default(false),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --verbose');

      expect(result.options?.verbose).toBe(true);
    });

    it('should display negatable options in help text', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
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
          .options(
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
          .options(
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
          .options(
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
          .options(
            z.object({
              apiKey: z.string().optional(),
            }),
            { options: { apiKey: { env: 'API_KEY' } } },
          )
          .action((options) => options),
      );

      const result = program.parse('test', { env: { API_KEY: 'secret123' } });

      expect(result.options?.apiKey).toBe('secret123');
    });

    it('should prefer CLI value over env var', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              apiKey: z.string().optional(),
            }),
            { options: { apiKey: { env: 'API_KEY' } } },
          )
          .action((options) => options),
      );

      const result = program.parse('test --apiKey=from-cli', { env: { API_KEY: 'from-env' } });

      expect(result.options?.apiKey).toBe('from-cli');
    });

    it('should support multiple env var names (fallback)', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              port: z.coerce.number().optional(),
            }),
            { options: { port: { env: ['PORT', 'APP_PORT'] } } },
          )
          .action((options) => options),
      );

      // First env var not set, second one is
      const result = program.parse('test', { env: { APP_PORT: '8080' } });

      expect(result.options?.port).toBe(8080);
    });

    it('should parse boolean env vars correctly', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              debug: z.boolean().optional(),
            }),
            { options: { debug: { env: 'DEBUG' } } },
          )
          .action((options) => options),
      );

      const result = program.parse('test', { env: { DEBUG: 'true' } });

      expect(result.options?.debug).toBe(true);
    });

    it('should display env var in help text', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              apiKey: z.string().optional().describe('API key for authentication'),
            }),
            { options: { apiKey: { env: 'API_KEY' } } },
          )
          .action(),
      );

      const helpText = program.help('test');

      expect(helpText).toContain('--apiKey');
      expect(helpText).toContain('API_KEY');
    });
  });

  describe('quoted string parsing', () => {
    it('should parse double-quoted strings with spaces', () => {
      const result = program.parse('current "New York" --unit celsius');

      expect(result.options?.city).toEqual('New York');
      expect(result.options?.unit).toBe('celsius');
    });

    it('should parse single-quoted strings with spaces', () => {
      const result = program.parse("current 'San Francisco' --unit celsius");

      expect(result.options?.city).toEqual('San Francisco');
      expect(result.options?.unit).toBe('celsius');
    });

    it('should parse quoted option values', () => {
      const result = program.parse('alerts --region="West Coast" --severity high');

      expect(result.options?.region).toBe('West Coast');
      expect(result.options?.severity).toBe('high');
    });

    it('should handle escaped quotes within quoted strings', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c.options(z.object({ message: z.string() }), { positional: ['message'] }).action((options) => ({ message: options.message })),
      );

      const result = program.parse('test "He said \\"hello\\""');

      expect(result.options?.message).toBe('He said "hello"');
    });

    it('should handle multiple quoted arguments', () => {
      const result = program.parse('compare "New York" "Los Angeles" "San Francisco"');

      expect(result.options?.cities).toEqual(['New York', 'Los Angeles', 'San Francisco']);
    });
  });

  describe('config file support', () => {
    it('should apply config values when options are not provided', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              port: z.coerce.number().optional(),
              host: z.string().optional(),
            }),
            {
              options: {
                port: { configKey: 'server.port' },
                host: { configKey: 'server.host' },
              },
            },
          )
          .action((options) => options),
      );

      const configData = {
        server: {
          port: 3000,
          host: 'localhost',
        },
      };

      const result = program.parse('test', { configData });

      expect(result.options?.port).toBe(3000);
      expect(result.options?.host).toBe('localhost');
    });

    it('should prefer CLI value over config value', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              port: z.coerce.number().optional(),
            }),
            { options: { port: { configKey: 'server.port' } } },
          )
          .action((options) => options),
      );

      const configData = { server: { port: 3000 } };
      const result = program.parse('test --port=8080', { configData });

      expect(result.options?.port).toBe(8080);
    });

    it('should prefer env value over config value', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              port: z.coerce.number().optional(),
            }),
            { options: { port: { configKey: 'server.port', env: 'PORT' } } },
          )
          .action((options) => options),
      );

      const configData = { server: { port: 3000 } };
      const result = program.parse('test', { configData, env: { PORT: '9000' } });

      expect(result.options?.port).toBe(9000);
    });

    it('should handle deeply nested config keys', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              timeout: z.coerce.number().optional(),
            }),
            { options: { timeout: { configKey: 'services.api.connection.timeout' } } },
          )
          .action((options) => options),
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

      const result = program.parse('test', { configData });

      expect(result.options?.timeout).toBe(5000);
    });

    it('should display config key in help text', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              port: z.coerce.number().optional().describe('Server port'),
            }),
            { options: { port: { configKey: 'server.port' } } },
          )
          .action(),
      );

      const helpText = program.help('test');

      expect(helpText).toContain('--port');
      expect(helpText).toContain('server.port');
    });
  });

  describe('array syntax with brackets', () => {
    it('should parse [a,b,c] as an array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              tags: z.array(z.string()).optional(),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --tags=[a,b,c]');

      expect(result.options?.tags).toEqual(['a', 'b', 'c']);
    });

    it('should parse empty brackets as empty array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              tags: z.array(z.string()).optional(),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --tags=[]');

      expect(result.options?.tags).toEqual([]);
    });

    it('should handle quoted values within array brackets', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              names: z.array(z.string()).optional(),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --names=["hello world","foo bar"]');

      expect(result.options?.names).toEqual(['hello world', 'foo bar']);
    });

    it('should handle mixed quoted and unquoted values in array', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              items: z.array(z.string()).optional(),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --items=[simple,"with space",another]');

      expect(result.options?.items).toEqual(['simple', 'with space', 'another']);
    });

    it('should combine array syntax with variadic options', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              include: z.array(z.string()).optional(),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --include=[a,b] --include=c --include=[d,e]');

      expect(result.options?.include).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('should work with short aliases', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              tags: z.array(z.string()).optional(),
            }),
            { options: { tags: { alias: ['t'] } } },
          )
          .action((options) => options),
      );

      const result = program.parse('test -t=[one,two,three]');

      expect(result.options?.tags).toEqual(['one', 'two', 'three']);
    });

    it('should trim whitespace from array items', () => {
      const program = createPadrone('padrone-test').command('test', (c) =>
        c
          .options(
            z.object({
              items: z.array(z.string()).optional(),
            }),
          )
          .action((options) => options),
      );

      const result = program.parse('test --items=[  a  ,  b  ,  c  ]');

      expect(result.options?.items).toEqual(['a', 'b', 'c']);
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
          .options(z.object({ name: z.string().describe('Name to greet') }), { positional: ['name'] })
          .action((options) => `Hello, ${options.name}!`),
      );

      const result = program.cli('greet --help');

      expect(result.result as string).toContain('greet');
    });

    it('should show help for nested command with --help flag', () => {
      const program = createPadrone('test-cli').command('git', (c) =>
        c.command('commit', (c) => c.options(z.object({ message: z.string().describe('Commit message') })).action((opts) => opts?.message)),
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
          .options(z.object({ name: z.string().describe('Name to greet') }), { positional: ['name'] })
          .action((options) => `Hello, ${options.name}!`),
      );

      const result = program.cli('help greet');

      expect(result.result as string).toContain('greet');
    });

    it('should show help for nested command with help command', () => {
      const program = createPadrone('test-cli').command('git', (c) =>
        c.command('commit', (c) => c.options(z.object({ message: z.string().describe('Commit message') })).action((opts) => opts?.message)),
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
        c.options(z.object({ name: z.string().describe('Name') }), { positional: ['name'] }).action((options) => `Hello, ${options.name}!`),
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
            .options(z.object({ port: z.coerce.number().optional() }), { options: { port: { configKey: 'server.port' } } })
            .action((opts) => opts?.port),
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
          c.options(z.object({ host: z.string().optional() }), { options: { host: { configKey: 'host' } } }).action((opts) => opts?.host),
        );

        const result = program.cli(`connect -c ${configPath}`);

        expect(result.result).toBe('example.com');
      } finally {
        fs.unlinkSync(configPath);
        fs.rmdirSync(configDir);
      }
    });

    it('should allow CLI options to override config file values', () => {
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');

      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'padrone-test-'));
      const configPath = path.join(configDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ server: { port: 3000 } }));

      try {
        const program = createPadrone('test-cli').command('serve', (c) =>
          c
            .options(z.object({ port: z.coerce.number().optional() }), { options: { port: { configKey: 'server.port' } } })
            .action((opts) => opts?.port),
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
});
