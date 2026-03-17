import { describe, expect, it } from 'bun:test';
import { parseHelpOutput } from 'padrone/codegen';

describe('parseHelpOutput', () => {
  it('should parse basic GNU-style help', () => {
    const help = `Usage: mycli [options] [command]

Options:
  -v, --verbose            Enable verbose output
  -o, --output <file>      Output file path
  -p, --port <number>      Port number (default: 3000)
  -h, --help               Show help

Commands:
  init          Initialize a new project
  build         Build the project
  deploy        Deploy to production
`;

    const result = parseHelpOutput(help);

    expect(result.name).toBe('mycli');
    expect(result.arguments).toBeDefined();
    expect(result.arguments!.length).toBe(4);

    const verbose = result.arguments!.find((a) => a.name === 'verbose');
    expect(verbose?.type).toBe('boolean');
    expect(verbose?.aliases).toEqual(['-v']);

    const output = result.arguments!.find((a) => a.name === 'output');
    expect(output?.type).toBe('string');

    const port = result.arguments!.find((a) => a.name === 'port');
    expect(port?.type).toBe('number');
    expect(port?.default).toBe(3000);

    expect(result.subcommands).toBeDefined();
    expect(result.subcommands!.length).toBe(3);
    expect(result.subcommands![0]!.name).toBe('init');
    expect(result.subcommands![0]!.description).toBe('Initialize a new project');
  });

  it('should parse cobra-style help', () => {
    const help = `Deploy application to cloud

Usage:
  myapp deploy [flags]

Flags:
  -e, --env <string>       Target environment
  -f, --force              Force deploy
  --dry-run                Preview without deploying

Available Commands:
  preview       Preview deployment changes
  rollback      Rollback to previous version
`;

    const result = parseHelpOutput(help);

    expect(result.arguments).toBeDefined();

    const env = result.arguments!.find((a) => a.name === 'env');
    expect(env?.type).toBe('string');
    expect(env?.aliases).toEqual(['-e']);

    const force = result.arguments!.find((a) => a.name === 'force');
    expect(force?.type).toBe('boolean');

    const dryRun = result.arguments!.find((a) => a.name === 'dryRun');
    expect(dryRun?.type).toBe('boolean');

    expect(result.subcommands!.length).toBe(2);
  });

  it('should detect enum values from description', () => {
    const help = `Usage: tool [options]

Options:
  --format <type>      Output format (choices: json, yaml, toml)
`;

    const result = parseHelpOutput(help);

    const format = result.arguments!.find((a) => a.name === 'format');
    expect(format?.type).toBe('enum');
    expect(format?.enumValues).toEqual(['json', 'yaml', 'toml']);
  });

  it('should detect default values', () => {
    const help = `Usage: tool [options]

Options:
  --timeout <ms>       Request timeout (default: 5000)
  --retries <n>        Number of retries [default: 3]
  --color              Colorize output (default: true)
`;

    const result = parseHelpOutput(help);

    const timeout = result.arguments!.find((a) => a.name === 'timeout');
    expect(timeout?.default).toBe(5000);

    const retries = result.arguments!.find((a) => a.name === 'retries');
    expect(retries?.default).toBe(3);

    const color = result.arguments!.find((a) => a.name === 'color');
    expect(color?.default).toBe(true);
    expect(color?.type).toBe('boolean');
  });

  it('should parse positional arguments', () => {
    const help = `Usage: tool <command> [args]

Arguments:
  source      Source file path
  dest        Destination path
`;

    const result = parseHelpOutput(help);

    expect(result.positionals).toBeDefined();
    expect(result.positionals!.length).toBe(2);
    expect(result.positionals![0]!.name).toBe('source');
    expect(result.positionals![0]!.positional).toBe(true);
  });

  it('should use provided name', () => {
    const help = `Some tool description

Options:
  --verbose      Enable verbose mode
`;

    const result = parseHelpOutput(help, { name: 'my-tool' });
    expect(result.name).toBe('my-tool');
  });

  it('should convert kebab-case to camelCase', () => {
    const help = `Usage: tool [options]

Options:
  --dry-run              Preview only
  --no-color             Disable colors
  --max-retries <n>      Max retry count
`;

    const result = parseHelpOutput(help);

    expect(result.arguments!.some((a) => a.name === 'dryRun')).toBe(true);
    expect(result.arguments!.some((a) => a.name === 'noColor')).toBe(true);
    expect(result.arguments!.some((a) => a.name === 'maxRetries')).toBe(true);
  });

  it('should handle empty help text', () => {
    const result = parseHelpOutput('');
    expect(result.name).toBe('');
    expect(result.arguments).toBeUndefined();
    expect(result.subcommands).toBeUndefined();
  });
});
