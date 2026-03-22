import { parseBashCompletions } from './parsers/bash.ts';
import { parseFishCompletions } from './parsers/fish.ts';
import { parseHelpOutput } from './parsers/help.ts';
import { mergeCommandMeta } from './parsers/merge.ts';
import { parseZshCompletions } from './parsers/zsh.ts';
import type { CommandMeta, GeneratorLogger } from './types.ts';

export type DiscoverySource = 'help' | 'completion' | 'bash' | 'fish' | 'zsh';

export interface DiscoveryOptions {
  /** The command to discover (e.g. 'gh', 'docker', 'kubectl'). */
  command: string;
  /**
   * Which parsing sources to use. Default: ['help'].
   * Use `'completion'` to auto-detect the best shell completion source
   * by probing `<cmd> completion <shell>` (bash → fish → zsh).
   */
  sources?: DiscoverySource[];
  /** Max subcommand depth. 0 = root only, undefined = unlimited. */
  depth?: number;
  /** Delay in ms between help invocations. Default: 50 */
  delay?: number;
  /** Logger for progress reporting. */
  log?: GeneratorLogger;
  /** Timeout per help invocation in ms. Default: 10000 */
  timeout?: number;
}

export interface DiscoveryResult {
  /** The discovered command tree. */
  command: CommandMeta;
  /** Number of help invocations made. */
  invocations: number;
  /** Errors encountered (non-fatal). */
  warnings: string[];
}

/**
 * Discover CLI structure by running --help recursively and optionally
 * parsing shell completion scripts.
 */
export async function discoverCli(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { command, sources: rawSources = ['help'], depth, delay = 50, log, timeout = 10000 } = options;

  // Resolve 'completion' source by probing for the best available shell
  const sources = await resolveSources(rawSources, command, timeout, log);

  const warnings: string[] = [];
  let invocations = 0;

  const results: CommandMeta[] = [];

  // Source 1: --help recursive crawl
  if (sources.includes('help')) {
    log?.info(`Discovering ${command} via --help...`);
    const helpResult = await crawlHelp(command, [], {
      depth,
      delay,
      timeout,
      log,
      onInvocation: () => {
        invocations++;
      },
      onWarning: (msg) => {
        warnings.push(msg);
      },
    });
    results.push(helpResult);
  }

  // Source 2: Bash completions
  if (sources.includes('bash')) {
    log?.info(`Parsing bash completions for ${command}...`);
    const bashText = await getCompletionScript(command, 'bash', timeout);
    if (bashText) {
      results.push(parseBashCompletions(bashText));
    } else {
      warnings.push('Could not obtain bash completion script');
    }
  }

  // Source 3: Fish completions
  if (sources.includes('fish')) {
    log?.info(`Parsing fish completions for ${command}...`);
    const fishText = await getCompletionScript(command, 'fish', timeout);
    if (fishText) {
      results.push(parseFishCompletions(fishText));
    } else {
      warnings.push('Could not obtain fish completion script');
    }
  }

  // Source 4: Zsh completions
  if (sources.includes('zsh')) {
    log?.info(`Parsing zsh completions for ${command}...`);
    const zshText = await getCompletionScript(command, 'zsh', timeout);
    if (zshText) {
      results.push(parseZshCompletions(zshText));
    } else {
      warnings.push('Could not obtain zsh completion script');
    }
  }

  const merged = results.length > 0 ? mergeCommandMeta(...results) : { name: command };

  // Ensure the root has the correct name
  if (!merged.name) merged.name = command;

  return { command: merged, invocations, warnings };
}

interface CrawlOptions {
  depth?: number;
  delay: number;
  timeout: number;
  log?: GeneratorLogger;
  onInvocation: () => void;
  onWarning: (msg: string) => void;
}

/**
 * Breadth-first crawl of --help output.
 */
async function crawlHelp(command: string, prefixArgs: string[], options: CrawlOptions): Promise<CommandMeta> {
  const fullCmd = [command, ...prefixArgs].join(' ');

  options.onInvocation();
  const helpText = await runHelp(command, prefixArgs, options.timeout);

  if (!helpText) {
    options.onWarning(`No help output from: ${fullCmd} --help`);
    return { name: prefixArgs[prefixArgs.length - 1] || command };
  }

  const name = prefixArgs[prefixArgs.length - 1] || command;
  const parsed = parseHelpOutput(helpText, { name });

  options.log?.info(`  ${fullCmd}: ${parsed.subcommands?.length || 0} subcommands, ${parsed.arguments?.length || 0} options`);

  // Recurse into subcommands breadth-first
  const currentDepth = prefixArgs.length;
  if (parsed.subcommands && parsed.subcommands.length > 0 && (options.depth === undefined || currentDepth < options.depth)) {
    const resolvedSubs: CommandMeta[] = [];

    for (const sub of parsed.subcommands) {
      if (options.delay > 0) {
        await sleep(options.delay);
      }
      const resolved = await crawlHelp(command, [...prefixArgs, sub.name], options);
      // Preserve description from parent's subcommand list if child didn't have one
      if (!resolved.description && sub.description) {
        resolved.description = sub.description;
      }
      resolvedSubs.push(resolved);
    }

    parsed.subcommands = resolvedSubs;
  }

  return parsed;
}

/**
 * Run `<cmd> --help` or `<cmd> help` and return combined stdout+stderr.
 */
async function runHelp(command: string, args: string[], timeout: number): Promise<string | null> {
  // Try --help first
  let result = await runCommand(command, [...args, '--help'], timeout);
  if (result) return result;

  // Some CLIs use `help <cmd>` instead
  if (args.length > 0) {
    result = await runCommand(command, ['help', ...args], timeout);
    if (result) return result;
  }

  return null;
}

/**
 * Run a command and return its combined output, or null on failure.
 */
async function runCommand(command: string, args: string[], timeout: number): Promise<string | null> {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });

    const timer = setTimeout(() => proc.kill(), timeout);

    const [_exitCode, stdoutBuf, stderrBuf] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).arrayBuffer(),
    ]);

    clearTimeout(timer);

    const stdout = new TextDecoder().decode(stdoutBuf).trim();
    const stderr = new TextDecoder().decode(stderrBuf).trim();

    // Some CLIs output help to stderr, some exit non-zero on --help
    const combined = stdout || stderr;
    if (!combined) return null;

    // Basic sanity check: help text usually has some structure
    if (combined.length < 10) return null;

    return combined;
  } catch {
    return null;
  }
}

/**
 * Try to get a shell completion script for a command.
 * Checks both `<cmd> completion <shell>` and well-known file paths.
 */
async function getCompletionScript(command: string, shell: 'bash' | 'fish' | 'zsh', timeout: number): Promise<string | null> {
  // Try `<cmd> completion <shell>`
  const completionArgs = ['completion', shell];
  let result = await runCommand(command, completionArgs, timeout);
  if (result) return result;

  // Try `<cmd> completions <shell>`
  result = await runCommand(command, ['completions', shell], timeout);
  if (result) return result;

  // Try reading from well-known paths
  const paths =
    shell === 'fish'
      ? [`/usr/share/fish/vendor_completions.d/${command}.fish`, `/usr/local/share/fish/vendor_completions.d/${command}.fish`]
      : shell === 'bash'
        ? [
            `/usr/share/bash-completion/completions/${command}`,
            `/usr/local/share/bash-completion/completions/${command}`,
            `/etc/bash_completion.d/${command}`,
          ]
        : [`/usr/share/zsh/site-functions/_${command}`, `/usr/local/share/zsh/site-functions/_${command}`];

  for (const path of paths) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        return await file.text();
      }
    } catch {}
  }

  return null;
}

/**
 * Detect the best shell for completion parsing by probing the command.
 * Tries `<cmd> completion <shell>` for bash, fish, zsh (in that order).
 * Returns the shell name if successful, or null if no completion command exists.
 */
export async function detectCompletionShell(command: string, timeout = 5000): Promise<'bash' | 'fish' | 'zsh' | null> {
  for (const shell of ['bash', 'fish', 'zsh'] as const) {
    const result = await getCompletionScript(command, shell, timeout);
    if (result) return shell;
  }
  return null;
}

/**
 * Resolve 'completion' entries in the sources array by probing for the best available shell.
 * Other sources are passed through unchanged.
 */
async function resolveSources(
  sources: DiscoverySource[],
  command: string,
  timeout: number,
  log?: GeneratorLogger,
): Promise<DiscoverySource[]> {
  if (!sources.includes('completion')) return sources;

  log?.info(`Probing ${command} for completion command...`);
  const shell = await detectCompletionShell(command, timeout);

  return sources.flatMap((s) => {
    if (s !== 'completion') return s;
    if (shell) {
      log?.info(`  Found ${shell} completion support`);
      return shell;
    }
    log?.info('  No completion command found, skipping');
    return [];
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
