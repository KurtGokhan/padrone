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
