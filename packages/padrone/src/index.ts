import { createPadroneCommandBuilder } from './create';
import type { PadroneCommand, PadroneProgram } from './types';

export function createPadrone<TName extends string>(name: TName): PadroneProgram<TName> {
  return createPadroneCommandBuilder({ name, path: '', commands: [] } as PadroneCommand<TName>) as unknown as PadroneProgram<TName>;
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
  PadroneCommandConfig,
  PadroneCommandResult,
  PadroneParseOptions,
  PadroneParseResult,
  PadroneProgram,
} from './types';
