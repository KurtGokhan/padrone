import { describe, expect, it } from 'bun:test';
import type { CommandMeta } from 'padrone/codegen';
import { mergeCommandMeta } from 'padrone/codegen';

describe('mergeCommandMeta', () => {
  it('should return empty CommandMeta for no sources', () => {
    const result = mergeCommandMeta();
    expect(result.name).toBe('');
  });

  it('should return the single source unchanged', () => {
    const source: CommandMeta = { name: 'test', description: 'A test' };
    const result = mergeCommandMeta(source);
    expect(result).toBe(source); // Same reference
  });

  it('should merge names (first non-empty wins)', () => {
    const result = mergeCommandMeta({ name: 'first' }, { name: 'second' });
    expect(result.name).toBe('first');
  });

  it('should merge descriptions (last wins)', () => {
    const result = mergeCommandMeta({ name: 'test', description: 'Old' }, { name: 'test', description: 'New' });
    expect(result.description).toBe('New');
  });

  it('should merge aliases and deduplicate', () => {
    const result = mergeCommandMeta({ name: 'test', aliases: ['a', 'b'] }, { name: 'test', aliases: ['b', 'c'] });
    expect(result.aliases).toEqual(['a', 'b', 'c']);
  });

  it('should merge arguments by name', () => {
    const result = mergeCommandMeta(
      {
        name: 'test',
        arguments: [
          { name: 'verbose', type: 'boolean', description: 'Old desc' },
          { name: 'output', type: 'string' },
        ],
      },
      {
        name: 'test',
        arguments: [
          { name: 'verbose', type: 'boolean', description: 'New desc' },
          { name: 'port', type: 'number' },
        ],
      },
    );

    expect(result.arguments!.length).toBe(3);
    expect(result.arguments!.find((a) => a.name === 'verbose')?.description).toBe('New desc');
    expect(result.arguments!.find((a) => a.name === 'output')).toBeDefined();
    expect(result.arguments!.find((a) => a.name === 'port')).toBeDefined();
  });

  it('should prefer non-ambiguous types when merging', () => {
    const result = mergeCommandMeta(
      {
        name: 'test',
        arguments: [{ name: 'port', type: 'string', ambiguous: true }],
      },
      {
        name: 'test',
        arguments: [{ name: 'port', type: 'number', ambiguous: false }],
      },
    );

    const port = result.arguments!.find((a) => a.name === 'port');
    expect(port?.type).toBe('number');
    expect(port?.ambiguous).toBe(false);
  });

  it('should not override non-ambiguous with ambiguous', () => {
    const result = mergeCommandMeta(
      {
        name: 'test',
        arguments: [{ name: 'port', type: 'number' }],
      },
      {
        name: 'test',
        arguments: [{ name: 'port', type: 'string', ambiguous: true }],
      },
    );

    const port = result.arguments!.find((a) => a.name === 'port');
    expect(port?.type).toBe('number');
  });

  it('should merge subcommands recursively', () => {
    const result = mergeCommandMeta(
      {
        name: 'test',
        subcommands: [{ name: 'deploy', description: 'Deploy app', arguments: [{ name: 'env', type: 'string' as const }] }],
      },
      {
        name: 'test',
        subcommands: [
          { name: 'deploy', arguments: [{ name: 'force', type: 'boolean' as const }] },
          { name: 'status', description: 'Show status' },
        ],
      },
    );

    expect(result.subcommands!.length).toBe(2);
    const deploy = result.subcommands!.find((s) => s.name === 'deploy');
    expect(deploy?.arguments?.length).toBe(2);
    expect(deploy?.description).toBe('Deploy app'); // first source's description is preserved
  });

  it('should merge field aliases', () => {
    const result = mergeCommandMeta(
      {
        name: 'test',
        arguments: [{ name: 'verbose', type: 'boolean', aliases: ['-v'] }],
      },
      {
        name: 'test',
        arguments: [{ name: 'verbose', type: 'boolean', aliases: ['--verb'] }],
      },
    );

    const verbose = result.arguments!.find((a) => a.name === 'verbose');
    expect(verbose?.aliases).toEqual(['-v', '--verb']);
  });

  it('should clean up empty arrays', () => {
    const result = mergeCommandMeta({ name: 'test' }, { name: 'test' });

    expect(result.arguments).toBeUndefined();
    expect(result.subcommands).toBeUndefined();
    expect(result.aliases).toBeUndefined();
  });
});
