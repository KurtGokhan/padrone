import { describe, expect, it } from 'bun:test';
import { createWeatherProgram } from './common';

describe('help', () => {
  const program = createWeatherProgram();

  it('should generate help for the program', async () => {
    const help = await program.help(undefined, { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for the top level command', async () => {
    const help = await program.help('', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command', async () => {
    const help = await program.help('current', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with enabled colors', async () => {
    const help = await program.help('current', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with nested commands', async () => {
    const help = await program.help('forecast extended', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with meta object', async () => {
    const help = await program.help('cities', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with deprecated options', async () => {
    const help = await program.help('deprecated-test', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with deprecated options and colors', async () => {
    const help = await program.help('deprecated-test', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with hidden options', async () => {
    const help = await program.help('hidden-test', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with hidden options and colors', async () => {
    const help = await program.help('hidden-test', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with examples', async () => {
    const help = await program.help('examples-test', { format: 'text' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help for a command with examples and colors', async () => {
    const help = await program.help('examples-test', { format: 'ansi' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in console format', async () => {
    const help = await program.help('current', { format: 'console' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in markdown format', async () => {
    const help = await program.help('current', { format: 'markdown' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in html format', async () => {
    const help = await program.help('current', { format: 'html' });
    expect(help).toMatchSnapshot();
  });

  it('should generate help in json format', async () => {
    const help = await program.help('current', { format: 'json' });
    expect(help).toMatchSnapshot();
  });
});
