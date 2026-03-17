import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFileEmitter } from 'padrone/codegen';

const TEST_DIR = join(import.meta.dir, '.tmp-emitter-test');

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

describe('FileEmitter', () => {
  afterEach(cleanup);

  it('should write files to disk', async () => {
    const emitter = createFileEmitter({ outDir: TEST_DIR });
    emitter.addFile('test.ts', 'const x = 1');

    const result = await emitter.emit();

    expect(result.written).toEqual(['test.ts']);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);

    const content = readFileSync(join(TEST_DIR, 'test.ts'), 'utf-8');
    expect(content).toBe('const x = 1');
  });

  it('should create nested directories', async () => {
    const emitter = createFileEmitter({ outDir: TEST_DIR });
    emitter.addFile('commands/deploy/preview.ts', 'export default {}');

    const result = await emitter.emit();

    expect(result.written).toEqual(['commands/deploy/preview.ts']);
    expect(existsSync(join(TEST_DIR, 'commands/deploy/preview.ts'))).toBe(true);
  });

  it('should prepend header to files', async () => {
    const emitter = createFileEmitter({
      outDir: TEST_DIR,
      header: '// Auto-generated',
    });
    emitter.addFile('test.ts', 'const x = 1');

    await emitter.emit();

    const content = readFileSync(join(TEST_DIR, 'test.ts'), 'utf-8');
    expect(content).toStartWith('// Auto-generated\n\nconst x = 1');
  });

  it('should skip existing files when overwrite is false', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, 'existing.ts'), 'old content');

    const emitter = createFileEmitter({ outDir: TEST_DIR, overwrite: false });
    emitter.addFile('existing.ts', 'new content');

    const result = await emitter.emit();

    expect(result.skipped).toEqual(['existing.ts']);
    expect(result.written).toEqual([]);

    const content = readFileSync(join(TEST_DIR, 'existing.ts'), 'utf-8');
    expect(content).toBe('old content');
  });

  it('should overwrite existing files when overwrite is true', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, 'existing.ts'), 'old content');

    const emitter = createFileEmitter({ outDir: TEST_DIR, overwrite: true });
    emitter.addFile('existing.ts', 'new content');

    const result = await emitter.emit();

    expect(result.written).toEqual(['existing.ts']);

    const content = readFileSync(join(TEST_DIR, 'existing.ts'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('should support dry run mode', async () => {
    const emitter = createFileEmitter({ outDir: TEST_DIR, dryRun: true });
    emitter.addFile('test.ts', 'const x = 1');

    const result = await emitter.emit();

    expect(result.written).toEqual(['test.ts']);
    expect(existsSync(join(TEST_DIR, 'test.ts'))).toBe(false);
  });

  it('should accept CodeBuildResult', async () => {
    const emitter = createFileEmitter({ outDir: TEST_DIR });
    emitter.addFile('test.ts', {
      text: 'const x = 1',
      imports: new Map(),
    });

    await emitter.emit();

    const content = readFileSync(join(TEST_DIR, 'test.ts'), 'utf-8');
    expect(content).toBe('const x = 1');
  });

  it('should handle multiple files', async () => {
    const emitter = createFileEmitter({ outDir: TEST_DIR });
    emitter.addFile('a.ts', 'const a = 1');
    emitter.addFile('b.ts', 'const b = 2');
    emitter.addFile('c.ts', 'const c = 3');

    const result = await emitter.emit();

    expect(result.written.length).toBe(3);
  });
});
