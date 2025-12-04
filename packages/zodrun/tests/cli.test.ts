import { describe, expect, it } from 'bun:test';
import z from 'zod/v4';
import { createZodrun } from '../src/index';
import type { TODO } from '../src/type-utils';
import { createWeatherProgram } from './common';

describe('CLI', () => {
  const program = createWeatherProgram();

  describe('programmatic execution', () => {
    it('should execute a simple command with args and options', () => {
      const result = program.run('current', ['New York'], { unit: 'celsius', verbose: true });

      expect(result.command.fullName).toBe('current');
      expect(result.args).toEqual(['New York']);
      expect(result.options).toEqual({ unit: 'celsius', verbose: true });
      expect(result.result.city).toBe('New York');
      expect(result.result.temperature).toBe(22);
      expect(result.result.humidity).toBe(65);
    });

    it('should execute a command with default options', () => {
      const result = program.run('current', ['London'], {});

      expect(result.command.fullName).toBe('current');
      expect(result.result.temperature).toBe(72); // Default fahrenheit
      expect(result.result.humidity).toBeUndefined(); // verbose not set
    });

    it('should execute nested commands', () => {
      const result = program.run('forecast extended', ['Tokyo'], { unit: 'celsius' });

      expect(result.command.fullName).toBe('forecast extended');
      expect(result.args).toEqual(['Tokyo']);
      expect(result.options).toEqual({ unit: 'celsius' });
      expect(result.result.city).toBe('Tokyo');
      expect(result.result.extendedForecast).toBeDefined();
    });

    it('should execute a command with array args', () => {
      const result = program.run('compare', ['New York', 'London', 'Tokyo'], undefined);

      expect(result.command.fullName).toBe('compare');
      expect(result.args).toEqual(['New York', 'London', 'Tokyo']);
      expect(result.result.cities).toEqual(['New York', 'London', 'Tokyo']);
      expect(result.result.comparison).toHaveLength(3);
    });

    it('should execute a command with void args and options', () => {
      const result = program.run('noop', undefined, undefined);

      expect(result.command.fullName).toBe('noop');
      expect(result.args).toBeUndefined();
      expect(result.options).toBeUndefined();
      expect(result.result).toBeUndefined();
    });
  });

  describe('CLI parsing', () => {
    it('should parse simple command with args', () => {
      const result = program.parse('current Paris');

      expect(result.command.fullName).toBe('current');
      expect(result.args).toEqual(['Paris']);
      expect(result.options).toEqual({ unit: 'fahrenheit' });
    });

    it('should parse command with options', () => {
      const result = program.parse('current London --unit celsius --verbose');

      expect(result.command.fullName).toBe('current');
      expect(result.args).toEqual(['London']);
      expect(result.options).toEqual({ unit: 'celsius', verbose: true });
    });

    it('should parse command with option values', () => {
      const result = program.parse('forecast Tokyo --days=5 --unit fahrenheit');

      expect(result.command.fullName).toBe('forecast');
      expect(result.args).toEqual(['Tokyo']);
      expect(result.options).toEqual({ days: 5, unit: 'fahrenheit' });
    });

    it('should parse nested commands', () => {
      const result = program.parse('forecast extended Berlin --unit celsius');

      expect(result.command.fullName).toBe('forecast extended');
      expect(result.args).toEqual(['Berlin']);
      expect(result.options).toEqual({ unit: 'celsius' });
    });

    it('should parse command with multiple args', () => {
      const result = program.parse('compare New York London Tokyo');

      expect(result.command.fullName).toBe('compare');
      // Note: Parser splits on spaces, so "New York" becomes ["New", "York"]
      expect(result.args).toEqual(['New', 'York', 'London', 'Tokyo']);
    });

    it('should parse command with complex options', () => {
      const result = program.parse('alerts --region "West Coast" --severity high');

      expect(result.command.fullName).toBe('alerts');
      expect(result.options).toEqual({ region: '"West', severity: 'high' }); // Note: quotes are parsed as part of the value
    });

    it('should handle empty input', () => {
      const result = program.parse('');

      expect(result.command.fullName).toBe('' as TODO);
      expect(result.args).toBeUndefined();
      expect(result.options).toBeUndefined();
    });
  });

  describe('CLI execution', () => {
    it('should execute command via CLI string', () => {
      const result = program.cli('current Madrid --unit celsius');

      expect(result).toBeDefined();
      if (!result) throw new Error('Result is undefined');
      expect(result.command.fullName).toBe('current');
      expect(result.args).toEqual(['Madrid']);
      expect(result.result.city).toBe('Madrid');
      expect(result.result.temperature).toBe(22);
    });

    it('should return undefined for empty CLI input', () => {
      expect(() => program.cli('')).toThrow('Command "" has no handler');
    });

    it('should execute nested command via CLI', () => {
      const result = program.cli('forecast extended Sydney --unit celsius');

      expect(result).toBeDefined();
      expect(result?.command.fullName).toBe('forecast extended');
      expect(result?.result.city).toBe('Sydney');
    });

    it('should throw error for non-existent command', () => {
      expect(() => {
        program.run('nonexistent' as any, [], {});
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
      expect(command?.fullName).toBe('forecast extended');
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

      const result = api.current(['Berlin'], { unit: 'celsius', verbose: true });
      // API returns ZodrunCommandResult, so access .result property
      expect(result.city).toBe('Berlin');
      expect(result.temperature).toBe(22);
    });

    it('should generate nested API structure', () => {
      const api = program.api();

      expect(api.forecast).toBeDefined();
      expect(typeof api.forecast).toBe('function');
      expect(api.forecast.extended).toBeDefined();
      expect(typeof api.forecast.extended).toBe('function');

      const result = api.forecast.extended(['Paris'], { unit: 'celsius' });
      // API returns ZodrunCommandResult, so access .result property
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

      const compareResult = api.compare(['NYC', 'LA'], undefined);
      // API returns ZodrunCommandResult, so access .result property
      expect(compareResult.cities).toEqual(['NYC', 'LA']);

      const alertsResult = api.alerts(undefined, { region: 'California', severity: 'high' });
      expect(alertsResult.region).toBe('California');
    });
  });

  describe('edge cases', () => {
    it('should handle command with no args schema', () => {
      const program = createZodrun().command('test', (c) => c.handle(() => ({ message: 'success' })));

      const result = program.run('test', undefined, undefined);
      expect(result.result?.message).toBe('success');
    });

    it('should handle command with no options schema', () => {
      const program = createZodrun().command('test', (c) => c.args(z.tuple([z.string()])).handle((args) => ({ city: args[0] })));

      const result = program.run('test', ['City'], undefined);
      expect(result.result.city).toBe('City');
    });

    it('should handle deeply nested commands', () => {
      const program = createZodrun().command('level1', (c) =>
        c.command('level2', (c2) => c2.command('level3', (c3) => c3.handle(() => ({ depth: 3 })))).handle(() => ({ depth: 1 })),
      );

      const result = program.run('level1 level2 level3', undefined, undefined);
      expect(result.result.depth).toBe(3);
    });

    it('should handle command names with spaces in parsing', () => {
      // Note: This tests the parsing behavior - spaces typically separate commands
      const result = program.parse('forecast extended');

      expect(result.command.fullName).toBe('forecast extended');
    });

    it('should handle options without values', () => {
      const result = program.parse('alerts --ascending');

      expect(result.command.fullName).toBe('alerts');
      expect(result.options?.ascending).toBe(true);
    });

    it('should handle multiple boolean options', () => {
      const result = program.parse('current Paris --verbose --unit celsius');

      expect(result.command.fullName).toBe('current');
      expect(result.options?.verbose).toBe(true);
      expect(result.options?.unit).toBe('celsius');
    });
  });

  describe('real-world weather CLI scenarios', () => {
    it('should handle checking current weather for multiple cities sequentially', () => {
      const cities = ['New York', 'London', 'Tokyo'];
      const results = cities.map((city) => program.run('current', [city], { unit: 'celsius' }));

      expect(results).toHaveLength(3);
      results.forEach((result, i) => {
        expect(result.result.city).toBe(cities[i]!);
        expect(result.result.temperature).toBe(22);
      });
    });

    it('should handle getting forecast with custom days', () => {
      const result = program.run('forecast', ['Miami'], { days: 5, unit: 'fahrenheit' });

      expect(result.result.days).toBe(5);
      expect(result.result.forecast).toHaveLength(2); // Mock data only has 2 days
    });

    it('should handle comparing weather across multiple cities', () => {
      const cities = ['Seattle', 'Portland', 'Vancouver'];
      const result = program.run('compare', cities, undefined);

      expect(result.result?.comparison).toHaveLength(3);
      result.result?.comparison.forEach((comp: any, i: number) => {
        expect(comp.city).toBe(cities[i]);
        expect(comp.temp).toBeDefined();
        expect(comp.condition).toBeDefined();
      });
    });

    it('should handle checking alerts with filters', () => {
      const result = program.run('alerts', undefined, {
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
      const program = createZodrun().command('test', (c) =>
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
          .handle((_args, options) => ({
            verbose: options?.verbose,
            help: options?.help,
          })),
      );

      const result = program.parse('test -v -h');

      expect(result.command.fullName).toBe('test');
      expect(result.options?.verbose).toBe(true);
      expect(result.options?.help).toBe(true);
    });

    it('should resolve aliases with values', () => {
      const program = createZodrun().command('test', (c) =>
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
          .handle((_args, options) => options),
      );

      const result = program.parse('test -u celsius -c=5');

      expect(result.options?.unit).toBe('celsius');
      expect(result.options?.count).toBe(5);
    });

    it('should execute commands with aliases via CLI', () => {
      const program = createZodrun().command('test', (c) =>
        c
          .options(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .meta({ alias: ['v'] }),
            }),
          )
          .handle((_args, options) => ({
            verbose: options?.verbose || false,
          })),
      );

      const result = program.cli('test -v');

      expect(result?.options?.verbose).toBe(true);
      expect(result?.result.verbose).toBe(true);
    });

    it('should handle aliases mixed with full option names', () => {
      const program = createZodrun().command('test', (c) =>
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
          .handle((_args, options) => options),
      );

      const result = program.parse('test -v --help -o=file.txt');

      expect(result.options?.verbose).toBe(true);
      expect(result.options?.help).toBe(true);
      expect(result.options?.output).toBe('file.txt');
    });

    it('should handle undefined aliases gracefully', () => {
      const program = createZodrun().command('test', (c) =>
        c
          .options(
            z.object({
              verbose: z.boolean().optional(),
              v: z.boolean().optional(), // Include 'v' in schema to test without alias
            }),
          )
          .handle((_args, options) => options),
      );

      // No aliases defined, -v should work as 'v' key if it's in the schema
      const result = program.parse('test -v');

      expect(result.options?.v).toBe(true);
      expect(result.options?.verbose).toBeUndefined();
    });

    it('should display aliases in help text', () => {
      const program = createZodrun().command('test', (c) =>
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
          .handle(() => undefined),
      );

      const helpText = program.help('test');

      expect(helpText).toContain('--verbose');
      expect(helpText).toContain('--help');
      expect(helpText).toContain('-v');
      expect(helpText).toContain('-h');
    });

    it('should work with nested commands', () => {
      const program = createZodrun().command('parent', (c) =>
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
              .handle((_args, options) => ({
                verbose: options?.verbose || false,
              })),
          )
          .handle(() => undefined),
      );

      const result = program.parse('parent child -v');

      expect(result.command.fullName).toBe('parent child');
      expect(result.options?.verbose).toBe(true);
    });

    it('should handle multiple aliases for the same option', () => {
      const program = createZodrun().command('test', (c) =>
        c
          .options(
            z.object({
              verbose: z
                .boolean()
                .optional()
                .meta({ alias: ['v', 'verbose'] }),
            }),
          )
          .handle((_args, options) => options),
      );

      const result = program.parse('test -v');

      expect(result.options?.verbose).toBe(true);
    });
  });
});
