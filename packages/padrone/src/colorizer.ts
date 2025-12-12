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

export function createColorizer(): Colorizer {
  return {
    command: (text: string) => `${colors.cyan}${colors.bold}${text}${colors.reset}`,
    option: (text: string) => `${colors.green}${text}${colors.reset}`,
    type: (text: string) => `${colors.yellow}${text}${colors.reset}`,
    description: (text: string) => `${colors.dim}${text}${colors.reset}`,
    label: (text: string) => `${colors.bold}${text}${colors.reset}`,
    meta: (text: string) => `${colors.gray}${text}${colors.reset}`,
    example: (text: string) => `${colors.underline}${text}${colors.reset}`,
    exampleValue: (text: string) => `${colors.italic}${text}${colors.reset}`,
    deprecated: (text: string) => `${colors.strikethrough}${colors.gray}${text}${colors.reset}`,
  };
}
