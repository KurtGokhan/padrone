import type { CommandMeta, FieldMeta } from '../types.ts';

interface ParseHelpOptions {
  /** Name to use for the root command if not detected from the help text */
  name?: string;
}

/**
 * Parse --help text output into CommandMeta.
 * Handles common styles: GNU coreutils, Go cobra, Python argparse, Node commander/yargs.
 */
export function parseHelpOutput(text: string, options?: ParseHelpOptions): CommandMeta {
  const lines = text.split('\n');
  const result: CommandMeta = {
    name: options?.name || '',
    arguments: [],
    positionals: [],
    subcommands: [],
  };

  let section: 'none' | 'usage' | 'description' | 'commands' | 'options' | 'arguments' | 'positional' = 'none';

  // Try to extract name and description from the first lines
  const usageMatch = text.match(/^[Uu]sage:\s*(\S+)/m);
  if (usageMatch && !result.name) {
    result.name = usageMatch[1]!;
  }

  // Try to extract description from the first non-empty line before any section
  const descriptionLines: string[] = [];
  let foundSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (descriptionLines.length > 0) break;
      continue;
    }
    if (isSectionHeader(trimmed)) {
      foundSection = true;
      break;
    }
    if (!foundSection && !usageMatch && descriptionLines.length === 0) {
      // First non-empty line could be the description
      descriptionLines.push(trimmed);
    } else if (!foundSection && descriptionLines.length > 0) {
      descriptionLines.push(trimmed);
    }
  }
  if (descriptionLines.length > 0) {
    result.description = descriptionLines.join(' ');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Detect section headers
    const sectionType = detectSection(trimmed);
    if (sectionType) {
      section = sectionType;
      continue;
    }

    // Parse content based on current section (use original line to preserve indentation)
    switch (section) {
      case 'commands': {
        const cmd = parseCommandLine(line);
        if (cmd) {
          result.subcommands!.push(cmd);
        }
        break;
      }
      case 'options': {
        const field = parseOptionLine(line);
        if (field) {
          result.arguments!.push(field);
        }
        break;
      }
      case 'arguments':
      case 'positional': {
        const field = parsePositionalLine(line);
        if (field) {
          result.positionals!.push(field);
        }
        break;
      }
    }
  }

  // Clean up empty arrays
  if (result.arguments!.length === 0) delete result.arguments;
  if (result.positionals!.length === 0) delete result.positionals;
  if (result.subcommands!.length === 0) delete result.subcommands;

  return result;
}

function isSectionHeader(line: string): boolean {
  return /^[A-Z][A-Za-z\s]*:?\s*$/i.test(line) || /^[A-Z][A-Z\s]+$/i.test(line);
}

function detectSection(line: string): 'commands' | 'options' | 'arguments' | 'positional' | null {
  const lower = line.toLowerCase().replace(/:$/, '').trim();

  if (/^(?:available\s+)?(?:commands|subcommands)$/.test(lower)) return 'commands';
  if (/^(?:global\s+)?(?:options|flags)$/.test(lower)) return 'options';
  if (/^(?:positional\s+)?(?:arguments|args|positionals)$/.test(lower)) return 'positional';

  return null;
}

function parseCommandLine(line: string): CommandMeta | null {
  // Pattern: "  command-name    Description text"
  const match = line.match(/^\s{2,}(\S+)\s{2,}(.+)$/);
  if (match) {
    return {
      name: match[1]!,
      description: match[2]!.trim(),
    };
  }

  // Pattern: "  command-name"  (no description)
  const nameOnly = line.match(/^\s{2,}(\S+)\s*$/);
  if (nameOnly) {
    return { name: nameOnly[1]! };
  }

  return null;
}

function parseOptionLine(line: string): FieldMeta | null {
  // Pattern: "  -s, --long-name <value>    Description"
  // Pattern: "  --long-name=<value>        Description"
  // Pattern: "  -b, --boolean              Description"
  const match = line.match(/^\s{2,}(?:(-\w),?\s+)?(-{1,2}[\w-]+)(?:\s*[=\s]\s*(?:<([^>]+)>|\[([^\]]+)\]|(\w+)))?\s{2,}(.+)$/);

  if (!match) {
    // Try simpler pattern: "  --name    Description"
    const simple = line.match(/^\s{2,}(-{1,2}[\w-]+)\s{2,}(.+)$/);
    if (simple) {
      const name = normalizeOptionName(simple[1]!);
      return {
        name,
        type: 'boolean',
        description: simple[2]!.trim(),
      };
    }
    return null;
  }

  const shortFlag = match[1];
  const longFlag = match[2]!;
  const valueName = match[3] || match[4] || match[5];
  const description = match[6]?.trim();

  const name = normalizeOptionName(longFlag);
  const aliases = shortFlag ? [shortFlag] : undefined;

  // Determine type from value placeholder
  let type: FieldMeta['type'] = 'boolean';
  let ambiguous = false;

  if (valueName) {
    const lower = valueName.toLowerCase();
    if (/^(num|number|int|integer|port|count)$/.test(lower)) {
      type = 'number';
    } else if (/^(str|string|text|name|path|file|dir|url|host)$/.test(lower)) {
      type = 'string';
    } else if (/^(bool|boolean)$/.test(lower)) {
      type = 'boolean';
    } else {
      type = 'string';
      ambiguous = true;
    }
  }

  // Check for default values in description
  const defaultMatch = description?.match(/\(default[:\s]+([^)]+)\)/i) || description?.match(/\[default[:\s]+([^\]]+)\]/i);
  let defaultValue: unknown;
  if (defaultMatch) {
    const raw = defaultMatch[1]!.trim();
    if (raw === 'true' || raw === 'false') {
      defaultValue = raw === 'true';
      type = 'boolean';
    } else if (/^\d+$/.test(raw)) {
      defaultValue = parseInt(raw, 10);
      if (type === 'string' && !ambiguous) type = 'number';
    } else if (/^\d+\.\d+$/.test(raw)) {
      defaultValue = parseFloat(raw);
      if (type === 'string' && !ambiguous) type = 'number';
    } else {
      defaultValue = raw.replace(/^["']|["']$/g, '');
    }
  }

  // Check for enum values in description
  const enumMatch = description?.match(/\((?:one of|choices?)[:\s]+([^)]+)\)/i);
  let enumValues: string[] | undefined;
  if (enumMatch) {
    enumValues = enumMatch[1]!.split(/[,|]/).map((v) => v.trim().replace(/^["']|["']$/g, ''));
    type = 'enum';
  }

  // Check if optional from brackets
  const required = !match[4]; // [value] means optional, <value> means required

  const field: FieldMeta = {
    name,
    type,
    description,
    required: type === 'boolean' ? undefined : required,
    aliases,
    default: defaultValue,
    enumValues,
    ambiguous: ambiguous || undefined,
  };

  return field;
}

function parsePositionalLine(line: string): FieldMeta | null {
  // Pattern: "  <name>    Description"
  // Pattern: "  name      Description"
  const match = line.match(/^\s{2,}<?(\w[\w-]*)>?\s{2,}(.+)$/);
  if (!match) return null;

  return {
    name: match[1]!,
    type: 'string',
    description: match[2]!.trim(),
    positional: true,
    ambiguous: true, // We can't always tell the type from help text
  };
}

/**
 * Convert --kebab-case to camelCase.
 */
function normalizeOptionName(flag: string): string {
  // Strip leading dashes
  const name = flag.replace(/^-+/, '');
  // Convert kebab-case to camelCase
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
