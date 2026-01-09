import type { PadroneOptionsMeta } from './options.ts';

declare module 'zod/v4/core' {
  export interface GlobalMeta extends PadroneOptionsMeta {}
}
