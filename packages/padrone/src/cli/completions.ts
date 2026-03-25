import { basename } from 'node:path';
import { detectShell, getCompletionInstallInstructions, type ShellType, setupCompletions } from '../feature/completion.ts';
import type { PadroneActionContext } from '../types/index.ts';

interface CompletionsArgs {
  appPath?: string;
  for?: ShellType;
  setup?: boolean;
}

export function runCompletions(args: CompletionsArgs, _ctx: PadroneActionContext) {
  const programName = args.appPath ? basename(args.appPath).replace(/\.[cm]?[jt]sx?$/, '') : 'padrone';
  const shell = args.for ?? detectShell();

  if (!shell) {
    console.error('Could not detect shell. Use --for to specify one: bash, zsh, fish, powershell');
    process.exit(1);
  }

  if (args.setup) {
    const result = setupCompletions(programName, shell);
    const verb = result.updated ? 'Updated' : 'Added';
    console.log(`${verb} ${programName} completions in ${result.file}`);
    return;
  }

  const instructions = getCompletionInstallInstructions(programName, shell);
  console.log(instructions);
}
