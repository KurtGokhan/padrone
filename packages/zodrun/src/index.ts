import { createZodrunCommandBuilder } from './create';
import type { ZodrunCommand, ZodrunProgram } from './types';

export function createZodrun() {
  return createZodrunCommandBuilder({ command: '', commands: [] } as ZodrunCommand) as ZodrunProgram;
}
