import { createZodrunCommandBuilder } from './create';
import type { ZodrunCommand, ZodrunProgram } from './types';

export function createZodrun() {
  return createZodrunCommandBuilder({ name: '' } as ZodrunCommand, []) as ZodrunProgram;
}
