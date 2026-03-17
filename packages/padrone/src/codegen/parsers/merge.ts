import type { CommandMeta, FieldMeta } from '../types.ts';

/**
 * Deep-merge multiple CommandMeta from different sources.
 * Deduplicates fields, resolves conflicts, and combines subcommands.
 *
 * Later sources take precedence for descriptions and types,
 * unless the earlier source was more specific (non-ambiguous).
 */
export function mergeCommandMeta(...sources: CommandMeta[]): CommandMeta {
  if (sources.length === 0) {
    return { name: '' };
  }

  if (sources.length === 1) {
    return sources[0]!;
  }

  const result: CommandMeta = { name: '' };

  for (const source of sources) {
    // Name: first non-empty wins
    if (source.name && !result.name) {
      result.name = source.name;
    }

    // Description: last non-empty wins
    if (source.description) {
      result.description = source.description;
    }

    // Aliases: merge and deduplicate
    if (source.aliases) {
      result.aliases = [...new Set([...(result.aliases || []), ...source.aliases])];
    }

    // Examples: merge and deduplicate
    if (source.examples) {
      result.examples = [...new Set([...(result.examples || []), ...source.examples])];
    }

    // Deprecated: last truthy wins
    if (source.deprecated !== undefined) {
      result.deprecated = source.deprecated;
    }

    // Arguments: merge by name
    if (source.arguments) {
      result.arguments = mergeFields(result.arguments || [], source.arguments);
    }

    // Positionals: merge by name
    if (source.positionals) {
      result.positionals = mergeFields(result.positionals || [], source.positionals);
    }

    // Subcommands: merge recursively by name
    if (source.subcommands) {
      result.subcommands = mergeSubcommands(result.subcommands || [], source.subcommands);
    }
  }

  // Clean up empty arrays
  if (result.aliases?.length === 0) delete result.aliases;
  if (result.examples?.length === 0) delete result.examples;
  if (result.arguments?.length === 0) delete result.arguments;
  if (result.positionals?.length === 0) delete result.positionals;
  if (result.subcommands?.length === 0) delete result.subcommands;

  return result;
}

/**
 * Merge two arrays of FieldMeta by name.
 * Later fields take precedence unless earlier was non-ambiguous.
 */
function mergeFields(existing: FieldMeta[], incoming: FieldMeta[]): FieldMeta[] {
  const map = new Map<string, FieldMeta>();

  for (const field of existing) {
    map.set(field.name, { ...field });
  }

  for (const field of incoming) {
    const prev = map.get(field.name);
    if (!prev) {
      map.set(field.name, { ...field });
      continue;
    }

    // Merge the fields
    const merged: FieldMeta = { ...prev };

    // Type: prefer non-ambiguous source
    if (field.type !== 'unknown') {
      if (prev.ambiguous || !field.ambiguous) {
        merged.type = field.type;
        merged.ambiguous = field.ambiguous;
      }
    }

    // Description: last non-empty wins
    if (field.description) {
      merged.description = field.description;
    }

    // Default: last non-undefined wins
    if (field.default !== undefined) {
      merged.default = field.default;
    }

    // Required: last defined wins
    if (field.required !== undefined) {
      merged.required = field.required;
    }

    // Aliases: merge and deduplicate
    if (field.aliases) {
      merged.aliases = [...new Set([...(prev.aliases || []), ...field.aliases])];
    }

    // Enum values: merge and deduplicate
    if (field.enumValues) {
      merged.enumValues = [...new Set([...(prev.enumValues || []), ...field.enumValues])];
    }

    // Items: last non-empty wins
    if (field.items) {
      merged.items = field.items;
    }

    map.set(field.name, merged);
  }

  return [...map.values()];
}

/**
 * Merge two arrays of CommandMeta by name, recursively.
 */
function mergeSubcommands(existing: CommandMeta[], incoming: CommandMeta[]): CommandMeta[] {
  const map = new Map<string, CommandMeta>();

  for (const cmd of existing) {
    map.set(cmd.name, cmd);
  }

  for (const cmd of incoming) {
    const prev = map.get(cmd.name);
    if (!prev) {
      map.set(cmd.name, cmd);
    } else {
      map.set(cmd.name, mergeCommandMeta(prev, cmd));
    }
  }

  return [...map.values()];
}
