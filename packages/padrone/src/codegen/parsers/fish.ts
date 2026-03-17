import type { CommandMeta, FieldMeta } from '../types.ts';

/**
 * Parse fish shell completion scripts into CommandMeta.
 *
 * Fish completions use the `complete` builtin:
 *   complete -c <command> -s <short> -l <long> -d <description> -a <arguments> -r -f
 */
export function parseFishCompletions(text: string): CommandMeta {
  const lines = text.split('\n');
  const result: CommandMeta = {
    name: '',
    arguments: [],
    subcommands: [],
  };

  const subcommandMap = new Map<string, CommandMeta>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match: complete -c <command> [options]
    const completeMatch = trimmed.match(/^complete\s+/);
    if (!completeMatch) continue;

    const parts = parseCompleteLine(trimmed);
    if (!parts) continue;

    // Set root command name
    if (!result.name && parts.command) {
      result.name = parts.command;
    }

    // If this completion has a condition like "__fish_seen_subcommand_from <sub>"
    // it belongs to a subcommand
    const subcommandCondition = parts.condition?.match(/__fish_seen_subcommand_from\s+(\S+)/);
    if (subcommandCondition) {
      const subName = subcommandCondition[1]!;
      let sub = subcommandMap.get(subName);
      if (!sub) {
        sub = { name: subName, arguments: [] };
        subcommandMap.set(subName, sub);
      }

      if (parts.longFlag || parts.shortFlag) {
        const field = completionToField(parts);
        if (field) sub.arguments!.push(field);
      }
      continue;
    }

    // If this defines a subcommand (has -a with no flags)
    if (parts.arguments && !parts.longFlag && !parts.shortFlag) {
      // Arguments list could be subcommand names
      const names = parts.arguments.split(/\s+/);
      for (const name of names) {
        if (!name || name.startsWith('(')) continue;
        if (!subcommandMap.has(name)) {
          subcommandMap.set(name, {
            name,
            description: parts.description,
            arguments: [],
          });
        } else if (parts.description) {
          subcommandMap.get(name)!.description = parts.description;
        }
      }
      continue;
    }

    // Global option
    if (parts.longFlag || parts.shortFlag) {
      const field = completionToField(parts);
      if (field) result.arguments!.push(field);
    }
  }

  // Add subcommands
  for (const sub of subcommandMap.values()) {
    if (sub.arguments!.length === 0) delete sub.arguments;
    result.subcommands!.push(sub);
  }

  if (result.arguments!.length === 0) delete result.arguments;
  if (result.subcommands!.length === 0) delete result.subcommands;

  return result;
}

interface CompleteParts {
  command?: string;
  shortFlag?: string;
  longFlag?: string;
  description?: string;
  arguments?: string;
  condition?: string;
  requiresArg?: boolean;
  noFiles?: boolean;
}

function parseCompleteLine(line: string): CompleteParts | null {
  const parts: CompleteParts = {};

  // Extract -c <command>
  const cmdMatch = line.match(/-c\s+(\S+)/);
  if (cmdMatch) parts.command = cmdMatch[1];

  // Extract -s <short>
  const shortMatch = line.match(/-s\s+(\S+)/);
  if (shortMatch) parts.shortFlag = shortMatch[1];

  // Extract -l <long>
  const longMatch = line.match(/-l\s+(\S+)/);
  if (longMatch) parts.longFlag = longMatch[1];

  // Extract -d '<description>' or -d "<description>"
  const descMatch = line.match(/-d\s+['"]([^'"]+)['"]/) || line.match(/-d\s+(\S+)/);
  if (descMatch) parts.description = descMatch[1];

  // Extract -a '<arguments>'
  const argsMatch = line.match(/-a\s+['"]([^'"]+)['"]/) || line.match(/-a\s+(\S+)/);
  if (argsMatch) parts.arguments = argsMatch[1];

  // Extract -n '<condition>'
  const condMatch = line.match(/-n\s+['"]([^'"]+)['"]/) || line.match(/-n\s+(\S+)/);
  if (condMatch) parts.condition = condMatch[1];

  // -r means requires argument
  parts.requiresArg = /-r\b/.test(line);
  // -f means no file completion
  parts.noFiles = /-f\b/.test(line);

  return parts;
}

function completionToField(parts: CompleteParts): FieldMeta | null {
  const name = parts.longFlag ? parts.longFlag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : parts.shortFlag || '';

  if (!name) return null;

  let type: FieldMeta['type'] = parts.requiresArg ? 'string' : 'boolean';
  let enumValues: string[] | undefined;

  // If -a provides specific values, treat as enum
  if (parts.arguments) {
    const values = parts.arguments.split(/\s+/).filter((v) => !v.startsWith('('));
    if (values.length > 0 && values.length <= 20) {
      enumValues = values;
      type = 'enum';
    }
  }

  const aliases = parts.shortFlag && parts.longFlag ? [`-${parts.shortFlag}`] : undefined;

  return {
    name,
    type,
    description: parts.description,
    aliases,
    enumValues,
  };
}
