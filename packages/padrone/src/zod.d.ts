import type { PadroneFieldMeta } from './args.ts';

declare module 'zod/v4/core' {
  export interface GlobalMeta extends PadroneFieldMeta {}
}
