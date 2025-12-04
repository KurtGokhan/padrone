import { describe, expect, it } from 'bun:test';
import { createWeatherProgram } from './common';

describe('help', () => {
  const program = createWeatherProgram();

  it('should generate help for the program', async () => {
    const help = await program.help(undefined, { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for the top level command', async () => {
    const help = await program.help('', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command', async () => {
    const help = await program.help('current', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with enabled colors', async () => {
    const help = await program.help('current', { colorize: true });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with nested commands', async () => {
    const help = await program.help('forecast extended', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with meta object', async () => {
    const help = await program.help('cities', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with deprecated options', async () => {
    const help = await program.help('deprecated-test', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with deprecated options and colors', async () => {
    const help = await program.help('deprecated-test', { colorize: true });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with hidden options', async () => {
    const help = await program.help('hidden-test', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with hidden options and colors', async () => {
    const help = await program.help('hidden-test', { colorize: true });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with examples', async () => {
    const help = await program.help('examples-test', { colorize: false });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with examples and colors', async () => {
    const help = await program.help('examples-test', { colorize: true });
    expect(help).toMatchSnapshot();
  });
});
