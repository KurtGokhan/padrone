import z from 'zod';
import { createZodrun } from '../src';

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
  return createZodrun()
    .command('current', (c) =>
      c
        .args(z.tuple([z.string().describe('City name')]))
        .options(
          z.object({
            unit: z.enum(['celsius', 'fahrenheit']).optional().default('fahrenheit').describe('Temperature unit'),
            verbose: z.boolean().optional().describe('Show detailed information'),
          }),
        )
        .handle((args, options) => {
          const [city] = args;
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
        .args(z.tuple([z.string().describe('City name')]))
        .options(
          z.object({
            days: z.coerce.number().min(1).max(7).optional().default(3).describe('Number of days to forecast'),
            unit: z.enum(['celsius', 'fahrenheit']).optional().default('fahrenheit').describe('Temperature unit'),
          }),
        )
        .handle((args, options) => {
          const [city] = args;
          return {
            city,
            days: options?.days || 3,
            forecast: mockWeatherData.forecast.slice(0, options?.days || 3),
          };
        })
        .command('extended', (c) =>
          c
            .args(z.tuple([z.string().describe('City name')]))
            .options(
              z.object({
                unit: z.enum(['celsius', 'fahrenheit']).optional().default('fahrenheit').describe('Temperature unit'),
              }),
            )
            .handle((args, options) => {
              const [city] = args;
              return {
                city,
                extendedForecast: mockWeatherData.forecast,
                unit: options?.unit,
              };
            }),
        ),
    )
    .command('alerts', (c) =>
      c
        .args(z.void())
        .options(
          z.object({
            region: z.string().optional().describe('Region to check alerts for'),
            severity: z.enum(['low', 'medium', 'high']).optional().describe('Filter by severity'),
            ascending: z.boolean().optional().describe('Sort alerts in ascending order'),
          }),
        )
        .handle((args, options) => {
          return {
            region: options?.region || 'all',
            alerts: mockWeatherData.alerts,
            severity: options?.severity,
          };
        }),
    )
    .command('compare', (c) =>
      c
        .args(z.array(z.string()).min(2).describe('Cities to compare'))
        .options(z.void())
        .handle((args, options) => {
          return {
            cities: args,
            comparison: args.map((city) => ({
              city,
              temp: 72,
              condition: 'Sunny',
            })),
          };
        }),
    )
    .command('noop', (c) =>
      c
        .args(z.void())
        .options(z.void())
        .handle(() => undefined),
    );
}

export type WeatherProgram = ReturnType<typeof createWeatherProgram>;
