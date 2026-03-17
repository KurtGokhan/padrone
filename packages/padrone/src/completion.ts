import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractSchemaMetadata } from './args.ts';
import type { AnyPadroneCommand } from './types.ts';

export type ShellType = 'bash' | 'zsh' | 'fish' | 'powershell';

/**
 * Detects the current shell from environment variables and process info.
 * @returns The detected shell type, or undefined if unknown
 */
export function detectShell(): ShellType | undefined {
  if (typeof process === 'undefined') return undefined;

  // Method 1: Check SHELL environment variable (most common)
  const shellEnv = process.env.SHELL || '';
  if (shellEnv.includes('zsh')) return 'zsh';
  if (shellEnv.includes('bash')) return 'bash';
  if (shellEnv.includes('fish')) return 'fish';

  // Method 2: Check Windows-specific shells
  if (process.env.PSModulePath || process.env.POWERSHELL_DISTRIBUTION_CHANNEL) {
    return 'powershell';
  }

  // Method 3: Check parent process on Unix-like systems
  try {
    const { execSync } = require('node:child_process');
    const ppid = process.ppid;
    if (ppid) {
      const processName = execSync(`ps -p ${ppid} -o comm=`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      if (processName.includes('zsh')) return 'zsh';
      if (processName.includes('bash')) return 'bash';
      if (processName.includes('fish')) return 'fish';
    }
  } catch {
    // Ignore errors (e.g., ps not available)
  }

  return undefined;
}

/**
 * Collects all commands from a program recursively.
 */
function collectAllCommands(cmd: AnyPadroneCommand): AnyPadroneCommand[] {
  const result: AnyPadroneCommand[] = [];

  if (cmd.commands) {
    for (const subcmd of cmd.commands) {
      if (!subcmd.hidden) {
        result.push(subcmd);
        result.push(...collectAllCommands(subcmd));
      }
    }
  }

  return result;
}

/**
 * Extracts all argument names from a command's schema.
 */
function extractArguments(cmd: AnyPadroneCommand): { name: string; alias?: string; isBoolean: boolean }[] {
  const argList: { name: string; alias?: string; isBoolean: boolean }[] = [];

  if (!cmd.argsSchema) return argList;

  try {
    const argsMeta = cmd.meta?.fields;
    const { aliases } = extractSchemaMetadata(cmd.argsSchema, argsMeta);

    // Reverse aliases map (alias -> arg name)
    const aliasToArgument: Record<string, string> = {};
    for (const [arg, alias] of Object.entries(aliases)) {
      aliasToArgument[alias] = arg;
    }

    const jsonSchema = cmd.argsSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;

    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [key, prop] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        const alias = Object.entries(aliases).find(([arg]) => arg === key)?.[1];
        argList.push({
          name: key,
          alias: alias,
          isBoolean: prop?.type === 'boolean',
        });
      }
    }
  } catch {
    // Ignore schema parsing errors
  }

  return argList;
}

/**
 * Generates a Bash completion script for the program.
 */
export function generateBashCompletion(program: AnyPadroneCommand): string {
  const programName = program.name;
  const commands = collectAllCommands(program);
  const commandNames = commands.map((c) => c.name).join(' ');

  // Collect all args from all commands
  const allArguments = new Set<string>();
  allArguments.add('--help');
  allArguments.add('--version');

  for (const cmd of [program, ...commands]) {
    for (const arg of extractArguments(cmd)) {
      allArguments.add(`--${arg.name}`);
      if (arg.alias) allArguments.add(`-${arg.alias}`);
    }
  }

  const argsList = Array.from(allArguments).join(' ');

  return `###-begin-${programName}-completion-###
#
# ${programName} command completion script
#
# Installation: ${programName} completion >> ~/.bashrc  (or ~/.zshrc)
# Or, maybe: ${programName} completion > /usr/local/etc/bash_completion.d/${programName}
#

if type complete &>/dev/null; then
  _${programName}_completion() {
    local cur prev words cword
    if type _get_comp_words_by_ref &>/dev/null; then
      _get_comp_words_by_ref -n = -n @ -n : -w words -i cword
    else
      cword="$COMP_CWORD"
      words=("\${COMP_WORDS[@]}")
    fi

    cur="\${words[cword]}"
    prev="\${words[cword-1]}"

    local commands="${commandNames}"
    local args="${argsList}"

    # Complete args when current word starts with -
    if [[ "$cur" == -* ]]; then
      COMPREPLY=($(compgen -W "$args" -- "$cur"))
      return 0
    fi

    # Complete commands
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
  }
  complete -o bashdefault -o default -o nospace -F _${programName}_completion ${programName}
elif type compdef &>/dev/null; then
  _${programName}_completion() {
    local si=$IFS
    local commands="${commandNames}"
    local args="${argsList}"

    if [[ "\${words[CURRENT]}" == -* ]]; then
      compadd -- \${=args}
    else
      compadd -- \${=commands}
    fi
    IFS=$si
  }
  compdef _${programName}_completion ${programName}
elif type compctl &>/dev/null; then
  _${programName}_completion() {
    local commands="${commandNames}"
    local args="${argsList}"

    if [[ "\${words[CURRENT]}" == -* ]]; then
      reply=(\${=args})
    else
      reply=(\${=commands})
    fi
  }
  compctl -K _${programName}_completion ${programName}
fi
###-end-${programName}-completion-###`;
}

/**
 * Generates a Zsh completion script for the program.
 */
export function generateZshCompletion(program: AnyPadroneCommand): string {
  const programName = program.name;
  const commands = collectAllCommands(program);

  // Generate command completions with descriptions
  const commandCompletions = commands
    .map((cmd) => {
      const desc = cmd.description || cmd.title || '';
      const escapedDesc = desc.replace(/'/g, "'\\''").replace(/:/g, '\\:');
      return `      '${cmd.name}:${escapedDesc}'`;
    })
    .join('\n');

  // Collect all args with descriptions
  const argumentCompletions: string[] = [];
  argumentCompletions.push("      '--help[Show help information]'");
  argumentCompletions.push("      '--version[Show version number]'");

  const seenArgs = new Set<string>(['help', 'version']);

  for (const cmd of [program, ...commands]) {
    for (const arg of extractArguments(cmd)) {
      if (seenArgs.has(arg.name)) continue;
      seenArgs.add(arg.name);

      const desc = cmd.meta?.fields?.[arg.name]?.description || '';
      const escapedDesc = desc.replace(/'/g, "'\\''").replace(/\[/g, '\\[').replace(/\]/g, '\\]');

      if (arg.alias) {
        argumentCompletions.push(`      {-${arg.alias},--${arg.name}}'[${escapedDesc}]'`);
      } else {
        argumentCompletions.push(`      '--${arg.name}[${escapedDesc}]'`);
      }
    }
  }

  return `#compdef ${programName}
###-begin-${programName}-completion-###
#
# ${programName} command completion script for Zsh
#
# Installation: ${programName} completion >> ~/.zshrc
# Or: ${programName} completion > ~/.zsh/completions/_${programName}
#

_${programName}() {
  local -a commands
  local -a args

  commands=(
${commandCompletions}
  )

  args=(
${argumentCompletions.join('\n')}
  )

  _arguments -s \\
    $args \\
    '1: :->command' \\
    '*::arg:->args'

  case "$state" in
    command)
      _describe 'command' commands
      ;;
  esac
}

_${programName}
###-end-${programName}-completion-###`;
}

/**
 * Generates a Fish completion script for the program.
 */
export function generateFishCompletion(program: AnyPadroneCommand): string {
  const programName = program.name;
  const commands = collectAllCommands(program);

  const lines: string[] = [
    `###-begin-${programName}-completion-###`,
    '#',
    `# ${programName} command completion script for Fish`,
    '#',
    `# Installation: ${programName} completion > ~/.config/fish/completions/${programName}.fish`,
    '#',
    '',
    `# Clear existing completions`,
    `complete -c ${programName} -e`,
    '',
    '# Commands',
  ];

  for (const cmd of commands) {
    const desc = cmd.description || cmd.title || '';
    const escapedDesc = desc.replace(/'/g, "\\'");
    lines.push(`complete -c ${programName} -n "__fish_use_subcommand" -a "${cmd.name}" -d '${escapedDesc}'`);
  }

  lines.push('');
  lines.push('# Global arguments');
  lines.push(`complete -c ${programName} -l help -d 'Show help information'`);
  lines.push(`complete -c ${programName} -l version -d 'Show version number'`);

  const seenArgs = new Set<string>(['help', 'version']);

  for (const cmd of [program, ...commands]) {
    for (const arg of extractArguments(cmd)) {
      if (seenArgs.has(arg.name)) continue;
      seenArgs.add(arg.name);

      const desc = cmd.meta?.fields?.[arg.name]?.description || '';
      const escapedDesc = desc.replace(/'/g, "\\'");

      if (arg.alias) {
        lines.push(`complete -c ${programName} -s ${arg.alias} -l ${arg.name} -d '${escapedDesc}'`);
      } else {
        lines.push(`complete -c ${programName} -l ${arg.name} -d '${escapedDesc}'`);
      }
    }
  }

  lines.push(`###-end-${programName}-completion-###`);

  return lines.join('\n');
}

/**
 * Generates a PowerShell completion script for the program.
 */
export function generatePowerShellCompletion(program: AnyPadroneCommand): string {
  const programName = program.name;
  const commands = collectAllCommands(program);

  const commandNames = commands.map((c) => `'${c.name}'`).join(', ');

  return `###-begin-${programName}-completion-###
#
# ${programName} command completion script for PowerShell
#
# Installation: ${programName} completion >> $PROFILE
#

Register-ArgumentCompleter -Native -CommandName ${programName} -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $commands = @(${commandNames})
  $args = @('--help', '--version')

  if ($wordToComplete -like '-*') {
    $args | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  } else {
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
}
###-end-${programName}-completion-###`;
}

/**
 * Generates a completion script for the specified shell.
 */
export function generateCompletion(program: AnyPadroneCommand, shell: ShellType): string {
  switch (shell) {
    case 'bash':
      return generateBashCompletion(program);
    case 'zsh':
      return generateZshCompletion(program);
    case 'fish':
      return generateFishCompletion(program);
    case 'powershell':
      return generatePowerShellCompletion(program);
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

/**
 * Gets the installation instructions for a shell completion script.
 */
export function getCompletionInstallInstructions(programName: string, shell: ShellType): string {
  switch (shell) {
    case 'bash':
      return `# Add to ~/.bashrc:
${programName} completion bash >> ~/.bashrc

# Or install system-wide:
${programName} completion bash > /usr/local/etc/bash_completion.d/${programName}`;

    case 'zsh':
      return `# Add to ~/.zshrc:
${programName} completion zsh >> ~/.zshrc

# Or add to completions directory:
${programName} completion zsh > ~/.zsh/completions/_${programName}`;

    case 'fish':
      return `# Install to Fish completions:
${programName} completion fish > ~/.config/fish/completions/${programName}.fish`;

    case 'powershell':
      return `# Add to PowerShell profile:
${programName} completion powershell >> $PROFILE`;

    default:
      return `# Run: ${programName} completion <shell>
# Supported shells: bash, zsh, fish, powershell`;
  }
}

/**
 * Generates the completion output with automatic shell detection.
 * If shell is not specified, detects the current shell and provides instructions.
 */
export function generateCompletionOutput(program: AnyPadroneCommand, shell?: ShellType): string {
  const programName = program.name;

  if (shell) {
    return generateCompletion(program, shell);
  }

  // Auto-detect shell and provide instructions
  const detectedShell = detectShell();

  if (detectedShell) {
    const instructions = getCompletionInstallInstructions(programName, detectedShell);
    const script = generateCompletion(program, detectedShell);

    return `# Detected shell: ${detectedShell}
#
${instructions}
#
# Or evaluate directly (temporary, for current session only):
# eval "$(${programName} completion ${detectedShell})"

${script}`;
  }

  // Could not detect shell - provide usage info
  return `# Shell auto-detection failed.
#
# Usage: ${programName} completion <shell>
#
# Supported shells:
#   bash       - Bash completion script
#   zsh        - Zsh completion script
#   fish       - Fish completion script
#   powershell - PowerShell completion script
#
# Example:
#   ${programName} completion bash >> ~/.bashrc
#   ${programName} completion zsh >> ~/.zshrc
#   ${programName} completion fish > ~/.config/fish/completions/${programName}.fish
#   ${programName} completion powershell >> $PROFILE`;
}

export interface SetupCompletionsResult {
  /** The file that was written to. */
  file: string;
  /** Whether an existing completion block was replaced (true) or a new one was appended (false). */
  updated: boolean;
}

/**
 * Sets up shell completions by writing an eval snippet to the appropriate shell config file.
 * Uses marker comments for idempotency — re-running replaces the existing block.
 */
export function setupCompletions(programName: string, shell: ShellType): SetupCompletionsResult {
  const home = homedir();
  const beginMarker = `###-begin-${programName}-completion-###`;
  const endMarker = `###-end-${programName}-completion-###`;
  const snippet = buildSetupSnippet(programName, shell, beginMarker, endMarker);

  if (shell === 'fish') {
    const completionsDir = join(home, '.config', 'fish', 'completions');
    const filePath = join(completionsDir, `${programName}.fish`);
    mkdirSync(completionsDir, { recursive: true });
    const existed = existsSync(filePath);
    writeFileSync(filePath, `${snippet}\n`);
    return { file: filePath, updated: existed };
  }

  const rcFile = getRcFile(shell, home);
  if (!rcFile) {
    throw new Error(`Could not determine config file for ${shell}.`);
  }

  const existing = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8') : '';

  if (existing.includes(beginMarker)) {
    const pattern = new RegExp(`${escapeRegExp(beginMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
    writeFileSync(rcFile, existing.replace(pattern, snippet));
    return { file: rcFile, updated: true };
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(rcFile, `${existing}${separator}\n${snippet}\n`);
  return { file: rcFile, updated: false };
}

function buildSetupSnippet(programName: string, shell: ShellType, beginMarker: string, endMarker: string): string {
  const evalCmd = `${programName} completion ${shell}`;

  switch (shell) {
    case 'bash':
    case 'zsh':
      return `${beginMarker}\neval "$(${evalCmd})"\n${endMarker}`;
    case 'fish':
      return `${beginMarker}\n${evalCmd} | source\n${endMarker}`;
    case 'powershell':
      return `${beginMarker}\n${evalCmd} | Invoke-Expression\n${endMarker}`;
  }
}

function getRcFile(shell: ShellType, home: string): string | null {
  switch (shell) {
    case 'bash':
      return join(home, '.bashrc');
    case 'zsh':
      return join(home, '.zshrc');
    case 'powershell':
      return process.env.PROFILE || join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    default:
      return null;
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
