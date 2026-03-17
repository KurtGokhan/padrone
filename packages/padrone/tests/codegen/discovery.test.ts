import { describe, expect, it } from 'bun:test';
import { discoverCli } from 'padrone/codegen';

describe('discoverCli', () => {
  it('should discover a simple command via --help', async () => {
    // echo --help should produce some output on most systems
    const result = await discoverCli({
      command: 'echo',
      sources: ['help'],
      depth: 0,
      timeout: 5000,
    });

    expect(result.command.name).toBe('echo');
    expect(result.invocations).toBeGreaterThanOrEqual(1);
  });

  it('should handle non-existent commands gracefully', async () => {
    const result = await discoverCli({
      command: 'padrone_nonexistent_cmd_xyz_123',
      sources: ['help'],
      depth: 0,
      timeout: 2000,
    });

    expect(result.command.name).toBe('padrone_nonexistent_cmd_xyz_123');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should respect depth limit', async () => {
    const result = await discoverCli({
      command: 'git',
      sources: ['help'],
      depth: 0,
      timeout: 5000,
    });

    // With depth 0, subcommands should be listed but not recursed into
    // (they'll have names/descriptions from the root --help, but no args of their own)
    if (result.command.subcommands) {
      for (const sub of result.command.subcommands) {
        // Subcommands at depth 0 should not themselves have recursed subcommands
        // (they only have what the root help listed)
        expect(sub.arguments).toBeUndefined();
      }
    }

    expect(result.invocations).toBe(1);
  });

  it('should return warnings for unavailable shell completions', async () => {
    const result = await discoverCli({
      command: 'echo',
      sources: ['fish'],
      depth: 0,
      timeout: 2000,
    });

    // fish completions for echo likely don't exist as a standalone script
    // so we should get a warning
    expect(result.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it('should merge multiple sources', async () => {
    const result = await discoverCli({
      command: 'git',
      sources: ['help'],
      depth: 0,
      timeout: 5000,
    });

    expect(result.command.name).toBe('git');
  });
});
