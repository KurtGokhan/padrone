import { describe, expectTypeOf } from 'bun:test';
import { createWeatherProgram } from './common';

/** This test is skipped because it's only used to test the types of the program, not the runtime behavior. */
describe.skip('Types', async () => {
  expectTypeOf(1).toEqualTypeOf<number>();

  const program = createWeatherProgram();
  const parsed = await program.parse('forecast London');
  const parsedNested = await program.parse('forecast extended London');
  const parsedNested2 = await program.parse('forecast extended extended London');

  expectTypeOf<(typeof parsed)['command']['path']>().toEqualTypeOf<'forecast'>();
  expectTypeOf<(typeof parsedNested)['command']['path']>().toEqualTypeOf<'forecast extended'>();
  expectTypeOf<(typeof parsedNested2)['command']['path']>().toEqualTypeOf<'forecast extended extended'>();

  type TNames = Extract<Parameters<typeof program.run>[0], string>;
  expectTypeOf<TNames>().toEqualTypeOf<
    | ''
    | 'current'
    | 'forecast'
    | 'forecast extended'
    | 'forecast extended extended'
    | 'alerts'
    | 'compare'
    | 'noop'
    | 'cities'
    | 'deprecated-test'
    | 'hidden-test'
    | 'examples-test'
  >();
});
