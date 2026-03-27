import type { AnyPadroneCommand, AnyPadroneProgram, PadroneCommand } from '../types/index.ts';
import type { PickCommandByName, PossibleCommands } from './type-utils.ts';

/**
 * Extracts the input type of the arguments schema from a command.
 * @example
 * ```ts
 * type Args = InferArgsInput<typeof myCommand>;
 * ```
 */
export type InferArgsInput<T extends AnyPadroneCommand> = T['~types']['argsInput'];

/**
 * Extracts the output type of the arguments schema from a command.
 * @example
 * ```ts
 * type Args = InferArgsOutput<typeof myCommand>;
 * ```
 */
export type InferArgsOutput<T extends AnyPadroneCommand> = T['~types']['argsOutput'];

/**
 * Extracts the context type from a command.
 * @example
 * ```ts
 * type Ctx = InferContext<typeof myCommand>;
 * ```
 */
export type InferContext<T extends AnyPadroneCommand> = T['~types']['context'];

/**
 * Gets a command type by its path from a program or command tree.
 * Supports both full paths (e.g., "config set") and alias paths.
 * @example
 * ```ts
 * const program = createPadrone('cli')
 *   .command('config', c => c
 *     .command('set', c => c.arguments(...).action(...))
 *     .command('get', c => c.arguments(...).action(...))
 *   );
 *
 * type SetCommand = InferCommand<typeof program, 'config set'>;
 * type GetCommand = InferCommand<typeof program, 'config get'>;
 * ```
 */
export type InferCommand<
  T extends AnyPadroneCommand | AnyPadroneProgram,
  TPath extends PossibleCommands<T extends AnyPadroneCommand ? [T] : T['~types']['commands'], true, true>,
> = T extends AnyPadroneProgram
  ? PickCommandByName<[PadroneCommand<'', '', any, any, T['~types']['commands']>], TPath>
  : T extends AnyPadroneCommand
    ? PickCommandByName<[T], TPath>
    : never;
