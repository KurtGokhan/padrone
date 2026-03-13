import type { PadroneFieldMeta } from './options.ts';

declare module 'zod/v4/core' {
  export interface GlobalMeta extends PadroneFieldMeta {}
}
