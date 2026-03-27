import { describe, expect, expectTypeOf, it } from 'bun:test';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

describe('mount', () => {
  const admin = createPadrone('admin')
    .configure({ description: 'Admin panel' })
    .arguments(z.object({ verbose: z.boolean().default(false) }))
    .action((args) => `admin root verbose=${args.verbose}`)
    .command('users', (c) => c.arguments(z.object({ role: z.string().default('all') })).action((args) => `users role=${args.role}`))
    .command('roles', (c) => c.action(() => 'roles list'));

  describe('basic mounting', () => {
    const app = createPadrone('app').mount('admin', admin);

    it('should mount a program as a subcommand', () => {
      const result = app.eval('admin --verbose');
      expect(result.result).toBe('admin root verbose=true');
    });

    it('should mount subcommands of the mounted program', () => {
      const result = app.eval('admin users --role=editor');
      expect(result.result).toBe('users role=editor');
    });

    it('should mount deeply nested subcommands', () => {
      const result = app.eval('admin roles');
      expect(result.result).toBe('roles list');
    });

    it('should re-path the mounted command', () => {
      const found = app.find('admin');
      expect(found).toBeDefined();
      expect(found!.name).toBe('admin');
      expect(found!.path).toBe('admin');
    });

    it('should re-path nested commands under the mount point', () => {
      const found = app.find('admin users');
      expect(found).toBeDefined();
      expect(found!.name).toBe('users');
      expect(found!.path).toBe('admin users');
    });

    it('should drop the version from the mounted program root', () => {
      const versioned = createPadrone('lib')
        .configure({ version: '2.0.0' })
        .command('cmd', (c) => c.action(() => 'ok'));
      const host = createPadrone('host').mount('lib', versioned);
      const found = host.find('lib');
      expect(found).toBeDefined();
      expect(found!.version).toBeUndefined();
    });

    it('should set parent references to the host program', () => {
      const found = app.find('admin');
      expect(found).toBeDefined();
      expect(found!.parent).toBeDefined();
      expect(found!.parent!.name).toBe('app');
    });

    it('should set parent references on nested mounted commands', () => {
      const found = app.find('admin users');
      expect(found).toBeDefined();
      expect(found!.parent).toBeDefined();
      expect(found!.parent!.name).toBe('admin');
    });
  });

  describe('aliases', () => {
    const app = createPadrone('app').mount(['admin', 'adm', 'a'], admin);

    it('should support aliases for the mounted command', () => {
      const result = app.eval('adm users');
      expect(result.result).toBe('users role=all');
    });

    it('should resolve the primary name via alias', () => {
      const result = app.eval('a roles');
      expect(result.result).toBe('roles list');
    });
  });

  describe('composition with existing commands', () => {
    const app = createPadrone('app')
      .command('status', (c) => c.action(() => 'status ok'))
      .mount('admin', admin);

    it('should keep existing commands when mounting', () => {
      const result = app.eval('status');
      expect(result.result).toBe('status ok');
    });

    it('should add mounted commands alongside existing ones', () => {
      const result = app.eval('admin roles');
      expect(result.result).toBe('roles list');
    });
  });

  describe('nested mounting', () => {
    const db = createPadrone('db')
      .command('migrate', (c) => c.action(() => 'migrated'))
      .command('seed', (c) => c.action(() => 'seeded'));

    const infra = createPadrone('infra')
      .mount('database', db)
      .command('deploy', (c) => c.action(() => 'deployed'));

    const app = createPadrone('app').mount('infra', infra);

    it('should support mounting a program that already has mounted programs', () => {
      const result = app.eval('infra database migrate');
      expect(result.result).toBe('migrated');
    });

    it('should re-path deeply nested mounted commands', () => {
      const found = app.find('infra database migrate');
      expect(found).toBeDefined();
      expect(found!.path).toBe('infra database migrate');
    });

    it('should allow direct commands alongside mounted ones', () => {
      const result = app.eval('infra deploy');
      expect(result.result).toBe('deployed');
    });
  });

  describe('mounting with arguments and schemas', () => {
    const auth = createPadrone('auth')
      .arguments(z.object({ token: z.string().optional() }))
      .command('login', (c) =>
        c.arguments(z.object({ username: z.string(), password: z.string() })).action((args) => `login ${args.username}`),
      )
      .command('logout', (c) => c.action(() => 'logged out'));

    const app = createPadrone('app').mount('auth', auth);

    it('should preserve argument schemas on mounted subcommands', () => {
      const result = app.eval('auth login --username=alice --password=secret');
      expect(result.result).toBe('login alice');
    });

    it('should preserve handler on mounted subcommands', () => {
      const result = app.eval('auth logout');
      expect(result.result).toBe('logged out');
    });
  });

  describe('mounting with interceptors', () => {
    const calls: string[] = [];

    const pluggedProgram = createPadrone('plugged')
      .intercept({ name: 'test-interceptor' }, () => ({
        execute: (_ctx, next) => {
          calls.push('interceptor-before');
          const result = next();
          calls.push('interceptor-after');
          return result;
        },
      }))
      .command('cmd', (c) =>
        c.action(() => {
          calls.push('handler');
          return 'done';
        }),
      );

    it('should preserve interceptors from the mounted program', () => {
      calls.length = 0;
      const app = createPadrone('app').mount('plugged', pluggedProgram);
      const result = app.eval('plugged cmd');
      expect(result.result).toBe('done');
      expect(calls).toEqual(['interceptor-before', 'handler', 'interceptor-after']);
    });
  });

  describe('type inference', () => {
    const sub = createPadrone('sub')
      .command('greet', (c) => c.arguments(z.object({ name: z.string() })).action((args) => `Hello, ${args.name}!`))
      .command('add', (c) => c.arguments(z.object({ a: z.number(), b: z.number() })).action((args) => args.a + args.b));

    const app = createPadrone('app')
      .command('status', (c) => c.action(() => 'ok' as const))
      .mount('sub', sub);

    it('should infer the correct result type for mounted commands', () => {
      const result = app.eval('sub greet --name=world');
      expectTypeOf(result.result!).toBeString();
    });

    it('should preserve existing command types after mounting', () => {
      const result = app.eval('status');
      expect(result.result).toBe('ok');
    });
  });

  describe('help output', () => {
    const sub = createPadrone('sub')
      .configure({ description: 'Sub program' })
      .command('cmd1', (c) => c.configure({ description: 'Command one' }).action(() => 'one'))
      .command('cmd2', (c) => c.configure({ description: 'Command two' }).action(() => 'two'));

    const app = createPadrone('app').mount('sub', sub);

    it('should show mounted command in program help', () => {
      const help = app.help(undefined, { format: 'text' });
      expect(help).toContain('sub');
    });

    it('should show subcommands of mounted program in its help', () => {
      const help = app.help('sub', { format: 'text' });
      expect(help).toContain('cmd1');
      expect(help).toContain('cmd2');
    });
  });

  describe('error handling', () => {
    it('should throw when mounting a non-program value', () => {
      expect(() => {
        createPadrone('app').mount('bad', {} as any);
      }).toThrow('Cannot mount: not a valid Padrone program');
    });
  });

  describe('run() with mounted commands', () => {
    const sub = createPadrone('sub').command('echo', (c) => c.arguments(z.object({ msg: z.string() })).action((args) => args.msg));

    const app = createPadrone('app').mount('sub', sub);

    it('should run mounted subcommands via run()', () => {
      const result = app.run('sub echo', { msg: 'hello' });
      expect(result.result).toBe('hello');
    });
  });
});
