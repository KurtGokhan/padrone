import { describe, expect, it } from 'bun:test';
import { createWeatherProgram } from './common';

describe('help', () => {
  const program = createWeatherProgram();

  it('should generate help for the program', () => {
    const help = program.help(undefined, { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for the top level command', () => {
    const help = program.help('', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command', () => {
    const help = program.help('current', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with enabled colors', () => {
    const help = program.help('current', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with nested commands', () => {
    const help = program.help('forecast extended', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with meta object', () => {
    const help = program.help('cities', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with deprecated options', () => {
    const help = program.help('deprecated-test', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with deprecated options and colors', () => {
    const help = program.help('deprecated-test', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with hidden options', () => {
    const help = program.help('hidden-test', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with hidden options and colors', () => {
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
    const help = program.help('current', { format: 'console' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in markdown format', () => {
    const help = program.help('current', { format: 'markdown' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in html format', () => {
    const help = program.help('current', { format: 'html' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in json format', () => {
    const help = program.help('current', { format: 'json' });
    expect(help).toMatchSnapshot();
  });
});

describe('help with full detail mode', () => {
  const program = createWeatherProgram();

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
    const help = program.help('forecast', { format: 'text', detail: 'full' });
    expect(help).toMatchSnapshot();
  });

  it('should generate full help for deeply nested commands', () => {
    const help = program.help('forecast extended', { format: 'text', detail: 'full' });
    expect(help).toMatchSnapshot();
  });

  it('should generate full help in json format for deeply nested commands', () => {
    const help = program.help('forecast', { format: 'json', detail: 'full' });
    const parsed = JSON.parse(help);

    // Verify structure contains nested commands
    expect(parsed.nestedCommands).toBeDefined();
    expect(parsed.nestedCommands.length).toBe(1);
    expect(parsed.nestedCommands[0].name).toBe('forecast extended');
    expect(parsed.nestedCommands[0].nestedCommands).toBeDefined();
    expect(parsed.nestedCommands[0].nestedCommands[0].name).toBe('forecast extended extended');
  });

  it('should not include nested commands in standard detail mode', () => {
    const help = program.help('forecast', { format: 'json', detail: 'standard' });
    const parsed = JSON.parse(help);

    // Standard mode should not have nestedCommands
    expect(parsed.nestedCommands).toBeUndefined();
    // But should still have subcommands list
    expect(parsed.commands).toBeDefined();
  });

  it('should work with ansi format in full detail mode', () => {
    const help = program.help('forecast', { format: 'ansi', detail: 'full' });
    expect(help).toMatchSnapshot();
  });
});

describe('help with minimal detail mode', () => {
  const program = createWeatherProgram();

  it('should generate minimal usage for root command', () => {
    const help = program.help(undefined, { detail: 'minimal' });
    expect(help).toBe('padrone-test [command]');
  });

  it('should generate minimal usage for command with args and options', () => {
    const help = program.help('current', { detail: 'minimal' });
    expect(help).toBe('padrone-test current [args...] [options]');
  });

  it('should generate minimal usage for command with subcommands', () => {
    const help = program.help('forecast', { detail: 'minimal' });
    expect(help).toBe('padrone-test forecast [command] [args...] [options]');
  });

  it('should generate minimal usage for nested command', () => {
    const help = program.help('forecast extended', { detail: 'minimal' });
    expect(help).toBe('padrone-test forecast extended [command] [args...] [options]');
  });

  it('should generate minimal usage for command with args only (void options)', () => {
    const help = program.help('compare', { detail: 'minimal' });
    // compare has z.void() for options, which still counts as having options schema
    expect(help).toBe('padrone-test compare [args...] [options]');
  });

  it('should generate minimal usage for command with options only (void args)', () => {
    const help = program.help('alerts', { detail: 'minimal' });
    // alerts has z.void() for args, which still counts as having args schema
    expect(help).toBe('padrone-test alerts [options]');
  });

  it('should generate minimal usage for noop command (void args and options)', () => {
    const help = program.help('noop', { detail: 'minimal' });
    // noop has z.void() for both, which still counts as having schemas
    expect(help).toBe('padrone-test noop');
  });

  it('should ignore format option in minimal mode', () => {
    // Minimal mode should return the same output regardless of format
    const textHelp = program.help('current', { format: 'text', detail: 'minimal' });
    const jsonHelp = program.help('current', { format: 'json', detail: 'minimal' });
    const markdownHelp = program.help('current', { format: 'markdown', detail: 'minimal' });

    expect(textHelp).toBe(jsonHelp);
    expect(jsonHelp).toBe(markdownHelp);
  });
});
