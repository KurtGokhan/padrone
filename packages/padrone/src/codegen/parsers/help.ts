import type { CommandMeta, FieldMeta } from '../types.ts';

interface ParseHelpOptions {
  /** Name to use for the root command if not detected from the help text */
  name?: string;
}

type Section = 'none' | 'usage' | 'commands' | 'options' | 'arguments' | 'positional' | 'aliases' | 'skip';

/**
 * Parse --help text output into CommandMeta.
 * Handles common styles: GNU coreutils, Go cobra, Python argparse, Node commander/yargs, gh CLI.
 */
export function parseHelpOutput(text: string, options?: ParseHelpOptions): CommandMeta {
  const lines = text.split('\n');
  const result: CommandMeta = {
    name: options?.name || '',
    arguments: [],
    positionals: [],
    subcommands: [],
  };

  let section: Section = 'none';

  // Try to extract name from USAGE line
  // Matches: "Usage: mycli", "USAGE\n  gh <command>", "Usage:\n  myapp deploy [flags]"
  const usageMatch = text.match(/^[Uu](?:SAGE|sage):?\s*(\S+)/m) || text.match(/^USAGE\n\s+(\S+)/m);
  if (usageMatch && !result.name) {
    result.name = usageMatch[1]!;
  }

  // Extract description from lines before first section header
  const descriptionLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (descriptionLines.length > 0) break;
      continue;
    }
    if (isSectionHeader(trimmed)) break;
    if (descriptionLines.length === 0 || descriptionLines.length > 0) {
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

    // Parse content based on current section
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
      case 'aliases': {
        const aliasMatch = trimmed.match(/^\S+(?:\s+\S+)*$/);
        if (aliasMatch) {
          // Extract alias from lines like "gh pr ls" — the last word is the alias name
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const alias = parts[parts.length - 1]!;
            if (!result.aliases) result.aliases = [];
            result.aliases.push(alias);
          }
        }
        break;
      }
      // 'skip', 'usage', 'none' — do nothing
    }
  }

  // Clean up empty arrays
  if (result.arguments!.length === 0) delete result.arguments;
  if (result.positionals!.length === 0) delete result.positionals;
  if (result.subcommands!.length === 0) delete result.subcommands;
  if (result.aliases?.length === 0) delete result.aliases;

  return result;
}

function isSectionHeader(line: string): boolean {
  // "USAGE", "FLAGS", "CORE COMMANDS", "Options:", "Available Commands:"
  return /^[A-Z][A-Za-z\s]*:?\s*$/i.test(line) || /^[A-Z][A-Z\s]+$/i.test(line);
}

function detectSection(line: string): Section | null {
  const lower = line.toLowerCase().replace(/:$/, '').trim();

  // Commands: "commands", "available commands", "subcommands",
  // and gh-style: "core commands", "general commands", "additional commands", etc.
  // Match anything ending in "commands" or "subcommands", but NOT "alias commands"
  if (/^(?:available\s+)?(?:commands|subcommands)$/.test(lower)) return 'commands';
  if (/^(?:\w+\s+)*commands$/.test(lower) && !/alias/.test(lower)) return 'commands';

  // Options/Flags: "options", "flags", "global options", "inherited flags"
  if (/^(?:global\s+|inherited\s+)?(?:options|flags)$/.test(lower)) return 'options';

  // Positional arguments
  if (/^(?:positional\s+)?(?:arguments|args|positionals)$/.test(lower)) return 'positional';

  // Aliases section
  if (/^alias(?:es)?(?:\s+commands)?$/.test(lower)) return 'aliases';

  // Usage section
  if (lower === 'usage') return 'usage';

  // Sections to skip entirely
  if (/^(?:help\s+topics|examples?|learn\s+more|json\s+fields|see\s+also|notes?)$/.test(lower)) return 'skip';

  return null;
}

function parseCommandLine(line: string): CommandMeta | null {
  // Pattern: "  command-name:    Description text" (gh-style with colon)
  const colonMatch = line.match(/^\s{2,}([\w][\w-]*):?\s{2,}(.+)$/);
  if (colonMatch) {
    const name = colonMatch[1]!.replace(/:$/, '');
    return {
      name,
      description: colonMatch[2]!.trim(),
    };
  }

  // Pattern: "  command-name"  (no description)
  const nameOnly = line.match(/^\s{2,}([\w][\w-]*):?\s*$/);
  if (nameOnly) {
    return { name: nameOnly[1]!.replace(/:$/, '') };
  }

  return null;
}

function parseOptionLine(line: string): FieldMeta | null {
  // Try cobra-style first: "  -s, --flag type    Description" or "      --flag type    Description"
  // The type hint can be a bare word (string, int) or a complex placeholder ([HOST/]OWNER/REPO)
  // but NOT angle-bracket values like <string> (those fall through to GNU pattern)
  const cobraMatch = line.match(/^\s{2,}(?:(-\w),\s+)?(-{1,2}[\w-]+)(?:\s+([^\s<>]+))?\s{2,}(.+)$/);

  if (cobraMatch) {
    const shortFlag = cobraMatch[1];
    const longFlag = cobraMatch[2]!;
    const typeHint = cobraMatch[3];
    const description = cobraMatch[4]?.trim();

    const name = normalizeOptionName(longFlag);
    const aliases = shortFlag ? [normalizeAlias(shortFlag)] : undefined;

    const { type, ambiguous } = resolveType(typeHint);

    const { defaultValue, resolvedType } = extractDefault(description, type, ambiguous);
    const { enumValues, resolvedType: finalType } = extractEnum(description, resolvedType);

    return reconcileField({
      name,
      type: finalType,
      description,
      required: type === 'boolean' ? undefined : true,
      aliases,
      default: defaultValue,
      enumValues,
      ambiguous: ambiguous || undefined,
    });
  }

  // GNU/argparse-style: "  -s, --long-name <value>    Description"
  //                      "  --long-name=<value>        Description"
  const gnuMatch = line.match(/^\s{2,}(?:(-\w),?\s+)?(-{1,2}[\w-]+)(?:\s*[=\s]\s*(?:<([^>]+)>|\[([^\]]+)\]|(\w+)))?\s{2,}(.+)$/);

  if (gnuMatch) {
    const shortFlag = gnuMatch[1];
    const longFlag = gnuMatch[2]!;
    const valueName = gnuMatch[3] || gnuMatch[4] || gnuMatch[5];
    const description = gnuMatch[6]?.trim();

    const name = normalizeOptionName(longFlag);
    const aliases = shortFlag ? [normalizeAlias(shortFlag)] : undefined;

    const { type, ambiguous } = resolveType(valueName);

    const { defaultValue, resolvedType } = extractDefault(description, type, ambiguous);
    const { enumValues, resolvedType: finalType } = extractEnum(description, resolvedType);

    // [value] means optional, <value> means required
    const required = !gnuMatch[4];

    return reconcileField({
      name,
      type: finalType,
      description,
      required: finalType === 'boolean' ? undefined : required,
      aliases,
      default: defaultValue,
      enumValues,
      ambiguous: ambiguous || undefined,
    });
  }

  // Simplest pattern: "  --name    Description"
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

/**
 * Resolve a type hint string to a FieldMeta type.
 */
function resolveType(hint: string | undefined): { type: FieldMeta['type']; ambiguous: boolean } {
  if (!hint) return { type: 'boolean', ambiguous: false };

  const lower = hint.toLowerCase();

  if (/^(num|number|int|integer|port|count|float|duration)$/.test(lower)) {
    return { type: 'number', ambiguous: false };
  }
  if (/^(str|string|text|name|path|file|dir|url|host|query|expression|template)$/.test(lower)) {
    return { type: 'string', ambiguous: false };
  }
  if (/^(bool|boolean)$/.test(lower)) {
    return { type: 'boolean', ambiguous: false };
  }
  if (/^(strings|fields)$/.test(lower)) {
    return { type: 'array', ambiguous: false };
  }

  // Unknown type hint — default to string but mark ambiguous
  return { type: 'string', ambiguous: true };
}

/**
 * Extract default value from description text.
 */
function extractDefault(
  description: string | undefined,
  type: FieldMeta['type'],
  ambiguous: boolean,
): { defaultValue: unknown; resolvedType: FieldMeta['type'] } {
  let resolvedType = type;
  let defaultValue: unknown;

  const defaultMatch = description?.match(/\(default[:\s]+([^)]+)\)/i) || description?.match(/\[default[:\s]+([^\]]+)\]/i);
  if (defaultMatch) {
    const raw = defaultMatch[1]!.trim();
    if (raw === 'true' || raw === 'false') {
      defaultValue = raw === 'true';
      resolvedType = 'boolean';
    } else if (/^\d+$/.test(raw)) {
      defaultValue = parseInt(raw, 10);
      if (resolvedType === 'string' && !ambiguous) resolvedType = 'number';
    } else if (/^\d+\.\d+$/.test(raw)) {
      defaultValue = parseFloat(raw);
      if (resolvedType === 'string' && !ambiguous) resolvedType = 'number';
    } else {
      defaultValue = raw.replace(/^["']|["']$/g, '');
    }
  }

  return { defaultValue, resolvedType };
}

/**
 * Extract enum values from description text.
 */
function extractEnum(
  description: string | undefined,
  type: FieldMeta['type'],
): { enumValues: string[] | undefined; resolvedType: FieldMeta['type'] } {
  // Explicit choices: (choices: a, b, c) or (one of: a|b|c)
  const choiceMatch = description?.match(/\((?:one of|choices?)[:\s]+([^)]+)\)/i);
  if (choiceMatch) {
    const values = choiceMatch[1]!.split(/[,|]/).map((v) => v.trim().replace(/^["']|["']$/g, ''));
    return { enumValues: values, resolvedType: 'enum' };
  }

  // Inline enum in description: {open|closed|merged|all} (gh-style)
  const inlineMatch = description?.match(/\{(\w+(?:\|[\w-]+)+)\}/);
  if (inlineMatch) {
    const values = inlineMatch[1]!.split('|');
    return { enumValues: values, resolvedType: 'enum' };
  }

  return { enumValues: undefined, resolvedType: type };
}

/**
 * Fix up a parsed field for edge cases:
 * - Enum default not in the listed values → add it
 * - Default value type doesn't match declared type → reset to type default + mark ambiguous
 */
function reconcileField(field: FieldMeta): FieldMeta {
  // If enum has a default that isn't in the value list, add it
  if (field.type === 'enum' && field.enumValues && field.default !== undefined) {
    const defStr = String(field.default);
    if (!field.enumValues.includes(defStr)) {
      field.enumValues = [...field.enumValues, defStr];
    }
  }

  // If the default value doesn't match the declared type, reset + mark ambiguous
  if (field.default !== undefined) {
    if (field.type === 'boolean' && typeof field.default !== 'boolean') {
      field.default = false;
      field.ambiguous = true;
    } else if (field.type === 'number' && typeof field.default !== 'number') {
      field.default = 0;
      field.ambiguous = true;
    }
  }

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
    ambiguous: true,
  };
}

/**
 * Strip leading dashes from a flag name, preserving kebab-case.
 */
function normalizeOptionName(flag: string): string {
  return flag.replace(/^-+/, '');
}

/**
 * Strip leading dash from a short alias flag (e.g. '-v' → 'v').
 */
function normalizeAlias(alias: string): string {
  return alias.replace(/^-/, '');
}
