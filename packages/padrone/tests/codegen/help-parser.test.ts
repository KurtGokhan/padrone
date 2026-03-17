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

describe('parseHelpOutput — gh CLI style', () => {
  it('should parse gh root help with categorized command sections', () => {
    const help = `Work seamlessly with GitHub from the command line.

USAGE
  gh <command> <subcommand> [flags]

CORE COMMANDS
  auth:          Authenticate gh and git with GitHub
  browse:        Open repositories, issues, pull requests, and more in the browser
  codespace:     Connect to and manage codespaces
  issue:         Manage issues
  pr:            Manage pull requests
  repo:          Manage repositories

GITHUB ACTIONS COMMANDS
  cache:         Manage GitHub Actions caches
  run:           View details about workflow runs
  workflow:      View details about GitHub Actions workflows

ALIAS COMMANDS
  co:            Alias for "pr checkout"

ADDITIONAL COMMANDS
  alias:         Create command shortcuts
  api:           Make an authenticated GitHub API request
  completion:    Generate shell completion scripts
  config:        Manage configuration for gh
  extension:     Manage gh extensions
  search:        Search for repositories, issues, and pull requests
  secret:        Manage GitHub secrets

HELP TOPICS
  accessibility: Learn about GitHub CLI's accessibility experiences
  actions:       Learn about working with GitHub Actions
  environment:   Environment variables that can be used with gh

FLAGS
  --help      Show help for command
  --version   Show gh version

EXAMPLES
  $ gh issue create
  $ gh repo clone cli/cli
  $ gh pr checkout 321

LEARN MORE
  Use \`gh <command> <subcommand> --help\` for more information about a command.
  Read the manual at https://cli.github.com/manual
`;

    const result = parseHelpOutput(help, { name: 'gh' });

    expect(result.name).toBe('gh');
    expect(result.description).toBe('Work seamlessly with GitHub from the command line.');

    // Should find commands from all command sections (CORE, GITHUB ACTIONS, ADDITIONAL)
    // but NOT from HELP TOPICS or ALIAS COMMANDS
    expect(result.subcommands).toBeDefined();
    const names = result.subcommands!.map((c) => c.name);

    // Core commands
    expect(names).toContain('auth');
    expect(names).toContain('pr');
    expect(names).toContain('repo');

    // GitHub Actions commands
    expect(names).toContain('cache');
    expect(names).toContain('run');
    expect(names).toContain('workflow');

    // Additional commands
    expect(names).toContain('alias');
    expect(names).toContain('api');
    expect(names).toContain('search');

    // HELP TOPICS should NOT be parsed as commands
    expect(names).not.toContain('accessibility');
    expect(names).not.toContain('actions');
    expect(names).not.toContain('environment');

    // Descriptions should be clean (no colon artifact)
    const pr = result.subcommands!.find((c) => c.name === 'pr');
    expect(pr?.description).toBe('Manage pull requests');

    // FLAGS should be parsed
    expect(result.arguments).toBeDefined();
    const help2 = result.arguments!.find((a) => a.name === 'help');
    expect(help2?.type).toBe('boolean');

    const version = result.arguments!.find((a) => a.name === 'version');
    expect(version?.type).toBe('boolean');
  });

  it('should parse gh subcommand help with categorized commands', () => {
    const help = `Work with GitHub pull requests.

USAGE
  gh pr <command> [flags]

GENERAL COMMANDS
  create:        Create a pull request
  list:          List pull requests in a repository
  status:        Show status of relevant pull requests

TARGETED COMMANDS
  checkout:      Check out a pull request in git
  close:         Close a pull request
  diff:          View changes in a pull request
  merge:         Merge a pull request
  view:          View a pull request

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh pr checkout 353
  $ gh pr create --fill

LEARN MORE
  Use \`gh <command> <subcommand> --help\` for more information about a command.
`;

    const result = parseHelpOutput(help, { name: 'pr' });

    expect(result.description).toBe('Work with GitHub pull requests.');

    // Both GENERAL and TARGETED sections should be parsed
    const names = result.subcommands!.map((c) => c.name);
    expect(names).toContain('create');
    expect(names).toContain('list');
    expect(names).toContain('checkout');
    expect(names).toContain('merge');
    expect(names).toContain('view');

    // FLAGS + INHERITED FLAGS should both be parsed
    expect(result.arguments).toBeDefined();
    const repo = result.arguments!.find((a) => a.name === 'repo');
    expect(repo).toBeDefined();
    expect(repo?.aliases).toEqual(['-R']);

    const helpFlag = result.arguments!.find((a) => a.name === 'help');
    expect(helpFlag?.type).toBe('boolean');
  });

  it('should parse gh leaf command help with cobra-style typed flags', () => {
    const help = `List pull requests in a GitHub repository.

USAGE
  gh pr list [flags]

ALIASES
  gh pr ls

FLAGS
      --app string        Filter by GitHub App author
  -a, --assignee string   Filter by assignee
  -A, --author string     Filter by author
  -B, --base string       Filter by base branch
  -d, --draft             Filter by draft state
  -q, --jq expression     Filter JSON output using a jq expression
      --json fields       Output JSON with the specified fields
  -l, --label strings     Filter by label
  -L, --limit int         Maximum number of items to fetch (default 30)
  -S, --search query      Search pull requests with query
  -s, --state string      Filter by state: {open|closed|merged|all} (default "open")
  -t, --template string   Format JSON output using a Go template; see "gh help formatting"
  -w, --web               List pull requests in the web browser

INHERITED FLAGS
      --help                     Show help for command
  -R, --repo [HOST/]OWNER/REPO   Select another repository using the [HOST/]OWNER/REPO format

JSON FIELDS
  additions, assignees, author, baseRefName, body, comments, commits

EXAMPLES
  $ gh pr list --author "@me"

LEARN MORE
  Use \`gh <command> <subcommand> --help\` for more information about a command.
`;

    const result = parseHelpOutput(help, { name: 'list' });

    expect(result.description).toBe('List pull requests in a GitHub repository.');

    // Should not have subcommands
    expect(result.subcommands).toBeUndefined();

    // Should parse all flags
    expect(result.arguments).toBeDefined();

    // Cobra-style typed flags
    const app = result.arguments!.find((a) => a.name === 'app');
    expect(app?.type).toBe('string');
    expect(app?.aliases).toBeUndefined(); // no short flag

    const assignee = result.arguments!.find((a) => a.name === 'assignee');
    expect(assignee?.type).toBe('string');
    expect(assignee?.aliases).toEqual(['-a']);

    const draft = result.arguments!.find((a) => a.name === 'draft');
    expect(draft?.type).toBe('boolean');
    expect(draft?.aliases).toEqual(['-d']);

    const jq = result.arguments!.find((a) => a.name === 'jq');
    expect(jq?.type).toBe('string');

    const json = result.arguments!.find((a) => a.name === 'json');
    expect(json?.type).toBe('array');

    const label = result.arguments!.find((a) => a.name === 'label');
    expect(label?.type).toBe('array');
    expect(label?.aliases).toEqual(['-l']);

    const limit = result.arguments!.find((a) => a.name === 'limit');
    expect(limit?.type).toBe('number');
    expect(limit?.default).toBe(30);
    expect(limit?.aliases).toEqual(['-L']);

    // Inline enum: {open|closed|merged|all}
    const state = result.arguments!.find((a) => a.name === 'state');
    expect(state?.type).toBe('enum');
    expect(state?.enumValues).toEqual(['open', 'closed', 'merged', 'all']);
    expect(state?.default).toBe('open');

    const web = result.arguments!.find((a) => a.name === 'web');
    expect(web?.type).toBe('boolean');
    expect(web?.aliases).toEqual(['-w']);

    // INHERITED FLAGS should also be parsed
    const helpFlag = result.arguments!.find((a) => a.name === 'help');
    expect(helpFlag?.type).toBe('boolean');

    // ALIASES should be extracted
    expect(result.aliases).toBeDefined();
    expect(result.aliases).toContain('ls');

    // JSON FIELDS section should be skipped (not treated as commands or args)
    const names = (result.subcommands || []).map((c) => c.name);
    expect(names).not.toContain('additions');
  });

  it('should not parse HELP TOPICS entries as commands', () => {
    const help = `CORE COMMANDS
  auth:          Authenticate

HELP TOPICS
  accessibility: Learn about accessibility
  actions:       Learn about GitHub Actions
`;

    const result = parseHelpOutput(help, { name: 'gh' });

    const names = result.subcommands!.map((c) => c.name);
    expect(names).toContain('auth');
    expect(names).not.toContain('accessibility');
    expect(names).not.toContain('actions');
  });

  it('should not parse EXAMPLES lines as commands or options', () => {
    const help = `FLAGS
  --verbose      Enable verbose mode

EXAMPLES
  $ gh issue create
  $ gh repo clone cli/cli
`;

    const result = parseHelpOutput(help, { name: 'test' });

    expect(result.arguments!.length).toBe(1);
    expect(result.arguments![0]!.name).toBe('verbose');
    expect(result.subcommands).toBeUndefined();
  });

  it('should handle colon-suffixed command names', () => {
    const help = `COMMANDS
  init:         Initialize a project
  build:        Build the project
  deploy        Deploy to production
`;

    const result = parseHelpOutput(help, { name: 'tool' });

    expect(result.subcommands!.length).toBe(3);
    // Colons should be stripped from names
    expect(result.subcommands![0]!.name).toBe('init');
    expect(result.subcommands![1]!.name).toBe('build');
    expect(result.subcommands![2]!.name).toBe('deploy');
  });
});
