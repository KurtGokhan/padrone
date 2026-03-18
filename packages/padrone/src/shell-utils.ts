export type ShellType = 'bash' | 'zsh' | 'fish' | 'powershell';

/**
 * Detects the current shell from environment variables and process info.
 * @returns The detected shell type, or undefined if unknown
 */
export function detectShell(): ShellType | undefined {
  if (typeof process === 'undefined') return undefined;

  // Method 1: Check SHELL environment variable (most common)
  const shellEnv = process.env.SHELL || '';
  if (shellEnv.includes('zsh')) return 'zsh';
  if (shellEnv.includes('bash')) return 'bash';
  if (shellEnv.includes('fish')) return 'fish';

  // Method 2: Check Windows-specific shells
  if (process.env.PSModulePath || process.env.POWERSHELL_DISTRIBUTION_CHANNEL) {
    return 'powershell';
  }

  // Method 3: Check parent process on Unix-like systems
  try {
    const ppid = process.ppid;
    if (ppid) {
      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      const processName = execSync(`ps -p ${ppid} -o comm=`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      if (processName.includes('zsh')) return 'zsh';
      if (processName.includes('bash')) return 'bash';
      if (processName.includes('fish')) return 'fish';
    }
  } catch {
    // Ignore errors (e.g., ps not available)
  }

  return undefined;
}

export function getRcFile(shell: ShellType, home?: string): string | null {
  const { homedir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const h = home ?? homedir();
  switch (shell) {
    case 'bash':
      return join(h, '.bashrc');
    case 'zsh':
      return join(h, '.zshrc');
    case 'fish':
      return join(h, '.config', 'fish', 'config.fish');
    case 'powershell':
      return process.env.PROFILE || join(h, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    default:
      return null;
  }
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Writes a snippet to a shell config file using begin/end markers for idempotency.
 * If a block with the same begin marker exists, it is replaced. Otherwise the snippet is appended.
 */
export function writeToRcFile(rcFile: string, snippet: string, beginMarker: string, endMarker: string): { file: string; updated: boolean } {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
  const { dirname } = require('node:path') as typeof import('node:path');
  const existing = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8') : '';

  if (existing.includes(beginMarker)) {
    const pattern = new RegExp(`${escapeRegExp(beginMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
    writeFileSync(rcFile, existing.replace(pattern, snippet));
    return { file: rcFile, updated: true };
  }

  mkdirSync(dirname(rcFile), { recursive: true });
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(rcFile, `${existing}${separator}\n${snippet}\n`);
  return { file: rcFile, updated: false };
}
