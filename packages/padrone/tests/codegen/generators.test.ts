import { describe, expect, it } from 'bun:test';
import type { CommandMeta, GeneratorContext } from 'padrone/codegen';
import { createCodeBuilder, generateBarrelFile, generateCommandFile, template } from 'padrone/codegen';

function createMockContext(overrides?: Partial<GeneratorContext>): GeneratorContext {
  return {
    outDir: '/tmp/test-output',
    createCodeBuilder,
    emitter: {
      addFile: () => {},
      emit: async () => ({ written: [], skipped: [], errors: [] }),
    },
    template,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    ...overrides,
  };
}

describe('generateCommandFile', () => {
  it('should generate a basic command file', () => {
    const command: CommandMeta = {
      name: 'deploy',
      description: 'Deploy the application',
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx);
    const built = result.build();

    expect(built.text).toContain("import type { PadroneBuilder } from 'padrone'");
    expect(built.text).toContain('export default (cmd: PadroneBuilder) => cmd');
    expect(built.text).toContain('description: "Deploy the application"');
    expect(built.text).toContain('.action((args) => { /* TODO */ })');
  });

  it('should generate command with arguments', () => {
    const command: CommandMeta = {
      name: 'deploy',
      description: 'Deploy the app',
      arguments: [
        { name: 'env', type: 'string', required: true, description: 'Target environment' },
        { name: 'force', type: 'boolean', default: false },
      ],
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx);
    const built = result.build();

    expect(built.text).toContain("import { z } from 'zod'");
    expect(built.text).toContain('.arguments(z.object({');
    expect(built.text).toContain('env: z.string()');
    expect(built.text).toContain('force: z.boolean()');
  });

  it('should generate command with positionals', () => {
    const command: CommandMeta = {
      name: 'show',
      positionals: [{ name: 'id', type: 'string', required: true, positional: true }],
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx);
    const built = result.build();

    expect(built.text).toContain("positional: ['id']");
  });

  it('should generate command with variadic positionals', () => {
    const command: CommandMeta = {
      name: 'batch',
      positionals: [{ name: 'files', type: 'array', required: true, positional: true }],
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx);
    const built = result.build();

    expect(built.text).toContain("positional: ['...files']");
  });

  it('should generate command with aliases', () => {
    const command: CommandMeta = {
      name: 'deploy',
      aliases: ['d', 'dep'],
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx);
    const built = result.build();

    expect(built.text).toContain('aliases: ["d", "dep"]');
  });

  it('should generate deprecated command', () => {
    const command: CommandMeta = {
      name: 'old-deploy',
      deprecated: 'Use deploy instead',
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx);
    const built = result.build();

    expect(built.text).toContain('@deprecated Use deploy instead');
    expect(built.text).toContain('deprecated: "Use deploy instead"');
  });
});

describe('generateBarrelFile', () => {
  it('should generate re-exports for all files', () => {
    const ctx = createMockContext();
    const result = generateBarrelFile(['commands/deploy.ts', 'commands/status.ts'], ctx);
    const built = result.build();

    expect(built.text).toContain("export * from './commands/deploy.ts'");
    expect(built.text).toContain("export * from './commands/status.ts'");
  });

  it('should handle already-relative paths', () => {
    const ctx = createMockContext();
    const result = generateBarrelFile(['./utils.ts'], ctx);
    const built = result.build();

    expect(built.text).toContain("export * from './utils.ts'");
  });
});
