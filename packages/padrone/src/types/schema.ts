import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

/**
 * A schema that supports both validation (StandardSchemaV1) and JSON schema generation (StandardJSONSchemaV1).
 * This is the type required for command arguments in Padrone.
 */
export type PadroneSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> & StandardJSONSchemaV1<Input, Output>;

/**
 * A schema branded as async. When passed to `.arguments()`, `.configFile()`, or `.env()`,
 * the command is automatically marked as async, causing `parse()` and `cli()` to return Promises.
 *
 * Use the `asyncSchema()` helper to brand an existing schema:
 * ```ts
 * import { asyncSchema } from 'padrone';
 * const schema = asyncSchema(z.object({ name: z.string() }).check(async (v) => { ... }));
 * ```
 */
export type AsyncPadroneSchema<Input = unknown, Output = Input> = PadroneSchema<Input, Output> & { '~async': true };
