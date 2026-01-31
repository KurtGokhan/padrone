type ParseParts = {
  /**
   * An alphanumeric term representing a command, subcommand, or positional argument.
   * Note that a term can be ambiguous until fully matched within the command hierarchy.
   * We cannot fully distinguish between a nested command or a positional argument until
   * the command structure is known.
   */
  term: {
    type: 'term';
    value: string;
  };
  /**
   * A positional argument provided to the command.
   * Unlike `term`, this is definitively an argument. This can be determined when
   * the argument is non-alphanumeric, like a path or a number.
   */
  arg: {
    type: 'arg';
    value: string;
  };
  /**
   * An option provided to the command, prefixed with `--`.
   * If the option has an `=` sign, the value after it is used as the option's value.
   * Otherwise, the value is obtained from the next part or set to `true` if no value is provided.
   * The key is an array representing the path for nested options (e.g., `--user.id=123` becomes `['user', 'id']`).
   */
  option: {
    type: 'option';
    key: string[];
    value?: string | string[];
    negated?: boolean;
  };
  /**
   * An alias option provided to the command, prefixed with `-`.
   * Which option it maps to cannot be determined until the command structure is known.
   * Aliases cannot be nested, so the key is always a single-element array.
   */
  alias: {
    type: 'alias';
    key: string[];
    value?: string | string[];
  };
};

type ParsePart = ParseParts[keyof ParseParts];

/**
 * Tokenizes input string respecting quoted strings and bracket arrays.
 * Supports single quotes, double quotes, backticks, and square brackets.
 */
function tokenizeInput(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | '`' | null = null;
  let bracketDepth = 0;
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (inQuote) {
      // Check for escape sequences within quotes
      if (char === '\\' && i + 1 < input.length) {
        const nextChar = input[i + 1];
        // Handle escape sequences
        if (nextChar === inQuote || nextChar === '\\') {
          current += nextChar;
          i += 2;
          continue;
        }
      }

      if (char === inQuote) {
        // End of quoted string
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '[') {
      bracketDepth++;
      current += char;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
    } else if (bracketDepth > 0) {
      // Inside brackets - include everything including spaces
      current += char;
    } else if (char === '"' || char === "'" || char === '`') {
      // Start of quoted string
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      // Whitespace outside quotes and brackets - end current token
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
    i++;
  }

  // Add the last token if any
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseCliInputToParts(input: string): ParsePart[] {
  const parts = tokenizeInput(input.trim());
  const result: ParsePart[] = [];

  let pendingValue: ParseParts['option'] | ParseParts['alias'] | undefined;
  let allowTerm = true;

  for (const part of parts) {
    if (!part) continue;
    const wasPending = pendingValue;
    pendingValue = undefined;

    if (part.startsWith('--no-') && part.length > 5) {
      // Negated boolean option (--no-verbose or --no-config.debug)
      const keyStr = part.slice(5);
      const key = keyStr.split('.');
      const p = { type: 'option' as const, key, value: undefined, negated: true };
      result.push(p);
    } else if (part.startsWith('--')) {
      const [keyStr = '', value] = splitOptionValue(part.slice(2));
      const key = keyStr.split('.');

      const p = { type: 'option' as const, key, value };
      if (typeof value === 'undefined') pendingValue = p;
      result.push(p);
    } else if (part.startsWith('-') && part.length > 1 && !/^-\d/.test(part)) {
      // Short option (but not negative numbers like -5)
      // Aliases cannot be nested, so key is always a single-element array
      const [keyStr = '', value] = splitOptionValue(part.slice(1));
      const key = [keyStr];

      const p = { type: 'alias' as const, key, value };
      if (typeof value === 'undefined') pendingValue = p;
      result.push(p);
    } else if (wasPending) {
      wasPending.value = part;
    } else if (/^[a-zA-Z0-9_-]+$/.test(part) && allowTerm) {
      result.push({ type: 'term', value: part });
    } else {
      result.push({ type: 'arg', value: part });
      allowTerm = false;
    }
  }
  return result;
}

/**
 * Split option key and value, handling quoted values after =.
 */
function splitOptionValue(str: string): [string, string | string[] | undefined] {
  const eqIndex = str.indexOf('=');
  if (eqIndex === -1) return [str, undefined];

  const key = str.slice(0, eqIndex);
  let value = str.slice(eqIndex + 1);

  // Remove surrounding quotes from value if present
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('`') && value.endsWith('`'))
  ) {
    value = value.slice(1, -1);
    return [key, value];
  }

  // Handle array syntax: [a,b,c] -> ['a', 'b', 'c']
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1);
    if (inner === '') return [key, []];
    const items = parseArrayItems(inner);
    return [key, items];
  }

  return [key, value];
}

/**
 * Sets a value at a nested path in an object.
 * For example: setNestedValue(obj, ['user', 'profile', 'name'], 'John')
 * Creates intermediate objects as needed.
 */
export function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const part = path[i]!;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = path[path.length - 1]!;
  current[lastPart] = value;
}

/**
 * Gets a value at a nested path in an object.
 * Returns undefined if the path doesn't exist.
 */
export function getNestedValue(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;

  for (const part of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Parse comma-separated items, respecting quotes within items.
 */
function parseArrayItems(input: string): string[] {
  const items: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | '`' | null = null;
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (inQuote) {
      if (char === '\\' && i + 1 < input.length && input[i + 1] === inQuote) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'" || char === '`') {
      inQuote = char;
    } else if (char === ',') {
      items.push(current.trim());
      current = '';
    } else {
      current += char;
    }
    i++;
  }

  // Add the last item
  if (current || items.length > 0) {
    items.push(current.trim());
  }

  return items;
}
