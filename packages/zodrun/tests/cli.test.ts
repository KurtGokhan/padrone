import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createZodrun } from '../src/index';
import type { TODO } from '../src/type-utils';
import { createWeatherProgram } from './common';

describe('CLI', () => {
  const program = createWeatherProgram();

  describe('programmatic execution', () => {
    it('should execute a simple command with args and options', () => {
      const result = program.run('current', ['New York'], { unit: 'celsius', verbose: true });

      expect(result.command).toBe('current');
      expect(result.args).toEqual(['New York']);
      expect(result.options).toEqual({ unit: 'celsius', verbose: true });
      expect(result.result.city).toBe('New York');
      expect(result.result.temperature).toBe(22);
      expect(result.result.humidity).toBe(65);
    });

    it('should execute a command with default options', () => {
      const result = program.run('current', ['London'], {});

      expect(result.command).toBe('current');
      expect(result.result.temperature).toBe(72); // Default fahrenheit
      expect(result.result.humidity).toBeUndefined(); // verbose not set
    });

    it('should execute nested commands', () => {
      const result = program.run('forecast extended', ['Tokyo'], { unit: 'celsius' });

      expect(result.command).toBe('forecast extended');
      expect(result.args).toEqual(['Tokyo']);
      expect(result.options).toEqual({ unit: 'celsius' });
      expect(result.result.city).toBe('Tokyo');
      expect(result.result.extendedForecast).toBeDefined();
    });

    it('should execute a command with array args', () => {
      const result = program.run('compare', ['New York', 'London', 'Tokyo'], undefined);

      expect(result.command).toBe('compare');
      expect(result.args).toEqual(['New York', 'London', 'Tokyo']);
      expect(result.result.cities).toEqual(['New York', 'London', 'Tokyo']);
      expect(result.result.comparison).toHaveLength(3);
    });

    it('should execute a command with void args and options', () => {
      const result = program.run('noop', undefined, undefined);

      expect(result.command).toBe('noop');
      expect(result.args).toBeUndefined();
      expect(result.options).toBeUndefined();
      expect(result.result).toBeUndefined();
    });
  });

  describe('CLI parsing', () => {
    it('should parse simple command with args', () => {
      const result = program.parse('current Paris');

      expect(result.command).toBe('current');
      expect(result.args).toEqual(['Paris']);
      expect(result.options).toEqual({} as TODO);
    });

    it('should parse command with options', () => {
      const result = program.parse('current London --unit celsius --verbose');

      expect(result.command).toBe('current');
      expect(result.args).toEqual(['London']);
      expect(result.options).toEqual({ unit: 'celsius', verbose: true });
    });

    it('should parse command with option values', () => {
      const result = program.parse('forecast Tokyo --days=5 --unit fahrenheit');

      expect(result.command).toBe('forecast');
      expect(result.args).toEqual(['Tokyo']);
      expect(result.options).toEqual({ days: '5' as TODO, unit: 'fahrenheit' });
    });

    it('should parse nested commands', () => {
      const result = program.parse('forecast extended Berlin --unit celsius');

      expect(result.command).toBe('forecast extended');
      expect(result.args).toEqual(['Berlin']);
      expect(result.options).toEqual({ unit: 'celsius' });
    });

    it('should parse command with multiple args', () => {
      const result = program.parse('compare New York London Tokyo');

      expect(result.command).toBe('compare');
      // Note: Parser splits on spaces, so "New York" becomes ["New", "York"]
      expect(result.args).toEqual(['New', 'York', 'London', 'Tokyo']);
    });

    it('should parse command with complex options', () => {
      const result = program.parse('alerts --region "West Coast" --severity high');

      expect(result.command).toBe('alerts');
      expect(result.options).toEqual({ region: '"West', severity: 'high' }); // Note: quotes are parsed as part of the value
    });

    it('should handle empty input', () => {
      const result = program.parse('');

      expect(result.command).toBe('' as TODO);
      expect(result.args).toBeUndefined();
      expect(result.options).toBeUndefined();
    });
  });

  describe('CLI execution', () => {
    it('should execute command via CLI string', () => {
      const result = program.cli('current Madrid --unit celsius');

      expect(result).toBeDefined();
      if (!result) throw new Error('Result is undefined');
      expect(result.command).toBe('current');
      expect(result.args).toEqual(['Madrid']);
      expect(result.result.city).toBe('Madrid');
      expect(result.result.temperature).toBe(22);
    });

    it('should return undefined for empty CLI input', () => {
      const result = program.cli('');

      expect(result).toBeUndefined();
    });

    it('should execute nested command via CLI', () => {
      const result = program.cli('forecast extended Sydney --unit celsius');

      expect(result).toBeDefined();
      expect(result?.command).toBe('forecast extended');
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

      expect(result.command).toBe('forecast extended');
    });

    it('should handle options without values', () => {
      const result = program.parse('alerts --ascending');

      expect(result.command).toBe('alerts');
      expect(result.options?.ascending).toBe(true);
    });

    it('should handle multiple boolean options', () => {
      const result = program.parse('current Paris --verbose --unit celsius');

      expect(result.command).toBe('current');
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

  describe('type safety', () => {
    it('should infer correct types for command args', () => {
      const program = createZodrun().command('test', (c) =>
        c.args(z.tuple([z.string(), z.number()])).handle((args) => {
          // Type test: args should be [string, number]
          const _test: [string, number] = args;
          return { first: args[0], second: args[1] };
        }),
      );

      const result = program.run('test', ['hello', 42], {});
      expect(result.args).toEqual(['hello', 42]);
      // Type test: verify args are correctly typed
      expect(typeof result.args[0]).toBe('string');
      expect(typeof result.args[1]).toBe('number');
    });

    it('should infer correct types for command options', () => {
      const program = createZodrun().command('test', (c) =>
        c
          .args(z.void())
          .options(
            z.object({
              name: z.string(),
              age: z.number(),
              active: z.boolean().optional(),
            }),
          )
          .handle((args, options) => {
            // Type test: options should have correct shape
            const _test: { name: string; age: number; active?: boolean } = options;
            return { processed: `${options.name} is ${options.age}` };
          }),
      );

      const result = program.run('test', undefined, { name: 'John', age: 30 });
      expect(result.options).toEqual({ name: 'John', age: 30 });
      // Type test: verify options are correctly typed
      expect(typeof result.options.name).toBe('string');
      expect(typeof result.options.age).toBe('number');
    });

    it('should infer correct return types from handlers', () => {
      const program = createZodrun().command('test', (c) =>
        c
          .args(z.void())
          .options(z.void())
          .handle(() => {
            return { message: 'success', code: 200 } as const;
          }),
      );

      const result = program.run('test', undefined, undefined);
      // Type test: result should be inferred correctly
      const _test: { message: 'success'; code: 200 } | undefined = result.result;
      expect(result.result?.message).toBe('success');
    });

    it('should infer void types correctly', () => {
      const program = createZodrun().command('test', (c) =>
        c
          .args(z.void())
          .options(z.void())
          .handle(() => undefined),
      );

      const result = program.run('test', undefined, undefined);
      // Type test: result should be void | undefined
      const _test: void | undefined = result.result;
      expect(result.result).toBeUndefined();
    });

    it('should infer nested command types', () => {
      const program = createZodrun().command('parent', (c) =>
        c
          .command('child', (c2) =>
            c2
              .args(z.tuple([z.string()]))
              .options(z.object({ flag: z.boolean() }))
              .handle((args, options) => {
                // Type test: nested command should have correct types
                const _testArgs: [string] = args;
                const _testOpts: { flag: boolean } = options;
                return { processed: args[0], flag: options.flag };
              }),
          )
          .handle(() => ({ parent: true })),
      );

      const result = program.run('parent child', ['test'], { flag: true });
      expect(result.command as string).toBe('parent child');
      expect(result.args).toEqual(['test']);
      expect(result.options.flag).toBe(true);
    });

    it('should enforce type safety in run() method', () => {
      const program = createZodrun().command('weather', (c) =>
        c
          .args(z.tuple([z.string()]))
          .options(z.object({ unit: z.enum(['celsius', 'fahrenheit']) }))
          .handle((args, options) => ({ city: args[0], unit: options.unit })),
      );

      // Valid usage - should compile
      const valid = program.run('weather', ['Paris'], { unit: 'celsius' });
      expect(valid.result?.city).toBe('Paris');
      expect(valid.result?.unit).toBe('celsius');
    });

    it('should infer correct types for API methods', () => {
      const program = createZodrun()
        .command('current', (c) =>
          c
            .args(z.tuple([z.string()]))
            .options(z.object({ unit: z.enum(['celsius', 'fahrenheit']).optional() }))
            .handle((args, options) => ({ city: args[0], unit: options?.unit })),
        )
        .command('forecast', (c) =>
          c
            .command('extended', (c2) =>
              c2
                .args(z.tuple([z.string()]))
                .options(z.object({ days: z.number() }))
                .handle((args, options) => ({ city: args[0], days: options.days })),
            )
            .handle(() => ({ base: true })),
        );

      const api = program.api();

      // Type test: API should have correct structure
      const _testCurrent: (args: [string], options: { unit?: 'celsius' | 'fahrenheit' }) => any = api.current;
      const _testForecast: (args: void | [], options: void | Record<string, never>) => any = api.forecast;
      const _testExtended: (args: [string], options: { days: number }) => any = api.forecast.extended;

      // Valid API usage
      // Note: Types indicate API returns handler result directly, but implementation returns ZodrunCommandResult
      const result1 = api.current(['London'], { unit: 'celsius' });
      expect(result1).toBeDefined();
      expect(result1.city).toBe('London');

      const result2 = api.forecast.extended(['Tokyo'], { days: 7 });
      expect(result2).toBeDefined();
      expect(result2.city).toBe('Tokyo');
      expect(result2.days).toBe(7);
    });

    it('should handle array args types correctly', () => {
      const program = createZodrun().command('compare', (c) =>
        c
          .args(z.array(z.string()).min(2))
          .options(z.void())
          .handle((args) => {
            // Type test: args should be string[]
            const _test: string[] = args;
            return { cities: args };
          }),
      );

      const result = program.run('compare', ['NYC', 'LA'], undefined);
      expect(result.result?.cities).toEqual(['NYC', 'LA']);
      // Type test: verify array args are handled correctly
      expect(Array.isArray(result.result?.cities)).toBe(true);
    });

    it('should handle optional options correctly', () => {
      const program = createZodrun().command('test', (c) =>
        c
          .args(z.void())
          .options(
            z.object({
              required: z.string(),
              optional: z.number().optional(),
            }),
          )
          .handle((args, options) => {
            // Type test: optional should be number | undefined
            const _test: { required: string; optional?: number } = options;
            return { value: options.optional ?? 0 };
          }),
      );

      // Both should be valid
      const result1 = program.run('test', undefined, { required: 'test' });
      const result2 = program.run('test', undefined, { required: 'test', optional: 42 });

      expect(result1.result?.value).toBe(0);
      expect(result2.result?.value).toBe(42);
    });

    it('should infer command result types from handle return', () => {
      type WeatherResult = { temp: number; condition: string };

      const program = createZodrun().command('weather', (c) =>
        c
          .args(z.tuple([z.string()]))
          .options(z.void())
          .handle((args): WeatherResult => {
            return { temp: 72, condition: 'Sunny' };
          }),
      );

      const result = program.run('weather', ['NYC'], undefined);
      // Type test: result should be WeatherResult | undefined
      const _test: WeatherResult | undefined = result.result;
      expect(result.result?.temp).toBe(72);
    });

    it('should handle complex nested command types', () => {
      const program = createZodrun().command('level1', (c) =>
        c
          .command('level2', (c2) =>
            c2
              .command('level3', (c3) =>
                c3
                  .args(z.tuple([z.string(), z.number()]))
                  .options(z.object({ deep: z.boolean() }))
                  .handle((args, options) => {
                    // Type test: deeply nested should preserve types
                    const _testArgs: [string, number] = args;
                    const _testOpts: { deep: boolean } = options;
                    return { depth: 3, data: args, deep: options.deep };
                  }),
              )
              .handle(() => ({ depth: 2 })),
          )
          .handle(() => ({ depth: 1 })),
      );

      const result = program.run('level1 level2 level3', ['test', 42], { deep: true });
      expect(result.result?.depth).toBe(3);
      expect(result.result?.data).toEqual(['test', 42]);
      expect(result.result?.deep).toBe(true);
    });

    it('should enforce type safety for find() method', () => {
      const program = createZodrun()
        .command('current', (c) => c.args(z.tuple([z.string()])).handle(() => ({ type: 'current' })))
        .command('forecast', (c) =>
          c.command('extended', (c2) => c2.handle(() => ({ type: 'extended' }))).handle(() => ({ type: 'forecast' })),
        );

      // Valid finds
      const cmd1 = program.find('current');
      const cmd2 = program.find('forecast extended');

      expect(cmd1?.name).toBe('current');
      expect(cmd2?.name).toBe('extended');
      expect(cmd2?.fullName).toBe('forecast extended');

      // Invalid find should return undefined (runtime check)
      const cmd3 = program.find('nonexistent');
      expect(cmd3).toBeUndefined();
    });

    it('should handle default option values in types', () => {
      const program = createZodrun().command('test', (c) =>
        c
          .args(z.void())
          .options(
            z.object({
              unit: z.enum(['celsius', 'fahrenheit']).default('fahrenheit'),
              verbose: z.boolean().optional(),
            }),
          )
          .handle((args, options) => {
            // Type test: unit should be 'celsius' | 'fahrenheit' (not optional due to default)
            // Note: defaults are applied by Zod parsing, not automatically in run()
            const _test: { unit: 'celsius' | 'fahrenheit'; verbose?: boolean } = options;
            return { unit: options.unit || 'fahrenheit', verbose: options.verbose };
          }),
      );

      // With explicit unit
      const result1 = program.run('test', undefined, { unit: 'celsius' });
      expect(result1.result?.unit).toBe('celsius');

      // Type test: verify options structure
      const _testOptions: { unit: 'celsius' | 'fahrenheit'; verbose?: boolean } = result1.options;
      expect(_testOptions.unit).toBe('celsius');
    });
  });
});
