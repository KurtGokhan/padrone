import { describe, expect, it } from 'bun:test';
import type { HelpInfo } from 'padrone';
import { createTasksProgram } from './common.ts';

describe('help', () => {
  const program = createTasksProgram();

  it('should generate help for the program', () => {
    const help = program.help(undefined, { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for the top level command', () => {
    const help = program.help('', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command', () => {
    const help = program.help('show', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with enabled colors', () => {
    const help = program.help('show', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with nested commands', () => {
    const help = program.help('list extended', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with meta object', () => {
    const help = program.help('tags', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with deprecated arguments', () => {
    const help = program.help('deprecated-test', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with deprecated arguments and colors', () => {
    const help = program.help('deprecated-test', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with hidden arguments', () => {
    const help = program.help('hidden-test', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with hidden arguments and colors', () => {
    const help = program.help('hidden-test', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with examples', () => {
    const help = program.help('examples-test', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with examples and colors', () => {
    const help = program.help('examples-test', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in console format', () => {
    const help = program.help('show', { format: 'console' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in markdown format', () => {
    const help = program.help('show', { format: 'markdown' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in html format', () => {
    const help = program.help('show', { format: 'html' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in json format', () => {
    const help = program.help('show', { format: 'json' });
    expect(help).toMatchSnapshot();
  });
});

describe('help with full detail mode', () => {
  const program = createTasksProgram();

  it('should generate full help with all nested commands in text format', () => {
    const help = program.help(undefined, { format: 'text', detail: 'full' });
    expect(help).toMatchSnapshot();
  });

  it('should generate full help with all nested commands in json format', () => {
    const help = program.help(undefined, { format: 'json', detail: 'full' });
    expect(help).toMatchSnapshot();
  });

  it('should generate full help with all nested commands in markdown format', () => {
    const help = program.help(undefined, { format: 'markdown', detail: 'full' });
    expect(help).toMatchSnapshot();
  });

  it('should generate full help for a specific command with subcommands', () => {
    const help = program.help('list', { format: 'text', detail: 'full' });
    expect(help).toMatchSnapshot();
  });

  it('should generate full help for deeply nested commands', () => {
    const help = program.help('list extended', { format: 'text', detail: 'full' });
    expect(help).toMatchSnapshot();
  });

  it('should generate full help in json format for deeply nested commands', () => {
    const help = program.help('list', { format: 'json', detail: 'full' });
    const parsed = JSON.parse(help);

    // Verify structure contains nested commands
    expect(parsed.nestedCommands).toBeDefined();
    expect(parsed.nestedCommands.length).toBe(1);
    expect(parsed.nestedCommands[0].name).toBe('list extended');
    expect(parsed.nestedCommands[0].nestedCommands).toBeDefined();
    expect(parsed.nestedCommands[0].nestedCommands[0].name).toBe('list extended extended');
  });

  it('should not include nested commands in standard detail mode', () => {
    const help = program.help('list', { format: 'json', detail: 'standard' });
    const parsed = JSON.parse(help) as HelpInfo;

    // Standard mode should not have nestedCommands
    expect(parsed.nestedCommands).toBeUndefined();
    // But should still have subcommands list
    expect(parsed.subcommands).toBeDefined();
  });

  it('should work with ansi format in full detail mode', () => {
    const help = program.help('list', { format: 'ansi', detail: 'full' });
    expect(help).toMatchSnapshot();
  });
});

describe('help with minimal detail mode', () => {
  const program = createTasksProgram();

  it('should generate minimal usage for root command', () => {
    const help = program.help(undefined, { detail: 'minimal' });
    expect(help).toBe('padrone-test [command]');
  });

  it('should generate minimal usage for command with args and arguments', () => {
    const help = program.help('show', { detail: 'minimal' });
    expect(help).toBe('padrone-test show [args...] [arguments]');
  });

  it('should generate minimal usage for command with subcommands', () => {
    const help = program.help('list', { detail: 'minimal' });
    expect(help).toBe('padrone-test list [command] [arguments]');
  });

  it('should generate minimal usage for nested command', () => {
    const help = program.help('list extended', { detail: 'minimal' });
    expect(help).toBe('padrone-test list extended [command] [arguments]');
  });

  it('should generate minimal usage for command with args only (void arguments)', () => {
    const help = program.help('batch', { detail: 'minimal' });
    // batch has variadic args
    expect(help).toBe('padrone-test batch [args...] [arguments]');
  });

  it('should generate minimal usage for command with arguments only (void args)', () => {
    const help = program.help('filter', { detail: 'minimal' });
    // filter has arguments only
    expect(help).toBe('padrone-test filter [arguments]');
  });

  it('should generate minimal usage for noop command (void args and arguments)', () => {
    const help = program.help('noop', { detail: 'minimal' });
    // noop has z.void() for both, which still counts as having schemas
    expect(help).toBe('padrone-test noop');
  });

  it('should ignore format option in minimal mode', () => {
    // Minimal mode should return the same output regardless of format
    const textHelp = program.help('show', { format: 'text', detail: 'minimal' });
    const jsonHelp = program.help('show', { format: 'json', detail: 'minimal' });
    const markdownHelp = program.help('show', { format: 'markdown', detail: 'minimal' });

    expect(textHelp).toBe(jsonHelp);
    expect(jsonHelp).toBe(markdownHelp);
  });
});
