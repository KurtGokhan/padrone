import { describe, expectTypeOf } from 'bun:test';
import type { PadroneBuilder, PadroneProgram } from 'padrone';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createWeatherProgram } from './common.ts';

/** This test verifies that PadroneBuilder does NOT have program-only methods */
describe.skip('Types - Builder vs Program separation', async () => {
  // Builder should have these methods
  type BuilderKeys = keyof PadroneBuilder;
  expectTypeOf<'configure'>().toMatchTypeOf<BuilderKeys>();
  expectTypeOf<'options'>().toMatchTypeOf<BuilderKeys>();
  expectTypeOf<'action'>().toMatchTypeOf<BuilderKeys>();
  expectTypeOf<'command'>().toMatchTypeOf<BuilderKeys>();
  expectTypeOf<'configFile'>().toMatchTypeOf<BuilderKeys>();
  expectTypeOf<'env'>().toMatchTypeOf<BuilderKeys>();
  expectTypeOf<'~types'>().toMatchTypeOf<BuilderKeys>();

  // Builder should NOT have these program-only methods
  type ProgramOnlyKeys = 'run' | 'cli' | 'parse' | 'stringify' | 'find' | 'api' | 'tool' | 'help' | 'completion';
  expectTypeOf<ProgramOnlyKeys>().not.toMatchTypeOf<BuilderKeys>();

  // Program should have all methods
  type ProgramKeys = keyof PadroneProgram;
  expectTypeOf<'configure'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'options'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'action'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'command'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'run'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'cli'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'parse'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'stringify'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'find'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'api'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'tool'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'help'>().toMatchTypeOf<ProgramKeys>();
  expectTypeOf<'completion'>().toMatchTypeOf<ProgramKeys>();

  // Verify builder chaining returns builder within command() callback
  createPadrone('test').command('cmd', (builder) => {
    // builder should be PadroneBuilder
    const afterOptions = builder.options(z.object({ name: z.string() }));
    // afterOptions should also be PadroneBuilder - program methods should NOT exist
    type AfterOptionsKeys = keyof typeof afterOptions;
    expectTypeOf<'run'>().not.toMatchTypeOf<AfterOptionsKeys>();
    expectTypeOf<'cli'>().not.toMatchTypeOf<AfterOptionsKeys>();
    expectTypeOf<'parse'>().not.toMatchTypeOf<AfterOptionsKeys>();

    return afterOptions.action((opts) => opts.name);
  });
});

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
