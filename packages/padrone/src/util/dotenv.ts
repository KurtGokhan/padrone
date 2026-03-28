// ── File resolution ─────────────────────────────────────────────────────

/** Returns ordered list of `.env` file names to load (no fs access). */
export function resolveEnvFiles(modes: string[] = [], local = true, base = true): string[] {
  const files: string[] = [];
  if (base) {
    files.push('.env');
    if (local) files.push('.env.local');
  }
  for (const mode of modes) {
    files.push(`.env.${mode}`);
    if (local) files.push(`.env.${mode}.local`);
  }
  return files;
}

// ── Parser ──────────────────────────────────────────────────────────────

/** Parse a `.env` file string into key-value pairs. */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();
    i++;

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Strip optional `export ` prefix
    const stripped = line.startsWith('export ') ? line.slice(7) : line;

    const eqIndex = stripped.indexOf('=');
    if (eqIndex === -1) continue;

    const key = stripped.slice(0, eqIndex).trim();
    let raw = stripped.slice(eqIndex + 1);

    // Detect quoted values
    const trimmedRaw = raw.trimStart();
    const quote = trimmedRaw[0];

    if (quote === '"' || quote === "'" || quote === '`') {
      let value = trimmedRaw.slice(1);

      // Check for closing quote on the same line
      const closeIndex = findClosingQuote(value, quote);
      if (closeIndex !== -1) {
        value = value.slice(0, closeIndex);
      } else {
        // Multiline: accumulate until closing quote
        while (i < lines.length) {
          const nextLine = lines[i]!;
          i++;
          const ci = findClosingQuote(nextLine, quote);
          if (ci !== -1) {
            value += `\n${nextLine.slice(0, ci)}`;
            break;
          }
          value += `\n${nextLine}`;
        }
      }

      if (quote === '"') value = unescapeDoubleQuoted(value);
      result[key] = value;
    } else {
      // Unquoted: strip inline comments, trim
      const commentIndex = raw.indexOf(' #');
      if (commentIndex !== -1) raw = raw.slice(0, commentIndex);
      result[key] = raw.trim();
    }
  }

  return result;
}

function findClosingQuote(s: string, quote: string): number {
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && quote === '"') {
      i += 2; // skip escaped char
      continue;
    }
    if (s[i] === quote) return i;
    i++;
  }
  return -1;
}

function unescapeDoubleQuoted(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

// ── Variable expansion ──────────────────────────────────────────────────

/**
 * Expand `$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}` in a string.
 * Escaped `\$` produces a literal `$`. Undefined variables resolve to `""`.
 */
export function expandVariables(value: string, env: Record<string, string | undefined>): string {
  let result = '';
  let i = 0;

  while (i < value.length) {
    if (value[i] === '\\' && value[i + 1] === '$') {
      result += '$';
      i += 2;
      continue;
    }

    if (value[i] === '$') {
      i++;
      if (i >= value.length) {
        result += '$';
        break;
      }

      if (value[i] === '{') {
        // ${VAR}, ${VAR:-default}, ${VAR-default}
        i++;
        const closeIdx = value.indexOf('}', i);
        if (closeIdx === -1) {
          result += `\${${value.slice(i)}`;
          break;
        }

        const expr = value.slice(i, closeIdx);
        i = closeIdx + 1;

        const colonDashIdx = expr.indexOf(':-');
        const dashIdx = colonDashIdx === -1 ? expr.indexOf('-') : -1;

        if (colonDashIdx !== -1) {
          // ${VAR:-default} — use default if unset or empty
          const varName = expr.slice(0, colonDashIdx);
          const fallback = expr.slice(colonDashIdx + 2);
          const val = env[varName];
          result += val ? val : expandVariables(fallback, env);
        } else if (dashIdx !== -1) {
          // ${VAR-default} — use default only if unset
          const varName = expr.slice(0, dashIdx);
          const fallback = expr.slice(dashIdx + 1);
          const val = env[varName];
          result += val !== undefined ? val : expandVariables(fallback, env);
        } else {
          result += env[expr] ?? '';
        }
      } else {
        // $VAR — collect word chars
        let varName = '';
        while (i < value.length && /[\w]/.test(value[i]!)) {
          varName += value[i];
          i++;
        }
        if (varName) {
          result += env[varName] ?? '';
        } else {
          result += '$';
        }
      }
      continue;
    }

    result += value[i];
    i++;
  }

  return result;
}

// ── File loading ────────────────────────────────────────────────────────

export type LoadEnvFilesOptions = {
  dir?: string;
  modes?: string[];
  local?: boolean;
  override?: boolean;
  base?: boolean;
};

/**
 * Load and merge `.env` files, returning the combined key-value map.
 * Variable expansion uses the merged file values + process env as lookup.
 *
 * Returns synchronously when `node:fs`/`node:path` are already cached (typical),
 * or a Promise on the very first call.
 */
export function loadEnvFiles(
  options: LoadEnvFilesOptions,
  processEnv: Record<string, string | undefined>,
): Record<string, string> | Promise<Record<string, string>> {
  if (typeof process === 'undefined') return {};

  try {
    if (_fs && _path) return loadEnvFilesSync(_fs, _path, options, processEnv);
    return initNodeModules()
      .then(() => loadEnvFilesSync(_fs!, _path!, options, processEnv))
      .catch(() => ({}) as Record<string, string>);
  } catch {
    return {};
  }
}

// ── Internals ───────────────────────────────────────────────────────────

let _fs: typeof import('node:fs') | undefined;
let _path: typeof import('node:path') | undefined;

async function initNodeModules(): Promise<void> {
  if (_fs && _path) return;
  _fs = await import('node:fs');
  _path = await import('node:path');
}

if (typeof process !== 'undefined') initNodeModules();

function loadEnvFilesSync(
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
  options: LoadEnvFilesOptions,
  processEnv: Record<string, string | undefined>,
): Record<string, string> {
  const dir = options.dir ?? process.cwd();
  const fileNames = resolveEnvFiles(options.modes, options.local ?? true, options.base ?? true);
  const merged: Record<string, string> = {};

  for (const name of fileNames) {
    const filePath = path.resolve(dir, name);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseEnvFile(content);
    Object.assign(merged, parsed);
  }

  // Expand variables: file values + processEnv as lookup (processEnv wins in lookup unless override)
  const lookup = options.override ? { ...processEnv, ...merged } : { ...merged, ...processEnv };
  for (const key of Object.keys(merged)) {
    merged[key] = expandVariables(merged[key]!, lookup);
  }

  return merged;
}
