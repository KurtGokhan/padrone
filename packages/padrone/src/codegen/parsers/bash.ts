import type { CommandMeta, FieldMeta } from '../types.ts';

/**
 * Parse bash completion scripts into CommandMeta.
 *
 * Bash completions typically use `complete -F <func> <command>` and define
 * a function that sets COMPREPLY. Common patterns:
 *
 *   local commands="init build deploy"
 *   local args="--verbose --output --format"
 *   case "$prev" in --format) COMPREPLY=($(compgen -W "json yaml toml" ...)) ;;
 *   COMPREPLY=($(compgen -W "$commands" ...))
 *   COMPREPLY=($(compgen -W "$args" ...))
 */
export function parseBashCompletions(text: string): CommandMeta {
  const result: CommandMeta = {
    name: '',
    arguments: [],
    subcommands: [],
  };

  // Detect command name from `complete -F _func <command>` or `complete -o ... -F _func <command>`
  const completeMatch = text.match(/complete\s+(?:[^-]|-[^F])*-F\s+\S+\s+(\S+)/);
  if (completeMatch) {
    result.name = completeMatch[1]!;
  }

  // Fallback: detect from marker comments like ###-begin-<name>-completion-###
  if (!result.name) {
    const markerMatch = text.match(/###-begin-(\S+)-completion-###/);
    if (markerMatch) {
      result.name = markerMatch[1]!;
    }
  }

  // Join continuation lines for easier parsing
  const joined = text.replace(/\\\n\s*/g, ' ');

  // Collect variable values: local commands="..." or local args="..."
  const variables = extractVariables(joined);

  // Extract subcommand names from commands variable or compgen -W "cmd1 cmd2"
  const commandWords = variables.get('commands') ?? variables.get('cmds') ?? variables.get('subcommands');
  if (commandWords) {
    for (const name of splitWords(commandWords)) {
      result.subcommands!.push({ name });
    }
  }

  // Extract option names from args/opts/options variable
  const argWords = variables.get('args') ?? variables.get('opts') ?? variables.get('options') ?? variables.get('flags');
  const optionNames = new Set<string>();

  if (argWords) {
    for (const word of splitWords(argWords)) {
      if (word.startsWith('-')) {
        optionNames.add(word);
      }
    }
  }

  // Also scan for compgen -W patterns not tied to a case statement
  const compgenRegex = /compgen\s+-W\s+["']([^"']+)["']/g;
  let compgenMatch: RegExpExecArray | null;
  while ((compgenMatch = compgenRegex.exec(joined)) !== null) {
    // Skip variable references like $args, $commands
    if (compgenMatch[1]!.startsWith('$')) continue;
    for (const word of splitWords(compgenMatch[1]!)) {
      if (word.startsWith('-')) {
        optionNames.add(word);
      }
    }
  }

  // Parse case statement for option value completions (enum detection)
  const enumMap = parseCaseStatement(joined);

  // Build argument fields
  const seenArgs = new Set<string>();

  for (const rawName of optionNames) {
    // Skip builtins
    if (rawName === '--help' || rawName === '-h' || rawName === '--version' || rawName === '-V') continue;

    const name = rawName.replace(/^-+/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (!name || seenArgs.has(name)) continue;
    seenArgs.add(name);

    // Check if this option has enum values from case statement
    const enumValues = enumMap.get(rawName);

    const isShort = rawName.startsWith('-') && !rawName.startsWith('--') && rawName.length === 2;
    const field: FieldMeta = {
      name,
      type: enumValues ? 'enum' : 'string',
      enumValues,
      ambiguous: !enumValues,
    };

    // If there's a corresponding long-form, record alias
    if (isShort) {
      field.aliases = [rawName];
    }

    result.arguments!.push(field);
  }

  if (result.arguments!.length === 0) delete result.arguments;
  if (result.subcommands!.length === 0) delete result.subcommands;

  return result;
}

/**
 * Extract variable assignments: `local VAR="value"`, `VAR="value"`, `local VAR='value'`
 */
function extractVariables(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  const regex = /(?:local\s+)?(\w+)=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    vars.set(match[1]!, match[2]!);
  }

  return vars;
}

/**
 * Parse case statements to find option → enum value mappings.
 *
 * Matches patterns like:
 *   case "$prev" in
 *     --format) COMPREPLY=($(compgen -W "json yaml toml" ...)) ;;
 *     --env|--environment) COMPREPLY=($(compgen -W "dev staging prod" ...)) ;;
 */
function parseCaseStatement(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // Find case blocks on $prev or similar variables
  const caseRegex = /case\s+[^i]*\bin\b\s*([\s\S]*?)esac/g;
  let caseMatch: RegExpExecArray | null;

  while ((caseMatch = caseRegex.exec(text)) !== null) {
    const body = caseMatch[1]!;

    // Split into branches by ;; delimiter
    const branches = body.split(';;');
    for (const branch of branches) {
      // Match pattern: --opt1|--opt2) ... compgen -W "values" ...
      const patternMatch = branch.match(/^\s*([-\w|]+)\)/);
      if (!patternMatch) continue;

      // Find compgen -W "values" within this branch
      const compgenMatch = branch.match(/compgen\s+-W\s+["']([^"']+)["']/);
      if (!compgenMatch) continue;

      const values = compgenMatch[1]!;
      const words = splitWords(values).filter((w) => !w.startsWith('$'));
      if (words.length === 0) continue;

      for (const pattern of patternMatch[1]!.split('|')) {
        const trimmed = pattern.trim();
        if (trimmed.startsWith('-')) {
          result.set(trimmed, words);
        }
      }
    }
  }

  return result;
}

/**
 * Split a space-separated word list, filtering empty strings.
 */
function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
