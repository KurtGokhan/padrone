import { lazy, Suspense } from 'react';

const TerminalLazy = lazy(() => import('./Terminal.tsx').then((module) => ({ default: module.Terminal })));

export function Terminal() {
  return (
    <Suspense fallback={<div>Loading Terminal...</div>}>
      <TerminalLazy />
    </Suspense>
  );
}
