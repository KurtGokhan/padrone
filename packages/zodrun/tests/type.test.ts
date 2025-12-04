import { describe, expectTypeOf } from 'bun:test';
import { createWeatherProgram } from './common';

/** This test is skipped because it's only used to test the types of the program, not the runtime behavior. */
describe.skip('Types', () => {
  expectTypeOf(1).toEqualTypeOf<number>();

  const program = createWeatherProgram();
  const parsed = program.parse('forecast London');
  const parsedNested = program.parse('forecast extended London');
  const parsedNested2 = program.parse('forecast extended extended London');

  expectTypeOf<(typeof parsed)['command']['fullName']>().toEqualTypeOf<'forecast'>();
  expectTypeOf<(typeof parsedNested)['command']['fullName']>().toEqualTypeOf<'forecast extended'>();
  expectTypeOf<(typeof parsedNested2)['command']['fullName']>().toEqualTypeOf<'forecast extended extended'>();

  type TNames = Extract<Parameters<typeof program.run>[0], string>;
  expectTypeOf<TNames>().toEqualTypeOf<
    '' | 'current' | 'forecast' | 'forecast extended' | 'forecast extended extended' | 'alerts' | 'compare' | 'noop'
  >();
});
