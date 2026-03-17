import { describe, expect, it } from 'bun:test';
import type { CommandMeta, GeneratorContext } from 'padrone/codegen';
import { createCodeBuilder, generateBarrelFile, generateCommandFile, generateCommandTree, template } from 'padrone/codegen';

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

  it('should generate .wrap() when wrap option is provided', () => {
    const command: CommandMeta = {
      name: 'list',
      description: 'List pull requests',
      arguments: [
        { name: 'assignee', type: 'string', aliases: ['-a'], description: 'Filter by assignee' },
        { name: 'limit', type: 'number', default: 30, aliases: ['-l'], description: 'Maximum items' },
      ],
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx, {
      wrap: { command: 'gh', args: ['pr', 'list'] },
    });
    const built = result.build();

    expect(built.text).toContain('.wrap({ command: "gh", args: ["pr", "list"] })');
    expect(built.text).not.toContain('.action(');
    expect(built.text).toContain('aliases: { assignee: ["-a"], limit: ["-l"] }');
  });

  it('should generate .wrap() with command only (no args)', () => {
    const command: CommandMeta = {
      name: 'status',
      description: 'Show status',
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx, {
      wrap: { command: 'git', args: ['status'] },
    });
    const built = result.build();

    expect(built.text).toContain('.wrap({ command: "git", args: ["status"] })');
  });

  it('should include aliases in arguments meta', () => {
    const command: CommandMeta = {
      name: 'test',
      arguments: [
        { name: 'verbose', type: 'boolean', aliases: ['-v'] },
        { name: 'output', type: 'string', aliases: ['-o'] },
        { name: 'force', type: 'boolean' },
      ],
    };

    const ctx = createMockContext();
    const result = generateCommandFile(command, ctx);
    const built = result.build();

    expect(built.text).toContain('aliases: { verbose: ["-v"], output: ["-o"] }');
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

describe('generateCommandTree with wrap', () => {
  it('should generate wrap calls for subcommands', () => {
    const files = new Map<string, string>();
    const root: CommandMeta = {
      name: 'gh',
      description: 'GitHub CLI',
      subcommands: [
        {
          name: 'pr',
          description: 'Work with pull requests',
          subcommands: [
            {
              name: 'list',
              description: 'List pull requests',
              arguments: [{ name: 'assignee', type: 'string', aliases: ['-a'], description: 'Filter by assignee' }],
            },
          ],
        },
        {
          name: 'issue',
          description: 'Work with issues',
        },
      ],
    };

    const ctx = createMockContext({
      emitter: {
        addFile: (path, content) => {
          files.set(path, typeof content === 'string' ? content : content.text);
        },
        emit: async () => ({ written: [...files.keys()], skipped: [], errors: [] }),
      },
    });

    generateCommandTree(root, ctx, { wrap: { command: 'gh' } });

    // Should generate files for each subcommand
    expect(files.has('commands/pr.ts')).toBe(true);
    expect(files.has('commands/issue.ts')).toBe(true);
    expect(files.has('commands/pr/list.ts')).toBe(true);
    expect(files.has('program.ts')).toBe(true);
    expect(files.has('index.ts')).toBe(true);

    // The pr command should have .wrap() with args: ["pr"]
    const prContent = files.get('commands/pr.ts')!;
    expect(prContent).toContain('.wrap({ command: "gh", args: ["pr"] })');

    // The list command should have .wrap() with args: ["pr", "list"]
    const listContent = files.get('commands/pr/list.ts')!;
    expect(listContent).toContain('.wrap({ command: "gh", args: ["pr", "list"] })');
    expect(listContent).toContain('aliases: { assignee: ["-a"] }');

    // program.ts should wire up the root
    const programContent = files.get('program.ts')!;
    expect(programContent).toContain('createPadrone("gh")');
    expect(programContent).toContain('.command("pr"');
    expect(programContent).toContain('.command("issue"');
  });
});
