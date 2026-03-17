import type { CommandMeta, FieldMeta } from '../types.ts';

/**
 * Parse zsh completion function definitions into CommandMeta.
 *
 * Zsh completions typically use _arguments or compadd:
 *   _arguments \
 *     '-v[verbose mode]' \
 *     '--output=[output file]:filename:_files' \
 *     '1:command:(start stop restart)'
 */
export function parseZshCompletions(text: string): CommandMeta {
  const result: CommandMeta = {
    name: '',
    arguments: [],
    positionals: [],
    subcommands: [],
  };

  // Try to detect command name from function name: _command() or #compdef command
  const compdefMatch = text.match(/#compdef\s+(\S+)/);
  if (compdefMatch) {
    result.name = compdefMatch[1]!;
  } else {
    const funcMatch = text.match(/^_(\w+)\s*\(\)/m);
    if (funcMatch) {
      result.name = funcMatch[1]!;
    }
  }

  // Find _arguments blocks
  const argumentsBlocks = findArgumentsBlocks(text);

  for (const block of argumentsBlocks) {
    const specs = parseArgumentSpecs(block);
    for (const spec of specs) {
      if (spec.positional) {
        result.positionals!.push(spec);
      } else {
        result.arguments!.push(spec);
      }
    }
  }

  // Find subcommand definitions from case statements or _describe
  const subcommands = findSubcommands(text);
  result.subcommands!.push(...subcommands);

  if (result.arguments!.length === 0) delete result.arguments;
  if (result.positionals!.length === 0) delete result.positionals;
  if (result.subcommands!.length === 0) delete result.subcommands;

  return result;
}

/**
 * Extract _arguments blocks from zsh completion text.
 * Handles backslash continuation lines.
 */
function findArgumentsBlocks(text: string): string[] {
  const blocks: string[] = [];

  // Join continuation lines
  const joined = text.replace(/\\\n\s*/g, ' ');
  const lines = joined.split('\n');

  for (const line of lines) {
    const match = line.match(/_arguments\s+(.+)/);
    if (match) {
      blocks.push(match[1]!);
    }
  }

  return blocks;
}

/**
 * Parse individual argument specs from an _arguments line.
 */
function parseArgumentSpecs(block: string): FieldMeta[] {
  const results: FieldMeta[] = [];

  // Split into individual specs (quoted strings)
  const specs = extractQuotedStrings(block);

  for (const spec of specs) {
    const field = parseZshSpec(spec);
    if (field) results.push(field);
  }

  return results;
}

/**
 * Extract single-quoted strings from an _arguments block.
 */
function extractQuotedStrings(text: string): string[] {
  const strings: string[] = [];
  const regex = /'([^']+)'/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    strings.push(match[1]!);
  }

  return strings;
}

/**
 * Parse a single zsh argument spec.
 *
 * Formats:
 *   '-v[verbose mode]'                              → boolean flag
 *   '--output=[output file]:filename:_files'         → string with value
 *   '(-v --verbose)'{-v,--verbose}'[verbose mode]'   → flag with aliases
 *   '*--flag[repeatable]'                            → array
 *   '1:command:(start stop restart)'                 → positional enum
 *   ':filename:_files'                               → positional
 */
function parseZshSpec(spec: string): FieldMeta | null {
  // Positional argument: 'N:description:action' or ':description:action'
  const positionalMatch = spec.match(/^(\d+)?:([^:]*):(.*)$/);
  if (positionalMatch) {
    const description = positionalMatch[2] || undefined;

    // Check for enum values in (val1 val2 val3)
    const enumMatch = positionalMatch[3]?.match(/^\(([^)]+)\)$/);
    if (enumMatch) {
      const values = enumMatch[1]!.split(/\s+/);
      return {
        name: description?.toLowerCase().replace(/\s+/g, '_') || `arg${positionalMatch[1] || '0'}`,
        type: 'enum',
        enumValues: values,
        description,
        positional: true,
      };
    }

    return {
      name: description?.toLowerCase().replace(/\s+/g, '_') || `arg${positionalMatch[1] || '0'}`,
      type: 'string',
      description,
      positional: true,
      ambiguous: true,
    };
  }

  // Flag argument
  const repeatable = spec.startsWith('*');
  const flagSpec = repeatable ? spec.slice(1) : spec;

  // Extract flag name and description
  // Pattern: --flag=[description]:value_description:action
  // Pattern: -f[description]
  const flagMatch = flagSpec.match(/^(-{1,2}[\w-]+)(?:=?)(?:\[([^\]]*)\])?(?::([^:]*):?(.*))?$/);
  if (!flagMatch) return null;

  const rawName = flagMatch[1]!;
  const description = flagMatch[2] || undefined;
  const valueName = flagMatch[3] || undefined;

  const name = rawName.replace(/^-+/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const hasValue = rawName.includes('=') || !!valueName;
  let type: FieldMeta['type'] = hasValue ? 'string' : 'boolean';

  if (repeatable) type = 'array';

  // Check for enum values
  let enumValues: string[] | undefined;
  if (flagMatch[4]) {
    const enumMatch = flagMatch[4].match(/^\(([^)]+)\)$/);
    if (enumMatch) {
      enumValues = enumMatch[1]!.split(/\s+/);
      type = 'enum';
    }
  }

  return {
    name,
    type,
    description,
    enumValues,
  };
}

/**
 * Find subcommand definitions from _describe calls or case statements.
 */
function findSubcommands(text: string): CommandMeta[] {
  const subcommands: CommandMeta[] = [];
  const seen = new Set<string>();

  // Look for _describe patterns: _describe 'command' commands
  // where commands is an array like: ('start:start the service' 'stop:stop the service')
  const describeRegex = /\(([^)]+)\)/g;
  const joined = text.replace(/\\\n\s*/g, ' ');

  // Look for arrays of 'name:description' patterns near _describe
  let match: RegExpExecArray | null;
  while ((match = describeRegex.exec(joined)) !== null) {
    const content = match[1]!;
    const entries = content.match(/'([^']+)'/g) || content.match(/"([^"]+)"/g);
    if (!entries) continue;

    for (const entry of entries) {
      const clean = entry.replace(/^['"]|['"]$/g, '');
      const parts = clean.split(':');
      if (parts.length >= 2 && /^[\w-]+$/.test(parts[0]!)) {
        const name = parts[0]!;
        if (seen.has(name)) continue;
        seen.add(name);
        subcommands.push({
          name,
          description: parts.slice(1).join(':'),
        });
      }
    }
  }

  return subcommands;
}
