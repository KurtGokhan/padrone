import * as z from 'zod/v4';
import { createPadrone } from '../src';

// Mock weather data for testing
const mockWeatherData = {
  current: { temp: 72, condition: 'Sunny', humidity: 65 },
  forecast: [
    { day: 'Monday', high: 75, low: 60, condition: 'Sunny' },
    { day: 'Tuesday', high: 78, low: 62, condition: 'Partly Cloudy' },
  ],
  alerts: ['Heat advisory in effect'],
};

export function createWeatherProgram() {
  return createPadrone('padrone-test')
    .command('current', (c) =>
      c
        .options(
          z.object({
            city: z.string().describe('City name'),
            unit: z.enum(['celsius', 'fahrenheit']).optional().default('fahrenheit').describe('Temperature unit'),
            verbose: z.boolean().optional().describe('Show detailed information'),
          }),
          {
            positional: ['city'],
          },
        )
        .action((options) => {
          const { city } = options;
          return {
            city,
            temperature: options?.unit === 'celsius' ? 22 : 72,
            condition: mockWeatherData.current.condition,
            humidity: options?.verbose ? mockWeatherData.current.humidity : undefined,
          };
        }),
    )
    .command('forecast', (c) =>
      c
        .options(
          z.object({
            city: z.string().describe('City name (overrides positional argument)'),
            days: z.coerce.number().min(1).max(7).optional().default(3).describe('Number of days to forecast'),
            unit: z.enum(['celsius', 'fahrenheit']).optional().default('fahrenheit').describe('Temperature unit'),
          }),
          {
            positional: ['city'],
          },
        )
        .action((options) => {
          const { city } = options;
          return {
            city,
            days: options?.days || 3,
            forecast: mockWeatherData.forecast.slice(0, options?.days || 3),
          };
        })
        .command('extended', (c) =>
          c
            .options(
              z.object({
                city: z.string().describe('City name (overrides positional argument)'),
                unit: z.enum(['celsius', 'fahrenheit']).optional().default('fahrenheit').describe('Temperature unit'),
              }),
              {
                positional: ['city'],
              },
            )
            .action((options) => {
              const { city } = options;
              return {
                city,
                extendedForecast: mockWeatherData.forecast,
                unit: options?.unit,
              };
            })
            .command('extended', (c) =>
              c
                .options(
                  z.object({
                    city: z.string().describe('City name (overrides positional argument)'),
                  }),
                  {
                    positional: ['city'],
                  },
                )
                .action((options) => {
                  const { city } = options;
                  return {
                    city,
                    extendedForecast: mockWeatherData.forecast,
                  };
                }),
            ),
        ),
    )
    .command('alerts', (c) =>
      c
        .options(
          z.object({
            region: z.string().optional().describe('Region to check alerts for'),
            severity: z.enum(['low', 'medium', 'high']).optional().describe('Filter by severity'),
            ascending: z.boolean().optional().describe('Sort alerts in ascending order'),
          }),
        )
        .action((options) => {
          return {
            region: options?.region || 'all',
            alerts: mockWeatherData.alerts,
            severity: options?.severity,
          };
        }),
    )
    .command('compare', (c) =>
      c
        .options(
          z.object({
            cities: z.array(z.string()).min(2).describe('Cities to compare'),
          }),
          {
            positional: ['...cities'],
          },
        )
        .action((options) => {
          const { cities } = options;
          return {
            cities,
            comparison: cities.map((city) => ({
              city,
              temp: 72,
              condition: 'Sunny',
            })),
          };
        }),
    )
    .command('noop', (c) => c.action(() => undefined))
    .command('cities', (c) =>
      c
        .options(
          z.object({
            verbose: z.boolean().optional(),
          }),
          {
            options: {
              verbose: {
                alias: 'v',
                description: 'Show detailed information',
              },
            },
          },
        )
        .action(),
    )
    .command('deprecated-test', (c) =>
      c
        .options(
          z.object({
            oldOption: z.string().optional().describe('Old option'),
            newOption: z.string().optional().describe('New option'),
            deprecatedWithMessage: z.boolean().optional().describe('Deprecated option with message'),
          }),
          {
            options: {
              oldOption: {
                deprecated: true,
                description: 'This option is deprecated',
              },
              newOption: {
                description: 'This is the new option',
              },
              deprecatedWithMessage: {
                deprecated: 'Use newOption instead',
                description: 'This option is deprecated with a message',
              },
            },
          },
        )
        .action(),
    )
    .command('hidden-test', (c) =>
      c
        .options(
          z.object({
            visibleOption: z.string().optional().describe('This option should be visible'),
            hiddenOption: z.string().optional().describe('This option should be hidden'),
            anotherVisible: z.boolean().optional().describe('Another visible option'),
          }),
          {
            options: {
              visibleOption: {
                description: 'This option is visible in help',
              },
              hiddenOption: {
                hidden: true,
                description: 'This option should not appear in help',
              },
              anotherVisible: {
                description: 'This option is also visible',
              },
            },
          },
        )
        .action(),
    )
    .command('examples-test', (c) =>
      c
        .options(
          z.object({
            output: z.string().optional().describe('Output file path'),
            format: z.enum(['json', 'yaml', 'xml']).optional().describe('Output format'),
            verbose: z.boolean().optional().describe('Enable verbose output'),
            config: z.string().optional().describe('Configuration file'),
          }),
          {
            options: {
              output: {
                description: 'Specify the output file path',
                examples: ['output.txt', './dist/result.json'],
              },
              format: {
                description: 'Choose the output format',
                examples: ['json', 'yaml'],
              },
              verbose: {
                description: 'Show detailed information',
                examples: [true],
              },
              config: {
                description: 'Path to configuration file',
                examples: ['./config.json', '~/.config/app.json'],
              },
            },
          },
        )
        .action(),
    );
}
