import { describe, expect, it } from 'bun:test';
import { parseZshCompletions } from 'padrone/codegen';

describe('parseZshCompletions', () => {
  it('should detect command name from #compdef', () => {
    const text = `#compdef mycli

_mycli() {
  _arguments \\
    '-v[verbose mode]' \\
    '--output=[output file]:filename:_files'
}
`;

    const result = parseZshCompletions(text);
    expect(result.name).toBe('mycli');
  });

  it('should parse _arguments specs', () => {
    const text = `#compdef mycli

_mycli() {
  _arguments \\
    '-v[verbose mode]' \\
    '--output=[output file]:filename:_files' \\
    '--format=[output format]:format:(json yaml toml)'
}
`;

    const result = parseZshCompletions(text);

    expect(result.arguments).toBeDefined();

    const verbose = result.arguments!.find((a) => a.name === 'v');
    expect(verbose?.type).toBe('boolean');
    expect(verbose?.description).toBe('verbose mode');

    const output = result.arguments!.find((a) => a.name === 'output');
    expect(output?.type).toBe('string');

    const format = result.arguments!.find((a) => a.name === 'format');
    expect(format?.type).toBe('enum');
    expect(format?.enumValues).toEqual(['json', 'yaml', 'toml']);
  });

  it('should parse positional arguments', () => {
    const text = `#compdef mycli

_mycli() {
  _arguments '1:command:(start stop restart)'
}
`;

    const result = parseZshCompletions(text);

    expect(result.positionals).toBeDefined();
    expect(result.positionals!.length).toBe(1);
    expect(result.positionals![0]!.type).toBe('enum');
    expect(result.positionals![0]!.enumValues).toEqual(['start', 'stop', 'restart']);
  });

  it('should detect function name when no compdef', () => {
    const text = `_myapp() {
  _arguments '--verbose[Enable verbose mode]'
}
`;

    const result = parseZshCompletions(text);
    expect(result.name).toBe('myapp');
  });

  it('should find subcommands from describe patterns', () => {
    const text = `#compdef mycli

_mycli() {
  local -a commands
  commands=(
    'init:Initialize a new project'
    'build:Build the project'
    'deploy:Deploy to production'
  )
  _describe 'command' commands
}
`;

    const result = parseZshCompletions(text);

    expect(result.subcommands).toBeDefined();
    expect(result.subcommands!.length).toBe(3);
    expect(result.subcommands!.find((s) => s.name === 'init')?.description).toBe('Initialize a new project');
  });

  it('should handle empty input', () => {
    const result = parseZshCompletions('');
    expect(result.name).toBe('');
  });
});
