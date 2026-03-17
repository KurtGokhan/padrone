import { describe, expect, it } from 'bun:test';
import { parseFishCompletions } from 'padrone/codegen';

describe('parseFishCompletions', () => {
  it('should parse basic fish completions', () => {
    const text = `
complete -c mycli -s v -l verbose -d 'Enable verbose output'
complete -c mycli -s o -l output -r -d 'Output file'
complete -c mycli -l dry-run -d 'Preview only'
`;

    const result = parseFishCompletions(text);

    expect(result.name).toBe('mycli');
    expect(result.arguments).toBeDefined();
    expect(result.arguments!.length).toBe(3);

    const verbose = result.arguments!.find((a) => a.name === 'verbose');
    expect(verbose?.type).toBe('boolean');
    expect(verbose?.description).toBe('Enable verbose output');

    const output = result.arguments!.find((a) => a.name === 'output');
    expect(output?.type).toBe('string');

    const dryRun = result.arguments!.find((a) => a.name === 'dryRun');
    expect(dryRun?.type).toBe('boolean');
  });

  it('should parse subcommand completions', () => {
    const text = `
complete -c mycli -f -n '__fish_use_subcommand' -a 'init' -d 'Initialize project'
complete -c mycli -f -n '__fish_use_subcommand' -a 'build' -d 'Build project'
complete -c mycli -f -n '__fish_seen_subcommand_from init' -l template -r -d 'Template name'
`;

    const result = parseFishCompletions(text);

    expect(result.subcommands).toBeDefined();
    expect(result.subcommands!.length).toBe(2);

    const init = result.subcommands!.find((s) => s.name === 'init');
    expect(init?.description).toBe('Initialize project');
    expect(init?.arguments).toBeDefined();
    expect(init?.arguments?.length).toBe(1);
    expect(init?.arguments?.[0]?.name).toBe('template');
  });

  it('should parse enum completions with -a values', () => {
    const text = `
complete -c mycli -l format -r -a 'json yaml toml' -d 'Output format'
`;

    const result = parseFishCompletions(text);

    const format = result.arguments!.find((a) => a.name === 'format');
    expect(format?.type).toBe('enum');
    expect(format?.enumValues).toEqual(['json', 'yaml', 'toml']);
  });

  it('should skip comment lines', () => {
    const text = `
# My CLI completions
complete -c mycli -l help -d 'Show help'
# End of completions
`;

    const result = parseFishCompletions(text);
    expect(result.arguments!.length).toBe(1);
  });

  it('should handle empty input', () => {
    const result = parseFishCompletions('');
    expect(result.name).toBe('');
    expect(result.arguments).toBeUndefined();
  });
});
