import { resolve } from 'node:path';
import { JSON_SCHEMA_OPTS } from '../args.ts';
import { getCommand, isPadroneProgram } from '../command-utils.ts';
import type { AnyPadroneCommand, PadroneActionContext } from '../types.ts';
import { detectEntry } from './link.ts';

interface DoctorArgs {
  entry?: string;
}

type Severity = 'error' | 'warning';

interface Diagnostic {
  severity: Severity;
  command: string;
  message: string;
}

export async function runDoctor(args: DoctorArgs, _ctx: PadroneActionContext) {
  let entryPath: string;

  if (args.entry) {
    entryPath = resolve(args.entry);
  } else {
    const detected = detectEntry(process.cwd());
    if (!detected) {
      console.error('Could not detect entry point. Provide an entry file or add a "bin" field to package.json.');
      process.exit(1);
    }
    entryPath = detected.entry;
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(entryPath)) as Record<string, unknown>;
  } catch (err) {
    console.error(`Failed to import entry file: ${entryPath}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const program = findProgram(mod);
  if (!program) {
    console.error('No Padrone program found in the entry file.');
    console.error('The entry file must export a Padrone program (default or named export).');
    process.exit(1);
  }

  const cmd = getCommand(program as object);
  const diagnostics: Diagnostic[] = [];

  collectDiagnostics(cmd, diagnostics);

  if (diagnostics.length === 0) {
    console.log('No issues found.');
    return;
  }

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  for (const d of diagnostics) {
    const prefix = d.severity === 'error' ? 'error' : 'warning';
    console.log(`  ${prefix}: [${d.command}] ${d.message}`);
  }

  console.log();
  const parts: string[] = [];
  if (errors.length > 0) parts.push(`${errors.length} error(s)`);
  if (warnings.length > 0) parts.push(`${warnings.length} warning(s)`);
  console.log(`Found ${parts.join(' and ')}.`);

  if (errors.length > 0) {
    process.exit(1);
  }
}

function collectDiagnostics(cmd: AnyPadroneCommand, diagnostics: Diagnostic[]) {
  checkCircularParentRefs(cmd, diagnostics);

  const allCommands = flattenCommands(cmd);

  checkDuplicateAliases(allCommands, diagnostics);
  checkShadowedOptionNames(allCommands, diagnostics);
  checkCommandsWithoutActions(allCommands, diagnostics);
  checkSchemasWithoutDescriptions(allCommands, diagnostics);
  checkConflictingPositionals(allCommands, diagnostics);
  checkUnusedPlugins(allCommands, diagnostics);
  checkDuplicateOptionFlagsAndAliases(allCommands, diagnostics);
  checkUnreachableCommands(allCommands, diagnostics);
  checkMissingCommandDescriptions(allCommands, diagnostics);
  checkEmptyCommandGroups(allCommands, diagnostics);
  checkDeprecatedWithoutHint(allCommands, diagnostics);
}

function flattenCommands(cmd: AnyPadroneCommand): AnyPadroneCommand[] {
  const result: AnyPadroneCommand[] = [cmd];
  if (cmd.commands) {
    for (const sub of cmd.commands) {
      result.push(...flattenCommands(sub));
    }
  }
  return result;
}

function commandDisplayName(cmd: AnyPadroneCommand): string {
  return cmd.path || cmd.name || '<root>';
}

function getJsonSchema(cmd: AnyPadroneCommand): Record<string, any> | null {
  try {
    if (!cmd.argsSchema) return null;
    return cmd.argsSchema['~standard'].jsonSchema.input(JSON_SCHEMA_OPTS) as Record<string, any>;
  } catch {
    return null;
  }
}

/**
 * Check for duplicate aliases across sibling commands.
 */
function checkDuplicateAliases(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  for (const cmd of commands) {
    if (!cmd.commands || cmd.commands.length < 2) continue;

    const seen = new Map<string, string>();
    for (const sub of cmd.commands) {
      const names = [sub.name, ...(sub.aliases || [])];
      for (const name of names) {
        if (!name) continue;
        const existing = seen.get(name);
        if (existing) {
          diagnostics.push({
            severity: 'error',
            command: commandDisplayName(cmd),
            message: `Duplicate alias "${name}" used by both "${existing}" and "${sub.name}".`,
          });
        } else {
          seen.set(name, sub.name);
        }
      }
    }
  }
}

/**
 * Check for option names or subcommand names that shadow built-in flags/commands (help, version).
 */
function checkShadowedOptionNames(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  const builtins = new Set(['help', 'version']);

  for (const cmd of commands) {
    // Check subcommand names and aliases
    if (cmd.commands) {
      for (const sub of cmd.commands) {
        const names = [sub.name, ...(sub.aliases || [])];
        for (const name of names) {
          if (name && builtins.has(name)) {
            diagnostics.push({
              severity: 'warning',
              command: commandDisplayName(cmd),
              message: `Subcommand "${sub.name}"${name !== sub.name ? ` (alias "${name}")` : ''} shadows the built-in "${name}" command.`,
            });
          }
        }
      }
    }

    // Check option names in schema
    const jsonSchema = getJsonSchema(cmd);
    if (!jsonSchema?.properties) continue;

    for (const propName of Object.keys(jsonSchema.properties)) {
      if (builtins.has(propName)) {
        diagnostics.push({
          severity: 'warning',
          command: commandDisplayName(cmd),
          message: `Option "${propName}" shadows the built-in --${propName} flag.`,
        });
      }
    }

    // Also check field flags and aliases from meta
    if (cmd.meta?.fields) {
      for (const [fieldName, fieldMeta] of Object.entries(cmd.meta.fields)) {
        if (!fieldMeta) continue;

        // Check flags (single-char)
        if (fieldMeta.flags) {
          const flagList = typeof fieldMeta.flags === 'string' ? [fieldMeta.flags] : fieldMeta.flags;
          for (const flag of flagList) {
            if (builtins.has(flag)) {
              diagnostics.push({
                severity: 'warning',
                command: commandDisplayName(cmd),
                message: `Flag "${flag}" on field "${fieldName}" shadows the built-in --${flag} flag.`,
              });
            }
          }
        }

        // Check aliases (multi-char)
        if (fieldMeta.alias) {
          const aliasList = typeof fieldMeta.alias === 'string' ? [fieldMeta.alias] : fieldMeta.alias;
          for (const alias of aliasList) {
            if (builtins.has(alias)) {
              diagnostics.push({
                severity: 'warning',
                command: commandDisplayName(cmd),
                message: `Alias "${alias}" on field "${fieldName}" shadows the built-in --${alias} flag.`,
              });
            }
          }
        }
      }
    }
  }
}

/**
 * Check for leaf commands (no subcommands) that have no action defined.
 */
function checkCommandsWithoutActions(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  for (const cmd of commands) {
    const isLeaf = !cmd.commands || cmd.commands.length === 0;
    // Root without subcommands or leaf commands should have actions
    const isRoot = !cmd.parent;
    if (isLeaf && !isRoot && !cmd.action) {
      diagnostics.push({
        severity: 'warning',
        command: commandDisplayName(cmd),
        message: 'Command has no action defined.',
      });
    }
  }
}

/**
 * Check for schema properties without descriptions.
 */
function checkSchemasWithoutDescriptions(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  for (const cmd of commands) {
    const jsonSchema = getJsonSchema(cmd);
    if (!jsonSchema?.properties) continue;

    for (const [propName, propSchema] of Object.entries(jsonSchema.properties as Record<string, any>)) {
      if (!propSchema) continue;

      const hasDescription = propSchema.description || cmd.meta?.fields?.[propName]?.description;
      if (!hasDescription) {
        diagnostics.push({
          severity: 'warning',
          command: commandDisplayName(cmd),
          message: `Option "${propName}" has no description.`,
        });
      }
    }
  }
}

/**
 * Check for conflicting positional argument configurations.
 * e.g., variadic positional not at the end, or multiple variadics.
 */
function checkConflictingPositionals(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  for (const cmd of commands) {
    const positional = cmd.meta?.positional;
    if (!positional || positional.length === 0) continue;

    let variadicCount = 0;
    let variadicIndex = -1;

    for (let i = 0; i < positional.length; i++) {
      const p = positional[i] as string;
      if (p.startsWith('...')) {
        variadicCount++;
        variadicIndex = i;
      }
    }

    if (variadicCount > 1) {
      diagnostics.push({
        severity: 'error',
        command: commandDisplayName(cmd),
        message: 'Multiple variadic positional arguments defined.',
      });
    }

    if (variadicCount === 1 && variadicIndex !== positional.length - 1) {
      diagnostics.push({
        severity: 'warning',
        command: commandDisplayName(cmd),
        message: 'Variadic positional argument is not in the last position.',
      });
    }

    // Check for positional names that don't exist in schema
    const jsonSchema = getJsonSchema(cmd);
    if (jsonSchema?.properties) {
      for (const p of positional) {
        const name = (p as string).replace(/^\.\.\./, '');
        if (!(name in jsonSchema.properties)) {
          diagnostics.push({
            severity: 'error',
            command: commandDisplayName(cmd),
            message: `Positional "${name}" does not exist in the schema.`,
          });
        }
      }
    }
  }
}

/**
 * Check for plugins that don't define any phase handlers.
 */
function checkUnusedPlugins(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  const phases = ['start', 'parse', 'validate', 'execute', 'error', 'shutdown'] as const;

  for (const cmd of commands) {
    if (!cmd.plugins) continue;

    for (const plugin of cmd.plugins) {
      const hasHandler = phases.some((phase) => typeof (plugin as any)[phase] === 'function');
      if (!hasHandler) {
        diagnostics.push({
          severity: 'warning',
          command: commandDisplayName(cmd),
          message: `Plugin "${plugin.name}" has no phase handlers.`,
        });
      }
    }
  }
}

/**
 * Check for circular parent references in the command tree.
 * Uses a visited set to detect cycles before flattening.
 */
function checkCircularParentRefs(cmd: AnyPadroneCommand, diagnostics: Diagnostic[]) {
  const visited = new Set<AnyPadroneCommand>();

  function walk(node: AnyPadroneCommand) {
    if (visited.has(node)) {
      diagnostics.push({
        severity: 'error',
        command: commandDisplayName(node),
        message: 'Circular reference detected in command tree.',
      });
      return;
    }
    visited.add(node);
    if (node.commands) {
      for (const sub of node.commands) {
        walk(sub);
      }
    }
  }

  walk(cmd);
}

/**
 * Check for duplicate flags or aliases within a single command's meta fields.
 * e.g., two different options both using `-v` or both aliased to `--output`.
 */
function checkDuplicateOptionFlagsAndAliases(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  for (const cmd of commands) {
    if (!cmd.meta?.fields) continue;

    const seenFlags = new Map<string, string>();
    const seenAliases = new Map<string, string>();

    for (const [fieldName, fieldMeta] of Object.entries(cmd.meta.fields)) {
      if (!fieldMeta) continue;

      if (fieldMeta.flags) {
        const flagList = typeof fieldMeta.flags === 'string' ? [fieldMeta.flags] : fieldMeta.flags;
        for (const flag of flagList) {
          const existing = seenFlags.get(flag);
          if (existing) {
            diagnostics.push({
              severity: 'error',
              command: commandDisplayName(cmd),
              message: `Flag "-${flag}" is used by both "${existing}" and "${fieldName}".`,
            });
          } else {
            seenFlags.set(flag, fieldName);
          }
        }
      }

      if (fieldMeta.alias) {
        const aliasList = typeof fieldMeta.alias === 'string' ? [fieldMeta.alias] : fieldMeta.alias;
        for (const alias of aliasList) {
          const existing = seenAliases.get(alias);
          if (existing) {
            diagnostics.push({
              severity: 'error',
              command: commandDisplayName(cmd),
              message: `Alias "--${alias}" is used by both "${existing}" and "${fieldName}".`,
            });
          } else {
            seenAliases.set(alias, fieldName);
          }
        }
      }
    }
  }
}

/**
 * Check for commands that are unreachable because a parent is hidden.
 * A hidden parent makes all its children effectively invisible to users.
 */
function checkUnreachableCommands(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  for (const cmd of commands) {
    if (!cmd.parent || cmd.hidden) continue;

    let ancestor: AnyPadroneCommand | undefined = cmd.parent;
    while (ancestor) {
      if (ancestor.hidden && ancestor.parent) {
        diagnostics.push({
          severity: 'warning',
          command: commandDisplayName(cmd),
          message: `Command is unreachable because parent "${commandDisplayName(ancestor)}" is hidden.`,
        });
        break;
      }
      ancestor = ancestor.parent;
    }
  }
}

/**
 * Check for non-root commands without a title or description.
 */
function checkMissingCommandDescriptions(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  for (const cmd of commands) {
    if (!cmd.parent) continue;
    if (cmd.hidden) continue;

    if (!cmd.title && !cmd.description) {
      diagnostics.push({
        severity: 'warning',
        command: commandDisplayName(cmd),
        message: 'Command has no title or description.',
      });
    }
  }
}

/**
 * Check for branch commands (have subcommands) that have no leaf descendants.
 * This catches empty command groups where all subcommands are also empty branches.
 */
function checkEmptyCommandGroups(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  function hasLeafDescendant(cmd: AnyPadroneCommand): boolean {
    if (!cmd.commands || cmd.commands.length === 0) return true;
    return cmd.commands.some(hasLeafDescendant);
  }

  for (const cmd of commands) {
    if (!cmd.commands || cmd.commands.length === 0) continue;

    const allSubsEmpty = cmd.commands.every((sub) => sub.commands && sub.commands.length > 0 && !hasLeafDescendant(sub));

    if (allSubsEmpty) {
      diagnostics.push({
        severity: 'warning',
        command: commandDisplayName(cmd),
        message: 'Command group has no reachable leaf commands.',
      });
    }
  }
}

/**
 * Check for deprecated commands that use `deprecated: true` without a hint message.
 */
function checkDeprecatedWithoutHint(commands: AnyPadroneCommand[], diagnostics: Diagnostic[]) {
  for (const cmd of commands) {
    if (cmd.deprecated === true) {
      diagnostics.push({
        severity: 'warning',
        command: commandDisplayName(cmd),
        message: 'Command is deprecated without a replacement hint. Use a string to provide guidance (e.g., "Use \'new-cmd\' instead").',
      });
    }

    // Also check deprecated option fields
    if (cmd.meta?.fields) {
      for (const [fieldName, fieldMeta] of Object.entries(cmd.meta.fields)) {
        if (fieldMeta?.deprecated === true) {
          diagnostics.push({
            severity: 'warning',
            command: commandDisplayName(cmd),
            message: `Option "${fieldName}" is deprecated without a replacement hint.`,
          });
        }
      }
    }
  }
}

function findProgram(mod: Record<string, unknown>): unknown | null {
  const defaultExport = mod.default;
  if (isPadroneProgram(defaultExport)) return defaultExport;

  for (const value of Object.values(mod)) {
    if (isPadroneProgram(value)) return value;
  }

  return null;
}
