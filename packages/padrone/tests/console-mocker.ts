import { afterEach, beforeEach, mock, onTestFinished } from 'bun:test';

export function createConsoleMocker(initialize?: 'inside-test' | 'outside-test' | false) {
  const originalConsole = globalThis.console;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

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

  const mockStdout = mock() as ReturnType<typeof mock> & typeof process.stdout.write;
  const mockStderr = mock() as ReturnType<typeof mock> & typeof process.stderr.write;

  function clearAllMocks() {
    for (const key of Object.keys(mockConsole)) {
      const val = (mockConsole as any)[key];
      if (typeof val === 'function' && 'mockClear' in val) {
        val.mockClear();
      }
    }
    mockStdout.mockClear();
    mockStderr.mockClear();
  }

  function install() {
    clearAllMocks();
    globalThis.console = mockConsole;
    process.stdout.write = mockStdout;
    process.stderr.write = mockStderr;
  }

  function restore() {
    globalThis.console = originalConsole;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  if (initialize === 'outside-test') {
    beforeEach(install);
    afterEach(restore);
  } else if (initialize === 'inside-test') {
    install();
    onTestFinished(restore);
  }

  return {
    originalConsole,
    originalStdoutWrite,
    originalStderrWrite,
    mockConsole,
    mockStdout,
    mockStderr,
    clearAllMocks,
    install,
    restore,
  };
}
