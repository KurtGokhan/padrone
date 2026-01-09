// ============================================================================
// Helper Types for Extracting Schema Types
// ============================================================================

import type { GetCommandPaths, PickCommandByName } from './type-utils';
import type { AnyPadroneCommand, AnyPadroneProgram, PadroneCommand, PadroneSchema } from './types';

/**
 * Extracts the input type of the options schema from a command.
 * @example
 * ```ts
 * type Options = InferOptionsInput<typeof myCommand>;
 * ```
 */
export type InferOptionsInput<T extends AnyPadroneCommand> = T['~types']['optionsInput'];

/**
 * Extracts the output type of the options schema from a command.
 * @example
 * ```ts
 * type Options = InferOptionsOutput<typeof myCommand>;
 * ```
 */
export type InferOptionsOutput<T extends AnyPadroneCommand> = T['~types']['optionsOutput'];

/**
 * Extracts the input type of the config schema from a command.
 * @example
 * ```ts
 * type Config = InferConfigInput<typeof myCommand>;
 * ```
 */
export type InferConfigInput<T extends AnyPadroneCommand> = T['config'] extends PadroneSchema<infer I, any> ? I : never;

/**
 * Extracts the output type of the config schema from a command.
 * This is the type after transformation, which should match the options shape.
 * @example
 * ```ts
 * type ConfigOutput = InferConfigOutput<typeof myCommand>;
 * ```
 */
export type InferConfigOutput<T extends AnyPadroneCommand> = T['config'] extends PadroneSchema<any, infer O> ? O : never;

/**
 * Extracts the input type of the env schema from a command.
 * This represents the raw environment variables shape (e.g., { PORT: string }).
 * @example
 * ```ts
 * type EnvInput = InferEnvInput<typeof myCommand>;
 * ```
 */
export type InferEnvInput<T extends AnyPadroneCommand> = T['envSchema'] extends PadroneSchema<infer I, any> ? I : never;

/**
 * Extracts the output type of the env schema from a command.
 * This is the type after transformation, which should match the options shape.
 * @example
 * ```ts
 * type EnvOutput = InferEnvOutput<typeof myCommand>;
 * ```
 */
export type InferEnvOutput<T extends AnyPadroneCommand> = T['envSchema'] extends PadroneSchema<any, infer O> ? O : never;

/**
 * Gets a command type by its path from a program or command tree.
 * Supports both full paths (e.g., "config set") and alias paths.
 * @example
 * ```ts
 * const program = createPadrone('cli')
 *   .command('config', c => c
 *     .command('set', c => c.options(...).action(...))
 *     .command('get', c => c.options(...).action(...))
 *   );
 *
 * type SetCommand = InferCommand<typeof program, 'config set'>;
 * type GetCommand = InferCommand<typeof program, 'config get'>;
 * ```
 */
export type InferCommand<
  T extends AnyPadroneCommand | AnyPadroneProgram,
  TPath extends GetCommandPaths<T extends AnyPadroneCommand ? [T] : T['~types']['commands']>,
> = T extends AnyPadroneProgram
  ? PickCommandByName<[PadroneCommand<'', '', any, any, T['~types']['commands']>], TPath>
  : T extends AnyPadroneCommand
    ? PickCommandByName<[T], TPath>
    : never;
