import * as z from 'zod/v4';
import { detectShell, getCompletionInstallInstructions, setupCompletions } from '../feature/completion.ts';
import type { PadroneActionContext } from '../types/index.ts';

export const completionsSchema = z.object({
  appPath: z.string().optional().describe('Path or name of the CLI program (defaults to padrone)'),
  for: z.enum(['bash', 'zsh', 'fish', 'powershell']).optional().describe('Target shell (auto-detected if omitted)'),
  setup: z.boolean().optional().default(false).describe('Write completions to shell config file'),
});

type CompletionsArgs = z.infer<typeof completionsSchema>;

export async function runCompletions(args: CompletionsArgs, _ctx: PadroneActionContext) {
  const { basename } = await import('node:path');
  const programName = args.appPath ? basename(args.appPath).replace(/\.[cm]?[jt]sx?$/, '') : 'padrone';
  const shell = args.for ?? (await detectShell());

  if (!shell) {
    console.error('Could not detect shell. Use --for to specify one: bash, zsh, fish, powershell');
    process.exit(1);
  }

  if (args.setup) {
    const result = await setupCompletions(programName, shell);
    const verb = result.updated ? 'Updated' : 'Added';
    console.log(`${verb} ${programName} completions in ${result.file}`);
    return;
  }

  const instructions = getCompletionInstallInstructions(programName, shell);
  console.log(instructions);
}
