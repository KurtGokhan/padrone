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
   */
  option: {
    type: 'option';
    key: string;
    value?: string;
  };
  /**
   * An alias option provided to the command, prefixed with `-`.
   * Which option it maps to cannot be determined until the command structure is known.
   */
  alias: {
    type: 'alias';
    key: string;
    value?: string;
  };
};

type ParsePart = ParseParts[keyof ParseParts];

export function parseCliInputToParts(input: string): ParsePart[] {
  const parts = input.trim().split(' ');
  const result: ParsePart[] = [];

  let pendingValue: ParseParts['option'] | ParseParts['alias'] | undefined;
  let allowTerm = true;

  for (const part of parts) {
    if (!part) continue;
    const wasPending = pendingValue;
    pendingValue = undefined;
    if (part.startsWith('--')) {
      const [key = '', value] = part.slice(2).split('=');

      const p = { type: 'option' as const, key, value };
      if (typeof value === 'undefined') pendingValue = p;
      result.push(p);
    } else if (part.startsWith('-')) {
      const [key = '', value] = part.slice(1).split('=');

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
