import { describe, expectTypeOf } from 'bun:test';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createWeatherProgram } from './common.ts';

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
    | (string & {})
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

/** This test verifies that command aliases are properly typed */
describe.skip('Types - Aliases', async () => {
  const programWithAliases = createPadrone('test')
    .command(['list', 'ls', 'l'], (c) =>
      c.options(z.object({ format: z.enum(['json', 'table']).default('table') })).action((opts) => ({ items: [], format: opts.format })),
    )
    .command(['delete', 'rm'], (c) =>
      c.options(z.object({ name: z.string() }), { positional: ['name'] }).action((opts) => ({ deleted: opts.name })),
    )
    .command('config', (c) =>
      c.command(['set', 's'], (sub) =>
        sub
          .options(z.object({ key: z.string(), value: z.string() }), { positional: ['key', 'value'] })
          .action((opts) => ({ key: opts.key, value: opts.value })),
      ),
    );

  // Test that aliases are included in possible command names
  type TPossibleNames = Extract<Parameters<typeof programWithAliases.cli>[0], string>;
  expectTypeOf<TPossibleNames>().toMatchTypeOf<
    (string & {}) | 'list' | 'ls' | 'l' | 'delete' | 'rm' | 'config' | 'config set' | 'config s'
  >();

  // Test that parse returns correct command type when using alias
  const parsedByName = programWithAliases.parse('list');
  const parsedByAlias = programWithAliases.parse('ls');
  expectTypeOf<(typeof parsedByName)['command']['path']>().toEqualTypeOf<'list'>();
  expectTypeOf<(typeof parsedByAlias)['command']['path']>().toEqualTypeOf<'list'>();

  // Test nested command with alias
  const parsedNestedByName = programWithAliases.parse('config set key value');
  const parsedNestedByAlias = programWithAliases.parse('config s key value');
  expectTypeOf<(typeof parsedNestedByName)['command']['path']>().toEqualTypeOf<'config set'>();
  expectTypeOf<(typeof parsedNestedByAlias)['command']['path']>().toEqualTypeOf<'config set'>();
});
