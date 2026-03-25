import * as z from 'zod/v4';
import type { PadroneSchema } from '../types/index.ts';
import { asyncStream } from '../util/stream.ts';

/**
 * Creates a Zod schema for an async stream field, ready to use in `.arguments()`.
 * Wraps `z.custom<AsyncIterable<T>>()` with the `asyncStream()` metadata automatically.
 *
 * @param itemSchema - Optional item schema for per-item validation.
 *
 * @example
 * ```ts
 * import { zodAsyncStream } from 'padrone/zod';
 *
 * // String lines
 * z.object({ lines: zodAsyncStream() })
 *
 * // Typed items — each line JSON.parse'd and validated
 * const recordSchema = z.object({ name: z.string(), age: z.number() });
 * z.object({ records: zodAsyncStream(jsonCodec(recordSchema)) })
 * ```
 */
export function zodAsyncStream<T = string>(itemSchema?: PadroneSchema<unknown, T>) {
  return z.custom<AsyncIterable<T>>().meta(asyncStream(itemSchema));
}

/**
 * JSON codec for Zod schemas
 * @see https://zod.dev/codecs?id=jsonschema
 * Unlike the example in the docs, this codec also handles the case where the input is already an object
 */
export const jsonCodec = <T extends z.ZodType>(schema: T) =>
  z.codec(z.union([z.string(), z.unknown()]), schema, {
    decode: (jsonString, ctx) => {
      try {
        // HACK: in some cases the object is already deserialized, we just need to validate it
        if (typeof jsonString !== 'string') return jsonString as z.input<T>;
        return JSON.parse(jsonString) as z.input<T>;
      } catch (err: any) {
        ctx.issues.push({
          code: 'invalid_format',
          format: 'json',
          input: typeof jsonString === 'string' ? jsonString : JSON.stringify(jsonString),
          message: err.message,
        });
        return z.NEVER;
      }
    },
    encode: (value) => JSON.stringify(value),
  });
