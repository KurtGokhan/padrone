// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  strikethrough: '\x1b[9m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

// Check if colors should be enabled
function shouldUseColors(): boolean {
  if (typeof process === 'undefined') return false;

  // Respect NO_COLOR environment variable (standard: https://no-color.org/)
  if (process.env.NO_COLOR) return false;

  // Disable colors in CI environments
  // Most CI systems set CI=true or CI=1
  // This prevents ANSI color codes from appearing in CI logs
  if (process.env.CI) return false;

  // Check if stdout is a TTY (terminal)
  // If isTTY is explicitly false, we're in a non-interactive environment (pipes, redirects)
  // If isTTY is true, we're in an interactive terminal - enable colors
  if (process.stdout && typeof process.stdout.isTTY === 'boolean') return process.stdout.isTTY;

  // If TTY check is unavailable, default to false for safer behavior
  // This avoids color codes appearing in logs when output is piped or redirected
  return false;
}

export type Colorizer = {
  command: (text: string) => string;
  option: (text: string) => string;
  type: (text: string) => string;
  description: (text: string) => string;
  label: (text: string) => string;
  meta: (text: string) => string;
  example: (text: string) => string;
  exampleValue: (text: string) => string;
  deprecated: (text: string) => string;
};

export function createColorizer(colorize: boolean | 'auto' = 'auto'): Colorizer {
  const useColors = typeof colorize === 'boolean' ? colorize : shouldUseColors();

  return {
    command: (text: string) => (useColors ? `${colors.cyan}${colors.bold}${text}${colors.reset}` : text),
    option: (text: string) => (useColors ? `${colors.green}${text}${colors.reset}` : text),
    type: (text: string) => (useColors ? `${colors.yellow}${text}${colors.reset}` : text),
    description: (text: string) => (useColors ? `${colors.dim}${text}${colors.reset}` : text),
    label: (text: string) => (useColors ? `${colors.bold}${text}${colors.reset}` : text),
    meta: (text: string) => (useColors ? `${colors.gray}${text}${colors.reset}` : text),
    example: (text: string) => (useColors ? `${colors.underline}${text}${colors.reset}` : text),
    exampleValue: (text: string) => (useColors ? `${colors.italic}${text}${colors.reset}` : text),
    deprecated: (text: string) => (useColors ? `${colors.strikethrough}${colors.gray}${text}${colors.reset}` : text),
  };
}
