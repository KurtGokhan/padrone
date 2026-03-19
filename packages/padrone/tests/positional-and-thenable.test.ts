import { describe, expect, expectTypeOf, it } from 'bun:test';
import { asyncSchema, createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

describe('Positional argument help signature', () => {
  createConsoleMocker();

  it('should show choices for enum positional arguments', () => {
    const program = createPadrone('app').command('deploy', (c) =>
      c
        .arguments(z.object({ env: z.enum(['dev', 'staging', 'prod']) }), {
          positional: ['env'],
        })
        .action((args) => args.env),
    );

    const help = program.help('deploy', { format: 'text' });
    expect(help).toContain('(choices: dev, staging, prod)');
  });

  it('should show choices for optional enum positional arguments', () => {
    const program = createPadrone('app').command('deploy', (c) =>
      c
        .arguments(z.object({ env: z.enum(['dev', 'staging', 'prod']).default('dev') }), {
          positional: ['env'],
        })
        .action((args) => args.env),
    );

    const help = program.help('deploy', { format: 'text' });
    expect(help).toContain('(choices: dev, staging, prod)');
    expect(help).toContain('(default: dev)');
  });

  it('should show choices for variadic array enum positional arguments', () => {
    const program = createPadrone('app').command('deploy', (c) =>
      c
        .arguments(z.object({ envs: z.array(z.enum(['dev', 'staging', 'prod'])) }), {
          positional: ['...envs'],
        })
        .action((args) => args.envs),
    );

    const help = program.help('deploy', { format: 'text' });
    expect(help).toContain('(choices: dev, staging, prod)');
  });

  it('should show default for optional positional arguments', () => {
    const program = createPadrone('app').command('greet', (c) =>
      c
        .arguments(z.object({ name: z.string().default('World') }), {
          positional: ['name'],
        })
        .action((args) => `Hello, ${args.name}!`),
    );

    const help = program.help('greet', { format: 'text' });
    expect(help).toContain('(default: World)');
  });

  it('should show both choices and default together', () => {
    const program = createPadrone('app').command('format', (c) =>
      c
        .arguments(z.object({ type: z.enum(['json', 'yaml', 'toml']).default('json') }), {
          positional: ['type'],
        })
        .action((args) => args.type),
    );

    const help = program.help('format', { format: 'text' });
    expect(help).toContain('(choices: json, yaml, toml)');
    expect(help).toContain('(default: json)');
  });
});

describe('Optional array enum positional type safety', () => {
  createConsoleMocker();

  it('should accept ...name for optional array enum positionals', () => {
    const program = createPadrone('app').command('deploy', (c) =>
      c
        .arguments(z.object({ envs: z.array(z.enum(['dev', 'staging', 'prod'])).optional() }), {
          positional: ['...envs'],
        })
        .action((args) => args.envs),
    );

    const result = program.eval('deploy dev staging');
    expect(result.args?.envs).toEqual(['dev', 'staging']);
  });

  it('should accept plain name (non-variadic) for optional array enum positionals', () => {
    const program = createPadrone('app').command('deploy', (c) =>
      c
        .arguments(z.object({ envs: z.array(z.enum(['dev', 'staging', 'prod'])).optional() }), {
          positional: ['envs'],
        })
        .action((args) => args.envs),
    );

    // Single positional should be coerced to array
    const result = program.eval('deploy dev');
    expect(result.args?.envs).toEqual(['dev']);
  });

  it('should accept required array enum positionals', () => {
    const program = createPadrone('app').command('deploy', (c) =>
      c
        .arguments(z.object({ envs: z.array(z.enum(['dev', 'staging', 'prod'])) }), {
          positional: ['...envs'],
        })
        .action((args) => args.envs),
    );

    const result = program.eval('deploy dev prod');
    expect(result.args?.envs).toEqual(['dev', 'prod']);
  });
});

describe('Single item to array coercion', () => {
  createConsoleMocker();

  it('should coerce a single string to string[] when schema expects array', () => {
    const program = createPadrone('app').command('tag', (c) =>
      c.arguments(z.object({ tags: z.array(z.string()) })).action((args) => args.tags),
    );

    const result = program.eval('tag --tags foo');
    expect(result.args?.tags).toEqual(['foo']);
  });

  it('should coerce a single value to number[] when schema expects number array', () => {
    const program = createPadrone('app').command('calc', (c) =>
      c.arguments(z.object({ nums: z.array(z.number()) })).action((args) => args.nums),
    );

    const result = program.eval('calc --nums 42');
    expect(result.args?.nums).toEqual([42]);
  });

  it('should coerce a single value to boolean[] when schema expects boolean array', () => {
    const program = createPadrone('app').command('flags', (c) =>
      c.arguments(z.object({ flags: z.array(z.boolean()) })).action((args) => args.flags),
    );

    const result = program.eval('flags --flags true');
    expect(result.args?.flags).toEqual([true]);
  });

  it('should not double-wrap values that are already arrays', () => {
    const program = createPadrone('app').command('tag', (c) =>
      c.arguments(z.object({ tags: z.array(z.string()) })).action((args) => args.tags),
    );

    const result = program.eval('tag --tags foo --tags bar');
    expect(result.args?.tags).toEqual(['foo', 'bar']);
  });

  it('should coerce single positional to array for non-variadic array positional', () => {
    const program = createPadrone('app').command('tag', (c) =>
      c
        .arguments(z.object({ tags: z.array(z.string()) }), {
          positional: ['tags'],
        })
        .action((args) => args.tags),
    );

    const result = program.eval('tag mytag');
    expect(result.args?.tags).toEqual(['mytag']);
  });

  it('should coerce single named enum value to array', () => {
    const program = createPadrone('app').command('filter', (c) =>
      c.arguments(z.object({ status: z.array(z.enum(['pending', 'done'])).optional() })).action((args) => args.status),
    );

    const result = program.eval('filter --status pending');
    expect(result.args?.status).toEqual(['pending']);
  });

  it('should coerce single value to optional array', () => {
    const program = createPadrone('app').command('search', (c) =>
      c.arguments(z.object({ tags: z.array(z.string()).optional() })).action((args) => args.tags),
    );

    const result = program.eval('search --tags docs');
    expect(result.args?.tags).toEqual(['docs']);
  });
});

describe('Thenable results', () => {
  createConsoleMocker();

  describe('eval() returns thenable', () => {
    it('should support .then() on sync eval result', async () => {
      const program = createPadrone('app').command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

      const result = program.eval('greet World');

      // Sync access still works
      expect(result.args?.name).toBe('World');
      expect(result.result).toBe('Hello, World!');

      // .then() also works
      const awaited = await result;
      expect(awaited.args?.name).toBe('World');
      expect(awaited.result).toBe('Hello, World!');
    });

    it('should support .then() chaining on sync eval result', async () => {
      const program = createPadrone('app').command('add', (c) =>
        c.arguments(z.object({ a: z.coerce.number(), b: z.coerce.number() })).action((args) => args.a + args.b),
      );

      const sum = await program.eval('add --a=2 --b=3').then((r) => r.result);
      expect(sum).toBe(5);
    });

    it('should resolve correctly with await on sync eval result', async () => {
      const program = createPadrone('app').command('echo', (c) =>
        c.arguments(z.object({ msg: z.string() }), { positional: ['msg'] }).action((args) => args.msg),
      );

      const result = await program.eval('echo hello');
      expect(result.result).toBe('hello');
    });

    it('should support .catch() on sync eval result', async () => {
      const program = createPadrone('app').command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

      const result = program.eval('greet World');
      expect(typeof result.catch).toBe('function');

      // .catch() should not be called on success
      let catchCalled = false;
      const value = await result.catch(() => {
        catchCalled = true;
      });
      expect(catchCalled).toBe(false);
      expect(value).toBeDefined();
    });

    it('should support .finally() on sync eval result', async () => {
      const program = createPadrone('app').command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

      const result = program.eval('greet World');
      expect(typeof result.finally).toBe('function');

      let finallyCalled = false;
      const value = await result.finally(() => {
        finallyCalled = true;
      });
      expect(finallyCalled).toBe(true);
      expect(value.result).toBe('Hello, World!');
    });
  });

  describe('parse() returns thenable', () => {
    it('should support .then() on sync parse result', async () => {
      const program = createPadrone('app').command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

      const result = program.parse('greet World');

      // Sync access still works
      expect(result.args?.name).toBe('World');

      // .then() also works
      const awaited = await result;
      expect(awaited.args?.name).toBe('World');
    });

    it('should support .then() chaining on sync parse result', async () => {
      const program = createPadrone('app').command('greet', (c) =>
        c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
      );

      const name = await program.parse('greet Alice').then((r) => r.args?.name);
      expect(name).toBe('Alice');
    });
  });

  describe('cli() returns thenable', () => {
    it('should support .then() on sync cli result', async () => {
      const program = createPadrone('app')
        .runtime({ argv: () => ['greet', 'World'] })
        .command('greet', (c) =>
          c.arguments(z.object({ name: z.string() }), { positional: ['name'] }).action((args) => `Hello, ${args.name}!`),
        );

      const result = program.cli();

      // Sync access still works
      expect(result.result).toBe('Hello, World!');

      // .then() also works
      const awaited = await result;
      expect(awaited.result).toBe('Hello, World!');
    });

    it('should support await on sync cli result', async () => {
      const program = createPadrone('app')
        .runtime({ argv: () => ['echo', '--msg', 'hi'] })
        .command('echo', (c) => c.arguments(z.object({ msg: z.string() })).action((args) => args.msg));

      const result = await program.cli();
      expect(result.result).toBe('hi');
    });
  });

  describe('async commands are awaitable', () => {
    it('async branded schema result is awaitable', async () => {
      const program = createPadrone('app').command('cmd', (c) =>
        c.arguments(asyncSchema(z.object({ name: z.string() }))).action((args) => args.name),
      );

      const result = program.eval('cmd --name hello');
      // Should be thenable (can use .then() and await)
      expect(typeof result.then).toBe('function');

      const awaited = await result;
      expect(awaited.args?.name).toBe('hello');
      expect(awaited.result).toBe('hello');
    });

    it('explicit .async() result is awaitable', async () => {
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .arguments(z.object({ name: z.string() }))
          .async()
          .action((args) => args.name),
      );

      const result = program.eval('cmd --name hello');
      // Should be thenable (can use .then() and await)
      expect(typeof result.then).toBe('function');

      const awaited = await result;
      expect(awaited.result).toBe('hello');
    });

    it('truly async validation returns a Promise', async () => {
      const program = createPadrone('app').command('cmd', (c) =>
        c
          .arguments(
            z.object({ name: z.string() }).check(async (ctx) => {
              if (ctx.value.name === '') ctx.issues.push({ message: 'empty', code: 'custom', input: ctx.value });
            }),
          )
          .async()
          .action((args) => args.name),
      );

      const result = program.eval('cmd --name hello');
      expect(result).toBeInstanceOf(Promise);

      const awaited = await result;
      expect(awaited.result).toBe('hello');
    });
  });
});

describe.skip('Types - Thenable results', () => {
  const program = createPadrone('app')
    .command('sync', (c) => c.arguments(z.object({ name: z.string() })).action((args) => args.name))
    .command('async-branded', (c) => c.arguments(asyncSchema(z.object({ name: z.string() }))).action((args) => args.name))
    .command('async-explicit', (c) =>
      c
        .arguments(z.object({ name: z.string() }))
        .async()
        .action((args) => args.name),
    );

  // Sync eval result is thenable (has .then, .catch, .finally methods)
  const syncResult = program.eval('sync --name hello');
  expectTypeOf(syncResult).toHaveProperty('then');
  expectTypeOf(syncResult).toHaveProperty('catch');
  expectTypeOf(syncResult).toHaveProperty('finally');
  expectTypeOf(syncResult.then).toBeFunction();
  expectTypeOf(syncResult.catch).toBeFunction();
  expectTypeOf(syncResult.finally).toBeFunction();
  // But is NOT a Promise
  expectTypeOf(syncResult).not.toMatchTypeOf<Promise<any>>();

  // Async eval result is a Promise
  const asyncResult = program.eval('async-branded --name hello');
  expectTypeOf(asyncResult).toMatchTypeOf<Promise<any>>();

  const asyncExplicitResult = program.eval('async-explicit --name hello');
  expectTypeOf(asyncExplicitResult).toMatchTypeOf<Promise<any>>();

  // Sync parse result is thenable
  const syncParse = program.parse('sync --name hello');
  expectTypeOf(syncParse).toHaveProperty('then');
  expectTypeOf(syncParse).toHaveProperty('catch');
  expectTypeOf(syncParse).toHaveProperty('finally');
  expectTypeOf(syncParse.then).toBeFunction();
  expectTypeOf(syncParse.catch).toBeFunction();
  expectTypeOf(syncParse.finally).toBeFunction();
  expectTypeOf(syncParse).not.toMatchTypeOf<Promise<any>>();

  // Async parse result is a Promise
  const asyncParse = program.parse('async-branded --name hello');
  expectTypeOf(asyncParse).toMatchTypeOf<Promise<any>>();

  // cli result is thenable
  const cliResult = program.cli();
  expectTypeOf(cliResult).toHaveProperty('then');
  expectTypeOf(cliResult).toHaveProperty('catch');
  expectTypeOf(cliResult).toHaveProperty('finally');
  expectTypeOf(cliResult.then).toBeFunction();
  expectTypeOf(cliResult.catch).toBeFunction();
  expectTypeOf(cliResult.finally).toBeFunction();
});

describe.skip('Types - Optional array enum positionals', () => {
  // Optional array enum should allow both ...name and name in positional config
  const _program1 = createPadrone('app').command('deploy', (c) =>
    c
      .arguments(z.object({ envs: z.array(z.enum(['dev', 'staging', 'prod'])).optional() }), {
        positional: ['...envs'],
      })
      .action((args) => args.envs),
  );

  const _program2 = createPadrone('app').command('deploy', (c) =>
    c
      .arguments(z.object({ envs: z.array(z.enum(['dev', 'staging', 'prod'])).optional() }), {
        positional: ['envs'],
      })
      .action((args) => args.envs),
  );

  // Required array should also allow both forms
  const _program3 = createPadrone('app').command('deploy', (c) =>
    c
      .arguments(z.object({ envs: z.array(z.string()) }), {
        positional: ['...envs'],
      })
      .action((args) => args.envs),
  );

  const _program4 = createPadrone('app').command('deploy', (c) =>
    c
      .arguments(z.object({ envs: z.array(z.string()) }), {
        positional: ['envs'],
      })
      .action((args) => args.envs),
  );
});
