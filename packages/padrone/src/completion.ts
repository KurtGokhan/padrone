export type { SetupCompletionsResult, ShellType } from './feature/completion.ts';
export {
  detectShell,
  escapeRegExp,
  generateBashCompletion,
  generateCompletion,
  generateCompletionOutput,
  generateFishCompletion,
  generatePowerShellCompletion,
  generateZshCompletion,
  getCompletionInstallInstructions,
  getRcFile,
  setupCompletions,
  writeToRcFile,
} from './feature/completion.ts';
