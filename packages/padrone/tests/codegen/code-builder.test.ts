import { describe, expect, it } from 'bun:test';
import { createCodeBuilder } from 'padrone/codegen';

describe('CodeBuilder', () => {
  it('should build empty source', () => {
    const result = createCodeBuilder().build();
    expect(result.text).toBe('');
    expect(result.imports.size).toBe(0);
  });

  it('should add simple lines', () => {
    const result = createCodeBuilder().line('const x = 1').line('const y = 2').build();

    expect(result.text).toBe('const x = 1\nconst y = 2');
  });

  it('should add blank lines', () => {
    const result = createCodeBuilder().line('const x = 1').line().line('const y = 2').build();

    expect(result.text).toBe('const x = 1\n\nconst y = 2');
  });

  it('should add imports', () => {
    const result = createCodeBuilder().import('z', 'zod').line('const schema = z.string()').build();

    expect(result.text).toContain("import { z } from 'zod'");
    expect(result.text).toContain('const schema = z.string()');
    expect(result.imports.get('zod')?.specifiers.has('z')).toBe(true);
  });

  it('should add type imports', () => {
    const result = createCodeBuilder().importType(['PadroneCommand'], 'padrone').line('const cmd: PadroneCommand = {} as any').build();

    expect(result.text).toContain("import type { PadroneCommand } from 'padrone'");
  });

  it('should deduplicate imports from same source', () => {
    const result = createCodeBuilder().import('z', 'zod').import('z', 'zod').build();

    const importLines = result.text.split('\n').filter((l) => l.startsWith('import'));
    expect(importLines.length).toBe(1);
  });

  it('should merge multiple specifiers from same source', () => {
    const result = createCodeBuilder().import('createPadrone', 'padrone').import('asyncSchema', 'padrone').build();

    expect(result.text).toContain('asyncSchema');
    expect(result.text).toContain('createPadrone');
    // Should be in one import statement
    const importLines = result.text.split('\n').filter((l) => l.startsWith('import'));
    expect(importLines.length).toBe(1);
  });

  it('should downgrade type-only import when value import is added', () => {
    const result = createCodeBuilder().importType(['Foo'], 'bar').import(['Baz'], 'bar').build();

    // Should not be "import type" since we also have a value import
    expect(result.text).not.toContain('import type');
    expect(result.text).toContain("import { Baz, Foo } from 'bar'");
  });

  it('should handle block with builder only', () => {
    const result = createCodeBuilder()
      .block((b) => b.line('inner line'))
      .build();

    expect(result.text).toContain('  inner line');
  });

  it('should handle block with open and close', () => {
    const result = createCodeBuilder()
      .block('z.object({', (b) => b.line('name: z.string(),'), '})')
      .build();

    expect(result.text).toContain('z.object({');
    expect(result.text).toContain('  name: z.string(),');
    expect(result.text).toContain('})');
  });

  it('should handle block with open, close string, and builder', () => {
    const result = createCodeBuilder()
      .block('if (true) {', '}', (b) => b.line('console.log("yes")'))
      .build();

    expect(result.text).toContain('if (true) {');
    expect(result.text).toContain('  console.log("yes")');
    expect(result.text).toContain('}');
  });

  it('should add single-line comments', () => {
    const result = createCodeBuilder().comment('This is a comment').build();

    expect(result.text).toBe('// This is a comment');
  });

  it('should add single-line doc comments', () => {
    const result = createCodeBuilder().docComment('Brief description').build();

    expect(result.text).toBe('/** Brief description */');
  });

  it('should add multi-line doc comments', () => {
    const result = createCodeBuilder().docComment('Line one\nLine two').build();

    expect(result.text).toContain('/**');
    expect(result.text).toContain(' * Line one');
    expect(result.text).toContain(' * Line two');
    expect(result.text).toContain(' */');
  });

  it('should add TODO comments', () => {
    const result = createCodeBuilder().todoComment('Implement this').build();

    expect(result.text).toBe('// TODO: Implement this');
  });

  it('should add raw code without indentation', () => {
    const result = createCodeBuilder()
      .block((b) => b.raw('already formatted'))
      .build();

    expect(result.text).toContain('already formatted');
    // Raw should not be indented
    expect(result.text).not.toContain('  already formatted');
  });

  it('should merge imports from nested blocks', () => {
    const result = createCodeBuilder()
      .block((b) => b.import('z', 'zod').line('z.string()'))
      .build();

    expect(result.imports.get('zod')?.specifiers.has('z')).toBe(true);
    expect(result.text).toContain("import { z } from 'zod'");
  });

  it('should place value imports before type imports', () => {
    const result = createCodeBuilder().importType(['Foo'], 'types').import(['bar'], 'utils').build();

    const lines = result.text.split('\n');
    const valueIdx = lines.findIndex((l) => l.includes("from 'utils'"));
    const typeIdx = lines.findIndex((l) => l.includes("from 'types'"));

    expect(valueIdx).toBeLessThan(typeIdx);
  });
});
