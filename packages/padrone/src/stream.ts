import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { PadroneSchema } from './types.ts';

export interface AsyncStreamMeta {
  [x: string]: unknown;
  readonly asyncStream: number;
  readonly itemSchema?: StandardSchemaV1;
}

let asyncStreamIdCounter = 1;
export const asyncStreamRegistry = new Map<number, AsyncStreamMeta>();

/**
 * Returns metadata to mark a schema field as an async stream via `.meta()`.
 *
 * When used with `stdin`, padrone pipes stdin data as an `AsyncIterable` instead of
 * buffering it. Each line is validated against the item schema (if provided) as it arrives.
 *
 * @param itemSchema - Optional item schema for per-item validation.
 *   Non-string schemas cause each stdin line to be `JSON.parse`'d before validation.
 *
 * @example
 * ```ts
 * import { asyncStream } from 'padrone';
 *
 * // String lines
 * z.object({ lines: z.custom<AsyncIterable<string>>().meta(asyncStream()) })
 *
 * // Typed items — each line JSON.parse'd and validated
 * z.object({ records: z.custom<AsyncIterable<{ name: string }>>().meta(asyncStream(recordSchema)) })
 * ```
 */
export function asyncStream<T = string>(itemSchema?: PadroneSchema<T>): AsyncStreamMeta {
  const id = asyncStreamIdCounter++;
  const meta: AsyncStreamMeta = itemSchema ? { asyncStream: id, itemSchema } : { asyncStream: id };
  asyncStreamRegistry.set(id, meta);
  return meta;
}

/** Stdin interface matching PadroneRuntime.stdin */
interface StdinSource {
  isTTY?: boolean;
  text(): Promise<string>;
  lines(): AsyncIterable<string>;
}

/**
 * Creates an `AsyncIterable` from a stdin source, optionally validating each item.
 * When no stdin is available (TTY / undefined), yields nothing.
 *
 * - No item schema: yields raw string lines
 * - With item schema: `JSON.parse`s each line, validates, then yields
 */
export function createStdinStream(stdin: StdinSource | undefined, itemSchema?: StandardSchemaV1): AsyncIterable<unknown> {
  if (!stdin) return emptyAsyncIterable;

  if (!itemSchema) return stdin.lines();

  return {
    async *[Symbol.asyncIterator]() {
      for await (const line of stdin.lines()) {
        const result = itemSchema['~standard'].validate(line);
        const resolved = result instanceof Promise ? await result : result;
        if ('issues' in resolved && resolved.issues) {
          throw new Error(`Stream item validation failed: ${resolved.issues.map((i) => i.message).join(', ')}`);
        }
        yield (resolved as { value: unknown }).value;
      }
    },
  };
}

const emptyAsyncIterable: AsyncIterable<never> = {
  async *[Symbol.asyncIterator]() {},
};
