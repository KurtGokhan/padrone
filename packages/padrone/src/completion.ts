import { extractSchemaMetadata } from './options.ts';
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
 * Extracts all option names from a command's schema.
 */
function extractOptions(cmd: AnyPadroneCommand): { name: string; alias?: string; isBoolean: boolean }[] {
  const options: { name: string; alias?: string; isBoolean: boolean }[] = [];

  if (!cmd.options) return options;

  try {
    const optionsMeta = cmd.meta?.options;
    const { aliases } = extractSchemaMetadata(cmd.options, optionsMeta);

    // Reverse aliases map (alias -> option name)
    const aliasToOption: Record<string, string> = {};
    for (const [opt, alias] of Object.entries(aliases)) {
      aliasToOption[alias] = opt;
    }

    const jsonSchema = cmd.options['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Record<string, any>;

    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      for (const [key, prop] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        const alias = Object.entries(aliases).find(([opt]) => opt === key)?.[1];
        options.push({
          name: key,
          alias: alias,
          isBoolean: prop?.type === 'boolean',
        });
      }
    }
  } catch {
    // Ignore schema parsing errors
  }

  return options;
}

/**
 * Generates a Bash completion script for the program.
 */
export function generateBashCompletion(program: AnyPadroneCommand): string {
  const programName = program.name;
  const commands = collectAllCommands(program);
  const commandNames = commands.map((c) => c.name).join(' ');

  // Collect all options from all commands
  const allOptions = new Set<string>();
  allOptions.add('--help');
  allOptions.add('--version');

  for (const cmd of [program, ...commands]) {
    for (const opt of extractOptions(cmd)) {
      allOptions.add(`--${opt.name}`);
      if (opt.alias) allOptions.add(`-${opt.alias}`);
    }
  }

  const optionsList = Array.from(allOptions).join(' ');

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
    local options="${optionsList}"

    # Complete options when current word starts with -
    if [[ "$cur" == -* ]]; then
      COMPREPLY=($(compgen -W "$options" -- "$cur"))
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
    local options="${optionsList}"

    if [[ "\${words[CURRENT]}" == -* ]]; then
      compadd -- \${=options}
    else
      compadd -- \${=commands}
    fi
    IFS=$si
  }
  compdef _${programName}_completion ${programName}
elif type compctl &>/dev/null; then
  _${programName}_completion() {
    local commands="${commandNames}"
    local options="${optionsList}"

    if [[ "\${words[CURRENT]}" == -* ]]; then
      reply=(\${=options})
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

  // Collect all options with descriptions
  const optionCompletions: string[] = [];
  optionCompletions.push("      '--help[Show help information]'");
  optionCompletions.push("      '--version[Show version number]'");

  const seenOptions = new Set<string>(['help', 'version']);

  for (const cmd of [program, ...commands]) {
    for (const opt of extractOptions(cmd)) {
      if (seenOptions.has(opt.name)) continue;
      seenOptions.add(opt.name);

      const desc = cmd.meta?.options?.[opt.name]?.description || '';
      const escapedDesc = desc.replace(/'/g, "'\\''").replace(/\[/g, '\\[').replace(/\]/g, '\\]');

      if (opt.alias) {
        optionCompletions.push(`      {-${opt.alias},--${opt.name}}'[${escapedDesc}]'`);
      } else {
        optionCompletions.push(`      '--${opt.name}[${escapedDesc}]'`);
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
  local -a options

  commands=(
${commandCompletions}
  )

  options=(
${optionCompletions.join('\n')}
  )

  _arguments -s \\
    $options \\
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
  lines.push('# Global options');
  lines.push(`complete -c ${programName} -l help -d 'Show help information'`);
  lines.push(`complete -c ${programName} -l version -d 'Show version number'`);

  const seenOptions = new Set<string>(['help', 'version']);

  for (const cmd of [program, ...commands]) {
    for (const opt of extractOptions(cmd)) {
      if (seenOptions.has(opt.name)) continue;
      seenOptions.add(opt.name);

      const desc = cmd.meta?.options?.[opt.name]?.description || '';
      const escapedDesc = desc.replace(/'/g, "\\'");

      if (opt.alias) {
        lines.push(`complete -c ${programName} -s ${opt.alias} -l ${opt.name} -d '${escapedDesc}'`);
      } else {
        lines.push(`complete -c ${programName} -l ${opt.name} -d '${escapedDesc}'`);
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
  $options = @('--help', '--version')

  if ($wordToComplete -like '-*') {
    $options | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
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
