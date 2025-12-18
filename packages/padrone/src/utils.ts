import type { AnyPadroneCommand } from './types';

export function getRootCommand(cmd: AnyPadroneCommand): AnyPadroneCommand {
  let current = cmd;
  while (current.parent) current = current.parent;
  return current;
}

/**
 * Attempts to get the version from various sources:
 * 1. Explicit version set on the command
 * 2. npm_package_version environment variable (set by npm/yarn/pnpm when running scripts)
 * 3. package.json in current or parent directories
 * @param explicitVersion - Version explicitly set via .version()
 * @returns The version string or '0.0.0' if not found
 */
export function getVersion(explicitVersion?: string): string {
  // 1. Use explicit version if provided
  if (explicitVersion) return explicitVersion;

  // 2. Check npm_package_version env var (set by npm/yarn/pnpm during script execution)
  if (typeof process !== 'undefined' && process.env?.npm_package_version) {
    return process.env.npm_package_version;
  }

  // 3. Try to read from package.json
  if (typeof process !== 'undefined') {
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      let dir = process.cwd();

      // Walk up the directory tree looking for package.json
      for (let i = 0; i < 10; i++) {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg.version) return pkg.version;
        }
        const parentDir = path.dirname(dir);
        if (parentDir === dir) break; // Reached root
        dir = parentDir;
      }
    } catch {
      // Ignore errors (e.g., fs not available in browser)
    }
  }

  return '0.0.0';
}

/**
 * Loads and parses a config file from the given path.
 * Supports JSON, JSONC (JSON with comments), and attempts to parse other formats.
 * @param configPath - Path to the config file
 * @returns Parsed config data or undefined if loading fails
 */
export function loadConfigFile(configPath: string): Record<string, unknown> | undefined {
  if (typeof process === 'undefined') return undefined;

  try {
    const fs = require('node:fs');
    const path = require('node:path');

    // Resolve to absolute path
    const absolutePath = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);

    if (!fs.existsSync(absolutePath)) {
      console.error(`Config file not found: ${absolutePath}`);
      return undefined;
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const ext = path.extname(absolutePath).toLowerCase();

    // Parse based on file extension
    if (ext === '.json' || ext === '.jsonc') {
      // Strip comments for JSONC support (simple implementation)
      const jsonContent = content
        .replace(/^\s*\/\/.*$/gm, '') // Remove single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
      return JSON.parse(jsonContent);
    }

    if (ext === '.js' || ext === '.cjs' || ext === '.mjs' || ext === '.ts' || ext === '.cts' || ext === '.mts') {
      // For JS files, require them
      return require(absolutePath);
    }

    // For unknown extensions, try to parse as JSON
    try {
      return JSON.parse(content);
    } catch {
      console.error(`Unable to parse config file: ${absolutePath}`);
      return undefined;
    }
  } catch (error) {
    console.error(`Error loading config file: ${error}`);
    return undefined;
  }
}
