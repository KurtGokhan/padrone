import type { AnyPadroneCommand } from '../types/index.ts';

/**
 * Resolves an inherited field by walking up the parent chain.
 * Returns the value from the nearest ancestor that defines it, or undefined.
 */
export function resolveInherited<K extends keyof AnyPadroneCommand>(cmd: AnyPadroneCommand, key: K): AnyPadroneCommand[K] {
  let current: AnyPadroneCommand | undefined = cmd;
  while (current) {
    if (current[key] !== undefined) return current[key];
    current = current.parent;
  }
  return undefined;
}
