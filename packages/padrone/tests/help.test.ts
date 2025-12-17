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
