import { suggestSimilar } from './command-utils.ts';

/**
 * Formats a list of candidate names into a "Did you mean ...?" string.
 * @param prefix — prepended to each name (e.g. `"--"` for options, `""` for commands).
 */
export function formatSuggestions(names: string[], prefix = ''): string {
  if (names.length === 0) return '';
  const quoted = names.map((n) => `"${prefix}${n}"`);
  if (quoted.length === 1) return `Did you mean ${quoted[0]}?`;
  return `Did you mean ${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}?`;
}

/**
 * Enriches Standard Schema issues with "Did you mean?" hints for unrecognized keys.
 * Returns a new array of issues where matching issues have updated messages.
 */
export function enrichIssuesWithSuggestions(
  issues: readonly { path?: readonly unknown[]; message: string }[],
  knownOptions: () => string[],
): typeof issues {
  return issues.map((i: any) => {
    const keys: string[] | undefined = i.keys ?? i.message?.match(/[Uu]nrecognized key(?:s)?[^"]*"([^"]+)"/)?.slice(1);
    if (!keys?.length) return i;
    const hints = keys.flatMap((k: string) => {
      const similar = suggestSimilar(k, knownOptions());
      return similar.length ? [formatSuggestions(similar, '--')] : [];
    });
    if (!hints.length) return i;
    return { ...i, message: `${i.message} ${hints.join(' ')}` };
  });
}

/**
 * Collects all "Did you mean?" suggestion strings from a set of issues.
 */
export function collectSuggestionsFromIssues(
  issues: readonly { path?: readonly unknown[]; message: string }[],
  knownOptions: () => string[],
): string[] {
  return issues.flatMap((i: any) => {
    const keys: string[] | undefined = i.keys ?? i.message?.match(/[Uu]nrecognized key(?:s)?[^"]*"([^"]+)"/)?.slice(1);
    if (!keys?.length) return [];
    return keys.flatMap((k: string) => {
      const similar = suggestSimilar(k, knownOptions());
      return similar.length ? [formatSuggestions(similar, '--')] : [];
    });
  });
}
