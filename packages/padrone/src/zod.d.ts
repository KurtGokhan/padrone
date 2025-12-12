import type { PadroneOptionsMeta } from './options';

declare module 'zod/v4/core' {
  export interface GlobalMeta extends PadroneOptionsMeta {}
}
