import { describe, expect, it } from 'bun:test';
import { createWeatherProgram } from './common';

describe('help', () => {
  const program = createWeatherProgram();

  it('should generate help for the program', () => {
    const help = program.help(undefined, { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for the top level command', () => {
    const help = program.help('', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command', () => {
    const help = program.help('current', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with enabled colors', () => {
    const help = program.help('current', { colorize: true });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with nested commands', () => {
    const help = program.help('forecast extended', { colorize: false });
    expect(help).toMatchSnapshot();
  });
});
