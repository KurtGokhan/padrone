import { describe, expect, it } from 'bun:test';
import type { HelpInfo } from 'padrone';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
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

  it('should generate help for a command with array enum options', () => {
    const help = program.help('search', { format: 'text' });
    expect(help).toMatchSnapshot();
    // Verify array enum choices are shown
    expect(help).toContain('(choices: pending, in_progress, completed)');
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
    expect(help).toBe('padrone-test show <id> [options]');
  });

  it('should generate minimal usage for command with subcommands', () => {
    const help = program.help('list', { detail: 'minimal' });
    expect(help).toBe('padrone-test list [command] [options]');
  });

  it('should generate minimal usage for nested command', () => {
    const help = program.help('list extended', { detail: 'minimal' });
    expect(help).toBe('padrone-test list extended [command] [options]');
  });

  it('should generate minimal usage for command with args only (void arguments)', () => {
    const help = program.help('batch', { detail: 'minimal' });
    // batch has variadic args
    expect(help).toBe('padrone-test batch <...ids>');
  });

  it('should generate minimal usage for command with arguments only (void args)', () => {
    const help = program.help('filter', { detail: 'minimal' });
    // filter has arguments only
    expect(help).toBe('padrone-test filter [options]');
  });

  it('should generate minimal usage for noop command (void args and arguments)', () => {
    const help = program.help('noop', { detail: 'minimal' });
    // noop has z.void() for both, which still counts as having schemas
    expect(help).toBe('padrone-test noop');
  });

  it('should ignore format in minimal mode', () => {
    // Minimal mode should return the same output regardless of format
    const textHelp = program.help('show', { format: 'text', detail: 'minimal' });
    const jsonHelp = program.help('show', { format: 'json', detail: 'minimal' });
    const markdownHelp = program.help('show', { format: 'markdown', detail: 'minimal' });

    expect(textHelp).toBe(jsonHelp);
    expect(jsonHelp).toBe(markdownHelp);
  });
});

describe('help with groups', () => {
  it('should group options under labeled sections', () => {
    const program = createPadrone('group-test').command('deploy', (c) =>
      c
        .arguments(
          z.object({
            target: z.string().describe('Deploy target'),
            verbose: z.boolean().optional().describe('Verbose output'),
            region: z.string().optional().describe('AWS region'),
            profile: z.string().optional().describe('AWS profile'),
            retries: z.coerce.number().optional().describe('Retry count'),
            timeout: z.coerce.number().optional().describe('Timeout in seconds'),
          }),
          {
            fields: {
              region: { group: 'AWS' },
              profile: { group: 'AWS' },
              retries: { group: 'Advanced' },
              timeout: { group: 'Advanced' },
            },
          },
        )
        .action(),
    );

    const help = program.help('deploy', { format: 'text' });
    expect(help).toMatchSnapshot();

    // Ungrouped options appear under "Options:"
    expect(help).toContain('Options:');
    expect(help).toContain('--target');
    expect(help).toContain('--verbose');

    // Grouped options appear under their group label
    expect(help).toContain('AWS:');
    expect(help).toContain('--region');
    expect(help).toContain('--profile');
    expect(help).toContain('Advanced:');
    expect(help).toContain('--retries');
    expect(help).toContain('--timeout');

    // Verify ordering: Options before AWS before Advanced
    const optionsIdx = help.indexOf('Options:');
    const awsIdx = help.indexOf('AWS:');
    const advancedIdx = help.indexOf('Advanced:');
    expect(optionsIdx).toBeLessThan(awsIdx);
    expect(awsIdx).toBeLessThan(advancedIdx);
  });

  it('should group subcommands under labeled sections', () => {
    const program = createPadrone('group-test')
      .command('init', (c) => c.configure({ title: 'Initialize project' }).action())
      .command('build', (c) => c.configure({ title: 'Build project' }).action())
      .command('deploy', (c) => c.configure({ title: 'Deploy to cloud', group: 'Cloud' }).action())
      .command('logs', (c) => c.configure({ title: 'View cloud logs', group: 'Cloud' }).action())
      .command('lint', (c) => c.configure({ title: 'Run linter', group: 'Quality' }).action())
      .command('test', (c) => c.configure({ title: 'Run tests', group: 'Quality' }).action());

    const help = program.help(undefined, { format: 'text' });
    expect(help).toMatchSnapshot();

    // Ungrouped commands appear under "Commands:"
    expect(help).toContain('Commands:');
    expect(help).toContain('init');
    expect(help).toContain('build');

    // Grouped commands appear under their group label
    expect(help).toContain('Cloud:');
    expect(help).toContain('deploy');
    expect(help).toContain('logs');
    expect(help).toContain('Quality:');
    expect(help).toContain('lint');
    expect(help).toContain('test');

    // Verify ordering
    const commandsIdx = help.indexOf('Commands:');
    const cloudIdx = help.indexOf('Cloud:');
    const qualityIdx = help.indexOf('Quality:');
    expect(commandsIdx).toBeLessThan(cloudIdx);
    expect(cloudIdx).toBeLessThan(qualityIdx);
  });

  it('should include group in JSON help output', () => {
    const program = createPadrone('group-test').command('cmd', (c) =>
      c
        .arguments(
          z.object({
            foo: z.string().optional().describe('Foo option'),
            bar: z.string().optional().describe('Bar option'),
          }),
          {
            fields: {
              bar: { group: 'Extra' },
            },
          },
        )
        .action(),
    );

    const help = program.help('cmd', { format: 'json' });
    const parsed = JSON.parse(help) as HelpInfo;
    expect(parsed.arguments).toBeDefined();
    expect(parsed.arguments!.find((a) => a.name === 'foo')!.group).toBeUndefined();
    expect(parsed.arguments!.find((a) => a.name === 'bar')!.group).toBe('Extra');
  });

  it('should render all options under Options: when no groups are defined', () => {
    const program = createPadrone('group-test').command('cmd', (c) =>
      c
        .arguments(
          z.object({
            foo: z.string().optional().describe('Foo'),
            bar: z.string().optional().describe('Bar'),
          }),
        )
        .action(),
    );

    const help = program.help('cmd', { format: 'text' });
    expect(help).toContain('Options:');
    // Should not have any extra group labels
    const lines = help.split('\n');
    const labelLines = lines.filter((l: string) => l.match(/^\S.*:$/));
    expect(labelLines).toEqual(['Options:']);
  });

  it('should render all commands under group labels when all have groups', () => {
    const program = createPadrone('group-test')
      .command('a', (c) => c.configure({ title: 'A cmd', group: 'Group1' }).action())
      .command('b', (c) => c.configure({ title: 'B cmd', group: 'Group2' }).action());

    const help = program.help(undefined, { format: 'text' });
    // Should not have "Commands:" since all are grouped
    expect(help).not.toContain('Commands:');
    expect(help).toContain('Group1:');
    expect(help).toContain('Group2:');
  });
});
