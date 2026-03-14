import { describe, expectTypeOf } from 'bun:test';
import type { PadroneBuilder, PadroneProgram } from 'padrone';
import { asyncSchema, createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createTasksProgram } from './common.ts';

/** This test verifies that PadroneBuilder does NOT have program-only methods */
describe.skip('Types - Builder vs Program separation', async () => {
  // Builder should have these methods
  type BuilderKeys = keyof PadroneBuilder;
  expectTypeOf<'configure'>().toExtend<BuilderKeys>();
  expectTypeOf<'arguments'>().toExtend<BuilderKeys>();
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
  expectTypeOf<'arguments'>().toExtend<ProgramKeys>();
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
    const afterargs = builder.arguments(z.object({ name: z.string() }));
    // afterargs should also be PadroneBuilder - program methods should NOT exist
    type AfterargsKeys = keyof typeof afterargs;
    expectTypeOf<'run'>().not.toMatchObjectType<AfterargsKeys>();
    expectTypeOf<'cli'>().not.toMatchObjectType<AfterargsKeys>();
    expectTypeOf<'parse'>().not.toMatchObjectType<AfterargsKeys>();

    return afterargs.action((args) => args.name);
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
      c.arguments(z.object({ format: z.enum(['json', 'table']).default('table') })).action((args) => ({ items: [], format: args.format })),
    )
    .command(['delete', 'rm'], (c) =>
      c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => ({ deleted: args.name })),
    )
    .command('config', (c) =>
      c.command(['set', 's'], (sub) =>
        sub
          .arguments(z.object({ key: z.string(), value: z.string() }), { positional: ['key', 'value'] })
          .action((args) => ({ key: args.key, value: args.value })),
      ),
    );

  // Test that aliases are included in possible command names
  type TPossibleNames = Extract<Parameters<typeof programWithAliases.eval>[0], string>;
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
        .arguments(
          z.object({
            name: z.string().default('World'),
            excited: z.boolean().default(false),
          }),
        )
        .action((args) => {
          const greeting = `Hello, ${args.name}${args.excited ? '!' : '.'}`;
          return { greeting };
        }),
    )
    .command('sum', (c) =>
      c
        .arguments(
          z.object({
            numbers: z.array(z.number()),
          }),
        )
        .action((args) => {
          const total = args.numbers.reduce((a, b) => a + b, 0);
          return { total };
        }),
    );

  const parsedGreet = await program.parse('greet --name Alice --excited true');
  expectTypeOf<(typeof parsedGreet)['command']['path']>().toEqualTypeOf<'greet'>();

  const parsedString = await program.parse('sum --numbers 1 --numbers 2 --numbers 3' as string);
  expectTypeOf<(typeof parsedString)['command']['path']>().toExtend<'' | 'sum' | 'greet'>();
});

/** This test verifies that interactive meta makes commands async */
describe.skip('Types - Interactive', () => {
  const syncSchema = z.object({ name: z.string(), template: z.enum(['react', 'vue']), verbose: z.boolean().default(false) });

  const program = createPadrone('test')
    .command('no-interactive', (c) => c.arguments(syncSchema).action((args) => args.name))
    .command('interactive-true', (c) => c.arguments(syncSchema, { interactive: true }).action((args) => args.name))
    .command('interactive-fields', (c) => c.arguments(syncSchema, { interactive: ['name', 'template'] }).action((args) => args.name))
    .command('optional-interactive', (c) => c.arguments(syncSchema, { optionalInteractive: ['verbose'] }).action((args) => args.name))
    .command('both-interactive', (c) =>
      c.arguments(syncSchema, { interactive: ['name'], optionalInteractive: ['verbose'] }).action((args) => args.name),
    );

  // No interactive: sync
  const syncParsed = program.parse('no-interactive --name hello --template react');
  expectTypeOf(syncParsed).not.toMatchTypeOf<Promise<any>>();

  const syncCli = program.eval('no-interactive --name hello --template react');
  expectTypeOf(syncCli).not.toMatchTypeOf<Promise<any>>();

  // interactive: true → async
  const interactiveTrueParsed = program.parse('interactive-true --name hello --template react');
  expectTypeOf(interactiveTrueParsed).toMatchTypeOf<Promise<any>>();

  const interactiveTrueCli = program.eval('interactive-true --name hello --template react');
  expectTypeOf(interactiveTrueCli).toMatchTypeOf<Promise<any>>();

  // interactive: ['name', 'template'] → async
  const interactiveFieldsParsed = program.parse('interactive-fields --name hello --template react');
  expectTypeOf(interactiveFieldsParsed).toMatchTypeOf<Promise<any>>();

  // optionalInteractive: ['verbose'] → async
  const optionalParsed = program.parse('optional-interactive --name hello --template react');
  expectTypeOf(optionalParsed).toMatchTypeOf<Promise<any>>();

  // Both → async
  const bothCli = program.eval('both-interactive --name hello --template react');
  expectTypeOf(bothCli).toMatchTypeOf<Promise<any>>();
});

/** This test verifies that async commands return Promises and sync commands don't */
describe.skip('Types - Async', () => {
  const syncSchema = z.object({ name: z.string() });
  const brandedSchema = asyncSchema(z.object({ name: z.string() }));

  const program = createPadrone('test')
    .command('sync-cmd', (c) => c.arguments(syncSchema).action((args) => args.name))
    .command('async-branded', (c) => c.arguments(brandedSchema).action((args) => args.name))
    .command('async-explicit', (c) =>
      c
        .arguments(syncSchema)
        .async()
        .action((args) => args.name),
    );

  // Sync command: parse and cli return plain values (not Promises)
  const syncParsed = program.parse('sync-cmd --name hello');
  expectTypeOf(syncParsed).not.toMatchTypeOf<Promise<any>>();

  const syncCli = program.eval('sync-cmd --name hello');
  expectTypeOf(syncCli).not.toMatchTypeOf<Promise<any>>();

  // Async branded: parse and cli return Promises
  const asyncBrandedParsed = program.parse('async-branded --name hello');
  expectTypeOf(asyncBrandedParsed).toMatchTypeOf<Promise<any>>();

  const asyncBrandedCli = program.eval('async-branded --name hello');
  expectTypeOf(asyncBrandedCli).toMatchTypeOf<Promise<any>>();

  // Async explicit: parse and cli return Promises
  const asyncExplicitParsed = program.parse('async-explicit --name hello');
  expectTypeOf(asyncExplicitParsed).toMatchTypeOf<Promise<any>>();

  const asyncExplicitCli = program.eval('async-explicit --name hello');
  expectTypeOf(asyncExplicitCli).toMatchTypeOf<Promise<any>>();

  // Builder: .async() is available on builder
  expectTypeOf<'async'>().toExtend<keyof PadroneBuilder>();
});
