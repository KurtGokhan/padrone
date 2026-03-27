import { createConsoleMocker } from './console-mocker.ts';

// Force a consistent terminal width in tests to avoid non-deterministic output
process.stdout.columns = 120;

createConsoleMocker('outside-test');
