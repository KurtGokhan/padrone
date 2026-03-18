import type { ResolvedPadroneRuntime } from './runtime.ts';

/**
 * Configuration for the update check feature.
 */
export type UpdateCheckConfig = {
  /**
   * The npm package name to check. Defaults to the program name.
   */
  packageName?: string;
  /**
   * Registry to check for updates.
   * - `'npm'` — checks the npm registry (default)
   * - A URL string — custom registry endpoint that returns JSON with a `version` or `dist-tags.latest` field
   */
  registry?: 'npm' | string;
  /**
   * How often to check for updates. Accepts shorthand like `'1d'`, `'12h'`, `'30m'`.
   * Defaults to `'1d'` (once per day).
   */
  interval?: string;
  /**
   * Path to the cache file for storing the last check timestamp and latest version.
   * Defaults to `~/.config/<programName>-update-check.json`.
   */
  cache?: string;
  /**
   * Environment variable name to disable update checks (e.g. `'MYAPP_NO_UPDATE_CHECK'`).
   * When set to a truthy value, update checks are skipped.
   * Defaults to `'<PROGRAM_NAME>_NO_UPDATE_CHECK'` (uppercased, hyphens to underscores).
   */
  disableEnvVar?: string;
};

type CacheData = {
  lastCheck: number;
  latestVersion: string;
};

/**
 * Parses an interval string like '1d', '12h', '30m', '1w' into milliseconds.
 */
export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)\s*(ms|s|m|h|d|w)$/);
  if (!match) return 86_400_000; // default 1d

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    case 'd':
      return value * 86_400_000;
    case 'w':
      return value * 604_800_000;
    default:
      return 86_400_000;
  }
}

/**
 * Compares two semver version strings.
 * Returns true if `latest` is newer than `current`.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => {
    const cleaned = v.replace(/^v/, '');
    const parts = cleaned.split('-');
    const nums = parts[0]!.split('.').map(Number);
    return { major: nums[0] ?? 0, minor: nums[1] ?? 0, patch: nums[2] ?? 0, prerelease: parts[1] };
  };

  const c = parse(current);
  const l = parse(latest);

  // Don't notify about pre-release versions unless user is already on a pre-release
  if (l.prerelease && !c.prerelease) return false;

  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  if (l.patch !== c.patch) return l.patch > c.patch;
  return false;
}

/**
 * Reads the update check cache file.
 */
function readCache(cachePath: string): CacheData | undefined {
  try {
    const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs');
    if (!existsSync(cachePath)) return undefined;
    const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
    if (typeof data.lastCheck === 'number' && typeof data.latestVersion === 'string') {
      return data as CacheData;
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

/**
 * Writes the update check cache file.
 */
function writeCache(cachePath: string, data: CacheData): void {
  try {
    const { existsSync, mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    const { dirname } = require('node:path') as typeof import('node:path');
    const dir = dirname(cachePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
  } catch {
    // Ignore errors — cache is best-effort
  }
}

/**
 * Resolves the cache path, expanding `~` to the home directory.
 */
function resolveCachePath(cachePath: string): string {
  const { homedir } = require('node:os') as typeof import('node:os');
  const { resolve } = require('node:path') as typeof import('node:path');
  if (cachePath.startsWith('~')) {
    return cachePath.replace('~', homedir());
  }
  return resolve(cachePath);
}

/**
 * Fetches the latest version from the registry.
 */
async function fetchLatestVersion(packageName: string, registry: string): Promise<string | undefined> {
  const url = registry === 'npm' ? `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest` : registry;

  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const data = (await response.json()) as Record<string, unknown>;

    // npm registry returns { version: "x.y.z" }
    if (typeof data.version === 'string') return data.version;

    // Custom endpoint may return { "dist-tags": { latest: "x.y.z" } }
    const distTags = data['dist-tags'] as Record<string, string> | undefined;
    if (distTags?.latest) return distTags.latest;
  } catch {
    // Network errors are expected (offline, firewall, etc.)
  }
  return undefined;
}

/**
 * Formats the update notification message.
 */
export function formatUpdateMessage(currentVersion: string, latestVersion: string, packageName: string): string {
  const updateCommand = `npm update -g ${packageName}`;
  return `\n  Update available: ${currentVersion} \u2192 ${latestVersion}\n  Run "${updateCommand}" to update\n`;
}

/**
 * Checks for updates in the background. Returns a function that, when called,
 * prints the update notification if a newer version was found.
 *
 * This is designed to be non-blocking: the check starts immediately but the
 * result is only consumed after command execution completes.
 */
export function createUpdateChecker(
  programName: string,
  currentVersion: string,
  config: UpdateCheckConfig,
  runtime: ResolvedPadroneRuntime,
): () => void {
  const packageName = config.packageName ?? programName;
  const registry = config.registry ?? 'npm';
  const intervalMs = parseInterval(config.interval ?? '1d');
  const disableEnvVar = config.disableEnvVar ?? `${programName.toUpperCase().replace(/-/g, '_')}_NO_UPDATE_CHECK`;

  const defaultCachePath = `~/.config/${programName}-update-check.json`;
  const cachePath = resolveCachePath(config.cache ?? defaultCachePath);

  // Check if disabled
  const env = runtime.env();
  if (env.CI || env.CONTINUOUS_INTEGRATION) return noop;
  if (env[disableEnvVar]) return noop;
  if (typeof process !== 'undefined' && !process.stdout?.isTTY) return noop;

  // Check cache — if we checked recently, use cached result
  const cached = readCache(cachePath);
  if (cached && Date.now() - cached.lastCheck < intervalMs) {
    // Use cached version for display
    if (isNewerVersion(currentVersion, cached.latestVersion)) {
      return () => {
        runtime.error(formatUpdateMessage(currentVersion, cached.latestVersion, packageName));
      };
    }
    return noop;
  }

  // Start background fetch
  const fetchPromise = fetchLatestVersion(packageName, registry).then((latestVersion) => {
    if (latestVersion) {
      writeCache(cachePath, { lastCheck: Date.now(), latestVersion });
      if (isNewerVersion(currentVersion, latestVersion)) {
        return latestVersion;
      }
    }
    return undefined;
  });

  // Return a function that blocks on the result (briefly — the fetch should be done by now)
  let resolved: string | undefined | null = null; // null = not yet resolved
  fetchPromise.then(
    (v) => {
      resolved = v;
    },
    () => {
      resolved = undefined;
    },
  );

  return () => {
    // If the fetch already resolved, use the result synchronously
    if (resolved !== null) {
      if (resolved) {
        runtime.error(formatUpdateMessage(currentVersion, resolved, packageName));
      }
      return;
    }

    // Otherwise, we can't block — just skip this time.
    // The cache will be written when the promise resolves, so next invocation will show the message.
  };
}

function noop() {}
