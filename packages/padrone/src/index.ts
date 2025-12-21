import { createPadroneCommandBuilder } from './create';
import type { PadroneCommand, PadroneProgram } from './types';

export function createPadrone(name: string): PadroneProgram {
  return createPadroneCommandBuilder({ name, path: '', commands: [] } as PadroneCommand) as PadroneProgram;
}

export type { HelpArgumentInfo, HelpFormat, HelpInfo, HelpOptionInfo, HelpSubcommandInfo } from './formatter';
export type { HelpOptions } from './help';
export type { PadroneOptionsMeta } from './options';
// Re-export types for consumers
export type {
  AnyPadroneCommand,
  AnyPadroneProgram,
  PadroneCommand,
  PadroneCommandBuilder,
  PadroneCommandResult,
  PadroneParseOptions,
  PadroneParseResult,
  PadroneProgram,
  PadroneSchema,
} from './types';
