import { lazy, Suspense } from 'react';

const TerminalLazy = lazy(() => import('./TerminalRender.tsx').then((module) => ({ default: module.TerminalRender })));

export function Terminal() {
  return (
    <Suspense fallback={<div>Loading Terminal...</div>}>
      <TerminalLazy />
    </Suspense>
  );
}
