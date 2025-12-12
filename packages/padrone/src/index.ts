import { createPadroneCommandBuilder } from './create';
import type { PadroneCommand, PadroneProgram } from './types';

export function createPadrone() {
  return createPadroneCommandBuilder({ name: '', fullName: '', commands: [] } as PadroneCommand) as PadroneProgram;
}
