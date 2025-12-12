import { createPadroneCommandBuilder } from './create';
import type { PadroneCommand, PadroneProgram } from './types';

export function createPadrone(name: string): PadroneProgram {
  return createPadroneCommandBuilder({ name, path: '', commands: [] } as PadroneCommand) as PadroneProgram;
}
