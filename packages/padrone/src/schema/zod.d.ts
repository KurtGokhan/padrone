import type { PadroneFieldMeta } from '../core/args.ts';

declare module 'zod/v4/core' {
  export interface GlobalMeta extends PadroneFieldMeta {}
}
