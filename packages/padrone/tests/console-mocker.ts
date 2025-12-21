import { afterEach, beforeEach, mock } from 'bun:test';

export function createConsoleMocker() {
  const originalConsole = globalThis.console;

  const mockConsole = {
    Console: originalConsole.Console,
    log: mock(),
    info: mock(),
    warn: mock(),
    error: mock(),
    assert: mock(),
    debug: mock(),
    trace: mock(),
    dir: mock(),
    dirxml: mock(),
    clear: mock(),
    table: mock(),
    time: mock(),
    timeEnd: mock(),
    group: mock(),
    groupEnd: mock(),
    count: mock(),
    countReset: mock(),
    profile: mock(),
    profileEnd: mock(),
    timeLog: mock(),
    groupCollapsed: mock(),
    timeStamp: mock(),
    write: mock(),
    [Symbol.asyncIterator]: mock(),
  } satisfies Console;

  function clearAllMocks() {
    for (const key of Object.keys(mockConsole)) {
      const val = (mockConsole as any)[key];
      if (typeof val === 'function' && 'mockClear' in val) {
        val.mockClear();
      }
    }
  }

  beforeEach(() => {
    clearAllMocks();
    globalThis.console = mockConsole;
  });

  afterEach(() => {
    globalThis.console = originalConsole;
  });

  return { mockConsole, clearAllMocks };
}
