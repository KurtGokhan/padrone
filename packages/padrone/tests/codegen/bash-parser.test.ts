import { describe, expect, it } from 'bun:test';
import { parseBashCompletions } from 'padrone/codegen';

describe('parseBashCompletions', () => {
  it('should detect command name from complete -F', () => {
    const text = `
_mycli_completion() {
  COMPREPLY=()
}
complete -o default -F _mycli_completion mycli
`;
    const result = parseBashCompletions(text);
    expect(result.name).toBe('mycli');
  });

  it('should detect command name from marker comments', () => {
    const text = `
###-begin-myapp-completion-###
_myapp_completion() { :; }
###-end-myapp-completion-###
`;
    const result = parseBashCompletions(text);
    expect(result.name).toBe('myapp');
  });

  it('should parse options from local variable', () => {
    const text = `
_mycli_completion() {
  local args="--verbose --output --format --dry-run"
  COMPREPLY=($(compgen -W "$args" -- "$cur"))
}
complete -F _mycli_completion mycli
`;
    const result = parseBashCompletions(text);
    expect(result.arguments).toBeDefined();

    const verbose = result.arguments!.find((a) => a.name === 'verbose');
    expect(verbose).toBeDefined();
    expect(verbose?.type).toBe('string');

    const dryRun = result.arguments!.find((a) => a.name === 'dryRun');
    expect(dryRun).toBeDefined();
  });

  it('should parse subcommands from commands variable', () => {
    const text = `
_mycli_completion() {
  local commands="init build deploy"
  COMPREPLY=($(compgen -W "$commands" -- "$cur"))
}
complete -F _mycli_completion mycli
`;
    const result = parseBashCompletions(text);
    expect(result.subcommands).toBeDefined();
    expect(result.subcommands!.length).toBe(3);
    expect(result.subcommands!.map((s) => s.name)).toEqual(['init', 'build', 'deploy']);
  });

  it('should parse enum values from case statement', () => {
    const text = `
_mycli_completion() {
  local args="--format --env --verbose"

  case "$prev" in
    --format) COMPREPLY=($(compgen -W "json yaml toml" -- "$cur")); return 0 ;;
    --env) COMPREPLY=($(compgen -W "dev staging production" -- "$cur")); return 0 ;;
  esac

  COMPREPLY=($(compgen -W "$args" -- "$cur"))
}
complete -F _mycli_completion mycli
`;
    const result = parseBashCompletions(text);

    const format = result.arguments!.find((a) => a.name === 'format');
    expect(format?.type).toBe('enum');
    expect(format?.enumValues).toEqual(['json', 'yaml', 'toml']);

    const env = result.arguments!.find((a) => a.name === 'env');
    expect(env?.type).toBe('enum');
    expect(env?.enumValues).toEqual(['dev', 'staging', 'production']);

    // verbose has no case branch, so it should be ambiguous string
    const verbose = result.arguments!.find((a) => a.name === 'verbose');
    expect(verbose?.type).toBe('string');
    expect(verbose?.ambiguous).toBe(true);
  });

  it('should handle pipe-separated patterns in case statement', () => {
    const text = `
_mycli_completion() {
  local args="--format --fmt"
  case "$prev" in
    --format|--fmt) COMPREPLY=($(compgen -W "json yaml" -- "$cur")); return 0 ;;
  esac
}
complete -F _mycli_completion mycli
`;
    const result = parseBashCompletions(text);

    const format = result.arguments!.find((a) => a.name === 'format');
    expect(format?.type).toBe('enum');
    expect(format?.enumValues).toEqual(['json', 'yaml']);
  });

  it('should parse inline compgen word lists', () => {
    const text = `
_mycli_completion() {
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "--verbose --output" -- "$cur"))
  fi
}
complete -F _mycli_completion mycli
`;
    const result = parseBashCompletions(text);

    expect(result.arguments).toBeDefined();
    expect(result.arguments!.find((a) => a.name === 'verbose')).toBeDefined();
    expect(result.arguments!.find((a) => a.name === 'output')).toBeDefined();
  });

  it('should skip --help and --version builtins', () => {
    const text = `
_mycli_completion() {
  local args="--help --version --verbose"
}
complete -F _mycli_completion mycli
`;
    const result = parseBashCompletions(text);

    expect(result.arguments!.length).toBe(1);
    expect(result.arguments![0]!.name).toBe('verbose');
  });

  it('should handle complete with multiple -o flags', () => {
    const text = `
complete -o bashdefault -o default -o nospace -F _mycli_completion mycli
`;
    const result = parseBashCompletions(text);
    expect(result.name).toBe('mycli');
  });

  it('should handle empty input', () => {
    const result = parseBashCompletions('');
    expect(result.name).toBe('');
    expect(result.arguments).toBeUndefined();
  });

  it('should handle padrone-style completion scripts', () => {
    const text = `###-begin-myapp-completion-###
if type complete &>/dev/null; then
  _myapp_completion() {
    local cur prev words cword
    if type _get_comp_words_by_ref &>/dev/null; then
      _get_comp_words_by_ref -n = -n @ -n : -w words -i cword
    else
      cword="$COMP_CWORD"
      words=("\${COMP_WORDS[@]}")
    fi

    cur="\${words[cword]}"
    prev="\${words[cword-1]}"

    local commands="deploy list"
    local args="--env --format --verbose --count --status"

    case "$prev" in
      --env) COMPREPLY=($(compgen -W "staging production dev" -- "$cur")); return 0 ;;
      --format) COMPREPLY=($(compgen -W "json yaml toml" -- "$cur")); return 0 ;;
      --status) COMPREPLY=($(compgen -W "active archived" -- "$cur")); return 0 ;;
    esac

    if [[ "$cur" == -* ]]; then
      COMPREPLY=($(compgen -W "$args" -- "$cur"))
      return 0
    fi

    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
  }
  complete -o bashdefault -o default -o nospace -F _myapp_completion myapp
fi
###-end-myapp-completion-###`;

    const result = parseBashCompletions(text);

    expect(result.name).toBe('myapp');
    expect(result.subcommands!.length).toBe(2);
    expect(result.subcommands!.map((s) => s.name)).toEqual(['deploy', 'list']);

    const env = result.arguments!.find((a) => a.name === 'env');
    expect(env?.type).toBe('enum');
    expect(env?.enumValues).toEqual(['staging', 'production', 'dev']);

    const format = result.arguments!.find((a) => a.name === 'format');
    expect(format?.type).toBe('enum');
    expect(format?.enumValues).toEqual(['json', 'yaml', 'toml']);

    const verbose = result.arguments!.find((a) => a.name === 'verbose');
    expect(verbose?.type).toBe('string');
    expect(verbose?.ambiguous).toBe(true);

    const count = result.arguments!.find((a) => a.name === 'count');
    expect(count).toBeDefined();
  });
});
