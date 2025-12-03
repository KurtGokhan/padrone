import { describe, expectTypeOf } from 'bun:test';
import { createWeatherProgram } from './common';

describe.skip('Types', () => {
  expectTypeOf(1).toEqualTypeOf<number>();

  const program = createWeatherProgram();
  const parsed = program.parse('forecast extended London');

  expectTypeOf<(typeof parsed)['command']>().toEqualTypeOf<'forecast extended'>();
});
