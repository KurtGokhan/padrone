import type { AnyPadroneCommand } from './types';

export function getRootCommand(cmd: AnyPadroneCommand): AnyPadroneCommand {
  let current = cmd;
  while (current.parent) current = current.parent;
  return current;
}
