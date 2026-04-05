import { describe, expect, it } from 'bun:test';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

describe('Positional arguments passed as named options', () => {
  describe('single positional', () => {
    const program = createPadrone('app').command('cmd', (c) =>
      c.arguments(z.object({ pos1: z.string() }), { positional: ['pos1'] }).action((args) => args),
    );

    it('should accept positional by position', () => {
      const result = program.eval('cmd val1');
      expect(result.args).toEqual({ pos1: 'val1' });
    });

    it('should accept positional as named option', () => {
      const result = program.eval('cmd --pos1=val1');
      expect(result.args).toEqual({ pos1: 'val1' });
    });

    it('should accept positional as named option with space separator', () => {
      const result = program.eval('cmd --pos1 val1');
      expect(result.args).toEqual({ pos1: 'val1' });
    });
  });

  describe('two positionals — all named', () => {
    const program = createPadrone('app').command('cmd', (c) =>
      c.arguments(z.object({ pos1: z.string(), pos2: z.string() }), { positional: ['pos1', 'pos2'] }).action((args) => args),
    );

    it('should accept both positionals as named options', () => {
      const result = program.eval('cmd --pos1=val1 --pos2=val2');
      expect(result.args).toEqual({ pos1: 'val1', pos2: 'val2' });
    });

    it('should accept both positionals by position', () => {
      const result = program.eval('cmd val1 val2');
      expect(result.args).toEqual({ pos1: 'val1', pos2: 'val2' });
    });
  });

  describe('two positionals — trailing named is allowed', () => {
    const program = createPadrone('app').command('cmd', (c) =>
      c.arguments(z.object({ pos1: z.string(), pos2: z.string() }), { positional: ['pos1', 'pos2'] }).action((args) => args),
    );

    it('should allow first positional by position and second as named', () => {
      const result = program.eval('cmd val1 --pos2=val2');
      expect(result.args).toEqual({ pos1: 'val1', pos2: 'val2' });
    });
  });

  describe('two positionals — naming an earlier positional while passing a later one by position is not allowed', () => {
    const program = createPadrone('app').command('cmd', (c) =>
      c.arguments(z.object({ pos1: z.string(), pos2: z.string() }), { positional: ['pos1', 'pos2'] }).action((args) => args),
    );

    it('should fail with ambiguity error when first is named and second is positional', () => {
      // `cmd val2 --pos1=val1` — pos1 is provided both positionally and as --pos1
      const result = program.eval('cmd val2 --pos1=val1');
      expect(result.args).toBeUndefined();
      expect(result.argsResult?.issues).toBeDefined();
      expect(result.argsResult?.issues?.some((i: any) => i.message?.includes('Ambiguous'))).toBe(true);
    });
  });

  describe('two positionals with optional — ambiguity still detected', () => {
    const program = createPadrone('app').command('cmd', (c) =>
      c.arguments(z.object({ pos1: z.string(), pos2: z.string().optional() }), { positional: ['pos1', 'pos2'] }).action((args) => args),
    );

    it('should fail even when the trailing positional is optional', () => {
      // `cmd val2 --pos1=val1` — pos1 is provided both positionally and as --pos1
      const result = program.eval('cmd val2 --pos1=val1');
      expect(result.args).toBeUndefined();
      expect(result.argsResult?.issues).toBeDefined();
      expect(result.argsResult?.issues?.some((i: any) => i.message?.includes('Ambiguous'))).toBe(true);
    });
  });

  describe('three positionals — partial named from the end', () => {
    const program = createPadrone('app').command('cmd', (c) =>
      c.arguments(z.object({ a: z.string(), b: z.string(), c: z.string() }), { positional: ['a', 'b', 'c'] }).action((args) => args),
    );

    it('should allow naming only the last positional', () => {
      const result = program.eval('cmd val1 val2 --c=val3');
      expect(result.args).toEqual({ a: 'val1', b: 'val2', c: 'val3' });
    });

    it('should allow naming the last two positionals', () => {
      const result = program.eval('cmd val1 --b=val2 --c=val3');
      expect(result.args).toEqual({ a: 'val1', b: 'val2', c: 'val3' });
    });

    it('should allow naming all three positionals', () => {
      const result = program.eval('cmd --a=val1 --b=val2 --c=val3');
      expect(result.args).toEqual({ a: 'val1', b: 'val2', c: 'val3' });
    });

    it('should fail when naming a middle positional but passing the last by position', () => {
      // `cmd val1 val3 --b=val2` — b is provided both positionally and as --b
      const result = program.eval('cmd val1 val3 --b=val2');
      expect(result.args).toBeUndefined();
      expect(result.argsResult?.issues).toBeDefined();
      expect(result.argsResult?.issues?.some((i: any) => i.message?.includes('Ambiguous'))).toBe(true);
    });

    it('should fail when naming the first positional but passing later ones by position', () => {
      // `cmd val2 val3 --a=val1` — a is provided both positionally and as --a
      const result = program.eval('cmd val2 val3 --a=val1');
      expect(result.args).toBeUndefined();
      expect(result.argsResult?.issues).toBeDefined();
      expect(result.argsResult?.issues?.some((i: any) => i.message?.includes('Ambiguous'))).toBe(true);
    });
  });

  describe('three positionals with optional last — naming earlier still fails', () => {
    const program = createPadrone('app').command('cmd', (c) =>
      c
        .arguments(z.object({ a: z.string(), b: z.string(), c: z.string().optional() }), { positional: ['a', 'b', 'c'] })
        .action((args) => args),
    );

    it('should fail when naming first positional with positional values present, even if last is optional', () => {
      // `cmd val1 val2 --a=val3` — a is provided both positionally and as --a
      const result = program.eval('cmd val1 val2 --a=val3');
      expect(result.args).toBeUndefined();
      expect(result.argsResult?.issues).toBeDefined();
      expect(result.argsResult?.issues?.some((i: any) => i.message?.includes('Ambiguous'))).toBe(true);
    });
  });
});
