import { describe, expectTypeOf } from 'bun:test';
import type { PadroneBuilder, PadroneProgram } from 'padrone';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createTasksProgram } from './common.ts';

/** This test verifies that PadroneBuilder does NOT have program-only methods */
describe.skip('Types - Builder vs Program separation', async () => {
  // Builder should have these methods
  type BuilderKeys = keyof PadroneBuilder;
  expectTypeOf<'configure'>().toExtend<BuilderKeys>();
  expectTypeOf<'options'>().toExtend<BuilderKeys>();
  expectTypeOf<'action'>().toExtend<BuilderKeys>();
  expectTypeOf<'command'>().toExtend<BuilderKeys>();
  expectTypeOf<'configFile'>().toExtend<BuilderKeys>();
  expectTypeOf<'env'>().toExtend<BuilderKeys>();
  expectTypeOf<'~types'>().toExtend<BuilderKeys>();

  // Builder should NOT have these program-only methods
  type ProgramOnlyKeys = 'run' | 'cli' | 'parse' | 'stringify' | 'find' | 'api' | 'tool' | 'help' | 'completion';
  expectTypeOf<ProgramOnlyKeys>().not.toMatchObjectType<BuilderKeys>();

  // Program should have all methods
  type ProgramKeys = keyof PadroneProgram;
  expectTypeOf<'configure'>().toExtend<ProgramKeys>();
  expectTypeOf<'options'>().toExtend<ProgramKeys>();
  expectTypeOf<'action'>().toExtend<ProgramKeys>();
  expectTypeOf<'command'>().toExtend<ProgramKeys>();
  expectTypeOf<'run'>().toExtend<ProgramKeys>();
  expectTypeOf<'cli'>().toExtend<ProgramKeys>();
  expectTypeOf<'parse'>().toExtend<ProgramKeys>();
  expectTypeOf<'stringify'>().toExtend<ProgramKeys>();
  expectTypeOf<'find'>().toExtend<ProgramKeys>();
  expectTypeOf<'api'>().toExtend<ProgramKeys>();
  expectTypeOf<'tool'>().toExtend<ProgramKeys>();
  expectTypeOf<'help'>().toExtend<ProgramKeys>();
  expectTypeOf<'completion'>().toExtend<ProgramKeys>();

  // Verify builder chaining returns builder within command() callback
  createPadrone('test').command('cmd', (builder) => {
    // builder should be PadroneBuilder
    const afterOptions = builder.options(z.object({ name: z.string() }));
    // afterOptions should also be PadroneBuilder - program methods should NOT exist
    type AfterOptionsKeys = keyof typeof afterOptions;
    expectTypeOf<'run'>().not.toMatchObjectType<AfterOptionsKeys>();
    expectTypeOf<'cli'>().not.toMatchObjectType<AfterOptionsKeys>();
    expectTypeOf<'parse'>().not.toMatchObjectType<AfterOptionsKeys>();

    return afterOptions.action((opts) => opts.name);
  });
});

/** This test is skipped because it's only used to test the types of the program, not the runtime behavior. */
describe.skip('Types', async () => {
  expectTypeOf(1).toEqualTypeOf<number>();

  const program = createTasksProgram();
  const parsed = await program.parse('list');
  const parsedNested = await program.parse('list extended');
  const parsedNested2 = await program.parse('list extended extended');

  expectTypeOf<(typeof parsed)['command']['path']>().toEqualTypeOf<'list'>();
  expectTypeOf<(typeof parsedNested)['command']['path']>().toEqualTypeOf<'list extended'>();
  expectTypeOf<(typeof parsedNested2)['command']['path']>().toEqualTypeOf<'list extended extended'>();

  type TNames = Extract<Parameters<typeof program.run>[0], string>;
  expectTypeOf<TNames>().toEqualTypeOf<
    | (string & {})
    | ''
    | 'show'
    | 'list'
    | 'list extended'
    | 'list extended extended'
    | 'filter'
    | 'batch'
    | 'noop'
    | 'tags'
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
  expectTypeOf<TPossibleNames>().toExtend<(string & {}) | 'list' | 'ls' | 'l' | 'delete' | 'rm' | 'config' | 'config set' | 'config s'>();

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

describe.skip('Types - Parsed command type', async () => {
  const program = createPadrone('test')
    .command('greet', (c) =>
      c
        .options(
          z.object({
            name: z.string().default('World'),
            excited: z.boolean().default(false),
          }),
        )
        .action((opts) => {
          const greeting = `Hello, ${opts.name}${opts.excited ? '!' : '.'}`;
          return { greeting };
        }),
    )
    .command('sum', (c) =>
      c
        .options(
          z.object({
            numbers: z.array(z.number()),
          }),
        )
        .action((opts) => {
          const total = opts.numbers.reduce((a, b) => a + b, 0);
          return { total };
        }),
    );

  const parsedGreet = await program.parse('greet --name Alice --excited true');
  expectTypeOf<(typeof parsedGreet)['command']['path']>().toEqualTypeOf<'greet'>();

  const parsedString = await program.parse('sum --numbers 1 --numbers 2 --numbers 3' as string);
  expectTypeOf<(typeof parsedString)['command']['path']>().toExtend<'' | 'sum' | 'greet'>();
});
