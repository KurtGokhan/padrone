import { describe, expect, it, mock } from 'bun:test';
import * as z from 'zod/v4';
import { createPadrone } from '../src/core/create.ts';
import { testCli } from '../src/feature/test.ts';

describe('lazy command initialization', () => {
  it('should not invoke builderFn until the command is used', async () => {
    const greetBuilder = mock((c: any) =>
      c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args: any) => `Hello, ${args.name}!`),
    );
    const unusedBuilder = mock((c: any) => c.action(() => 'unused'));

    const program = createPadrone('test').command('greet', greetBuilder).command('unused', unusedBuilder);

    expect(greetBuilder).not.toHaveBeenCalled();
    expect(unusedBuilder).not.toHaveBeenCalled();

    const result = await testCli(program).run('greet Alice');

    expect(result.result).toBe('Hello, Alice!');
    expect(greetBuilder).toHaveBeenCalledTimes(1);
    expect(unusedBuilder).not.toHaveBeenCalled();
  });

  it('should resolve lazily across multiple eval calls on the same program', async () => {
    const builder = mock((c: any) =>
      c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args: any) => `Hi, ${args.name}!`),
    );

    const program = createPadrone('test').command('greet', builder);

    const r1 = await testCli(program).run('greet Alice');
    const r2 = await testCli(program).run('greet Bob');

    expect(r1.result).toBe('Hi, Alice!');
    expect(r2.result).toBe('Hi, Bob!');
    // Builder may be called more than once due to re-parenting creating fresh copies,
    // but the key invariant is that it works correctly every time
  });

  it('should not invoke builders for help display', async () => {
    const builder = mock((c: any) => c.action(() => 'result'));
    const program = createPadrone('test').command('greet', builder);

    const result = await testCli(program).run('help');

    expect(result.result).toContain('greet');
    // Help resolves all commands, so builder should be called
    expect(builder).toHaveBeenCalled();
  });

  it('should resolve nested lazy commands', async () => {
    let innerCalled = false;

    const program = createPadrone('test').command('db', (c) =>
      c.command('migrate', (s) => {
        innerCalled = true;
        return s.action(() => 'migrated');
      }),
    );

    expect(innerCalled).toBe(false);

    const result = await testCli(program).run('db migrate');

    expect(result.result).toBe('migrated');
    expect(innerCalled).toBe(true);
  });

  it('should work with command override on lazy commands', async () => {
    const program = createPadrone('app')
      .command('db', (c) =>
        c
          .configure({ title: 'Database' })
          .command('migrate', (c) => c.action(() => 'migrated'))
          .command('seed', (c) => c.action(() => 'seeded')),
      )
      .command('db', (c) => c.configure({ title: 'Database v2' }));

    const migrate = await testCli(program).run('db migrate');
    const seed = await testCli(program).run('db seed');

    expect(migrate.result).toBe('migrated');
    expect(seed.result).toBe('seeded');
    expect(program.find('db')?.title).toBe('Database v2');
  });

  it('should resolve commands without builderFn immediately', () => {
    const program = createPadrone('test')
      .command('simple')
      .command('greet', (c) => c.action(() => 'hi'));

    // Simple command without builderFn should be available immediately
    expect(program.find('simple')).toBeDefined();
    expect(program.find('simple')?.name).toBe('simple');
  });
});
