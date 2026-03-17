import { tasksProgram } from '@padrone/tasks-example';
import { FitAddon, init, Terminal } from 'ghostty-web';
import { buildReplCompleter, REPL_SIGINT } from 'padrone';
import { useCallback, useRef } from 'react';

// Extract the internal command object from the program for building completions
const commandSymbol = Object.getOwnPropertySymbols(tasksProgram).find((s) => s.toString().includes('padrone'));
const tasksCommand = commandSymbol ? (tasksProgram as any)[commandSymbol] : undefined;
const tasksCompleter = tasksCommand ? buildReplCompleter(tasksCommand, { inScope: false }) : undefined;

const terminalTheme = {
  background: '#1a1b26',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  cursorAccent: '#1a1b26',
  selectionBackground: '#33467c',
  black: '#32344a',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#ad8ee6',
  cyan: '#449dab',
  white: '#9699a8',
  brightBlack: '#444b6a',
  brightRed: '#ff7a93',
  brightGreen: '#b9f27c',
  brightYellow: '#ff9e64',
  brightBlue: '#7da6ff',
  brightMagenta: '#bb9af7',
  brightCyan: '#0db9d7',
  brightWhite: '#acb0d0',
};

const PROMPT = '\x1b[32m$\x1b[0m ';

/**
 * Creates a line reader bound to a ghostty-web terminal.
 * Returns { readLine, onData } — wire onData into term.onData.
 */
function createTerminalLineReader(term: InstanceType<typeof Terminal>, completer?: (line: string) => [string[], string]) {
  let currentLine = '';
  let currentPrompt = '';
  let resolveInput: ((value: string | null) => void) | null = null;
  // Raw key listener for select/multiselect UIs — bypasses normal line editing
  let rawKeyListener: ((data: string) => void) | null = null;

  function redrawLine() {
    term.write(`\r\x1b[K${currentPrompt}${currentLine}`);
  }

  function onData(data: string) {
    if (rawKeyListener) {
      rawKeyListener(data);
      return;
    }
    if (!resolveInput) return;

    if (data === '\r') {
      term.write('\r\n');
      const line = currentLine;
      currentLine = '';
      resolveInput(line);
      resolveInput = null;
    } else if (data === '\x7f') {
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1);
        term.write('\b \b');
      }
    } else if (data === '\x03') {
      currentLine = '';
      term.write('^C\r\n');
      resolveInput(REPL_SIGINT as any);
      resolveInput = null;
    } else if (data === '\x04') {
      // Ctrl+D (EOF) — only on empty line, like a real terminal
      if (currentLine.length === 0) {
        term.write('\r\n');
        resolveInput(null);
        resolveInput = null;
      }
    } else if (data === '\t') {
      if (!completer) return;
      // For "tasks ..." input, complete after "tasks "
      const taskMatch = currentLine.match(/^tasks\s+(.*)/);
      if (taskMatch) {
        const [hits, prefix] = completer(taskMatch[1]!);
        if (hits.length === 1) {
          const completion = hits[0]!.slice(prefix.length);
          currentLine += completion;
          term.write(completion);
        } else if (hits.length > 1) {
          term.write('\r\n');
          term.writeln(hits.join('  '));
          redrawLine();
        }
      } else if (!currentLine || 'tasks'.startsWith(currentLine)) {
        const completion = 'tasks'.slice(currentLine.length);
        currentLine += completion;
        term.write(completion);
      }
    } else if (data >= ' ') {
      currentLine += data;
      term.write(data);
    }
  }

  function readLine(prompt: string): Promise<string | null> {
    currentPrompt = prompt;
    term.write(prompt);
    return new Promise<string | null>((resolve) => {
      resolveInput = resolve;
    });
  }

  function waitForKey(): Promise<string> {
    return new Promise<string>((resolve) => {
      rawKeyListener = (data: string) => {
        rawKeyListener = null;
        resolve(data);
      };
    });
  }

  return { readLine, onData, waitForKey };
}

type PromptConfig = {
  name: string;
  message: string;
  type: 'input' | 'confirm' | 'select' | 'multiselect' | 'password';
  choices?: { label: string; value: unknown }[];
  default?: unknown;
};

function createTerminalPrompt(
  term: InstanceType<typeof Terminal>,
  readLine: (prompt: string) => Promise<string | null>,
  waitForKey: () => Promise<string>,
) {
  return async (config: PromptConfig): Promise<unknown> => {
    const defaultHint = config.default != null ? ` \x1b[2m(${config.default})\x1b[0m` : '';

    if (config.type === 'input' || config.type === 'password') {
      const answer = await readLine(`\x1b[36m?\x1b[0m ${config.message}${defaultHint}: `);
      if (answer === null) return config.default;
      return answer || config.default;
    }

    if (config.type === 'confirm') {
      const hint = config.default ? ' (Y/n)' : ' (y/N)';
      const answer = await readLine(`\x1b[36m?\x1b[0m ${config.message}${hint}: `);
      if (answer === null) return config.default ?? false;
      const lower = answer.trim().toLowerCase();
      if (lower === 'y' || lower === 'yes') return true;
      if (lower === 'n' || lower === 'no') return false;
      return config.default ?? false;
    }

    if (config.type === 'select' && config.choices?.length) {
      const choices = config.choices;
      let selected = 0;

      const render = () => {
        // Move cursor up to overwrite previous render (except first time)
        term.write(`\x1b[36m?\x1b[0m ${config.message}\r\n`);
        for (let i = 0; i < choices.length; i++) {
          const cursor = i === selected ? '\x1b[36m❯\x1b[0m' : ' ';
          const label = i === selected ? `\x1b[1m${choices[i]!.label}\x1b[0m` : choices[i]!.label;
          term.write(`  ${cursor} ${label}\r\n`);
        }
      };

      const clear = () => {
        // Move up and clear all choice lines + question line
        for (let i = 0; i <= choices.length; i++) {
          term.write('\x1b[A\x1b[K');
        }
      };

      render();

      while (true) {
        const key = await waitForKey();
        if (key === '\x1b[A' && selected > 0) {
          selected--;
          clear();
          render();
        } else if (key === '\x1b[B' && selected < choices.length - 1) {
          selected++;
          clear();
          render();
        } else if (key === '\r') {
          clear();
          term.write(`\x1b[36m?\x1b[0m ${config.message}: \x1b[1m${choices[selected]!.label}\x1b[0m\r\n`);
          return choices[selected]!.value;
        } else if (key === '\x03') {
          clear();
          term.write(`\x1b[36m?\x1b[0m ${config.message}: \x1b[2mskipped\x1b[0m\r\n`);
          return config.default;
        }
      }
    }

    if (config.type === 'multiselect' && config.choices?.length) {
      const choices = config.choices;
      let cursor = 0;
      const toggled = new Set<number>();

      const render = () => {
        term.write(`\x1b[36m?\x1b[0m ${config.message} \x1b[2m(space to toggle, enter to confirm)\x1b[0m\r\n`);
        for (let i = 0; i < choices.length; i++) {
          const pointer = i === cursor ? '\x1b[36m❯\x1b[0m' : ' ';
          const check = toggled.has(i) ? '\x1b[32m✔\x1b[0m' : '○';
          const label = i === cursor ? `\x1b[1m${choices[i]!.label}\x1b[0m` : choices[i]!.label;
          term.write(`  ${pointer} ${check} ${label}\r\n`);
        }
      };

      const clear = () => {
        for (let i = 0; i <= choices.length; i++) {
          term.write('\x1b[A\x1b[K');
        }
      };

      render();

      while (true) {
        const key = await waitForKey();
        if (key === '\x1b[A' && cursor > 0) {
          cursor--;
          clear();
          render();
        } else if (key === '\x1b[B' && cursor < choices.length - 1) {
          cursor++;
          clear();
          render();
        } else if (key === ' ') {
          if (toggled.has(cursor)) toggled.delete(cursor);
          else toggled.add(cursor);
          clear();
          render();
        } else if (key === '\r') {
          const selected = choices.filter((_, i) => toggled.has(i));
          clear();
          const labels = selected.map((c) => c.label).join(', ') || 'none';
          term.write(`\x1b[36m?\x1b[0m ${config.message}: \x1b[1m${labels}\x1b[0m\r\n`);
          return selected.map((c) => c.value);
        } else if (key === '\x03') {
          clear();
          term.write(`\x1b[36m?\x1b[0m ${config.message}: \x1b[2mskipped\x1b[0m\r\n`);
          return config.default ?? [];
        }
      }
    }

    // Fallback
    const answer = await readLine(`\x1b[36m?\x1b[0m ${config.message}${defaultHint}: `);
    return answer || config.default;
  };
}

function termWrite(term: InstanceType<typeof Terminal>, text: string) {
  term.write(`${text.replace(/\n/g, '\r\n')}\r\n`);
}

function termError(term: InstanceType<typeof Terminal>, text: string) {
  term.write(`\x1b[31m${text.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
}

async function executeCommand(
  input: string,
  term: InstanceType<typeof Terminal>,
  readLine: (prompt: string) => Promise<string | null>,
  prompt: (config: PromptConfig) => Promise<unknown>,
): Promise<void> {
  const args = input.trim().split(/\s+/);
  const commandName = args[0];

  if (!commandName) return;

  if (commandName === 'clear') {
    term.clear();
    return;
  }

  if (commandName === 'tasks') {
    const taskArgv = args.slice(1);
    const program = tasksProgram.runtime({
      argv: () => taskArgv,
      output: (text) => termWrite(term, String(text)),
      error: (text: string) => termError(term, text),
      interactive: 'supported',
      readLine,
      prompt,
    });

    try {
      await (await program.cli())?.result;
    } catch {
      // Validation errors etc. are already printed via runtime.error
    }
    return;
  }

  termError(term, `Command not found: ${commandName}`);
}

async function initTerminal(el: HTMLDivElement) {
  await init();

  const term = new Terminal({
    fontSize: 14,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    fontFamily: 'Monaco, Menlo, "Courier New", monospace',
    theme: terminalTheme,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  term.open(el);
  fitAddon.fit();
  fitAddon.observeResize();
  term.focus();

  window.addEventListener('resize', () => fitAddon.fit());

  // Ghostty renders an absolutely-positioned textarea for input capture.
  // Ensure the container is the positioning ancestor so it stays inside the terminal.
  el.style.position = 'relative';
  el.style.caretColor = 'transparent';
  const textarea = el.querySelector('textarea');
  if (textarea) {
    textarea.style.pointerEvents = 'none';
    textarea.style.caretColor = 'transparent';
  }

  const { readLine, onData, waitForKey } = createTerminalLineReader(term, tasksCompleter);
  term.onData(onData);

  const prompt = createTerminalPrompt(term, readLine, waitForKey);

  term.writeln('Welcome to Padrone terminal!');
  term.writeln('To try Padrone, type: tasks list');
  term.writeln('For REPL mode, type: tasks --repl\r\n');

  // Shell loop
  while (true) {
    const line = await readLine(PROMPT);
    if (line === null) break;
    if (line === (REPL_SIGINT as any)) continue;
    if (!line.trim()) continue;
    await executeCommand(line, term, readLine, prompt);
  }
}

export function TerminalRender() {
  const initialized = useRef(false);

  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el || initialized.current) return;
    initialized.current = true;

    if (typeof window !== 'undefined') {
      window.process = {
        env: {},
        stdout: { isTTY: true },
      } as any;
    }

    void initTerminal(el);
  }, []);

  return (
    <div className="not-content scheme-dark w-full rounded-xl overflow-hidden shadow-2xl border border-[#2a2b3d]">
      <div className="bg-[#1a1b26] px-4 py-3 flex items-center gap-2 border-b border-[#2a2b3d]">
        <div className="size-3 rounded-full bg-[#f7768e]" />
        <div className="size-3 rounded-full bg-[#e0af68]" />
        <div className="size-3 rounded-full bg-[#9ece6a]" />
        <span className="ml-2 text-gray-300 text-sm font-medium">padrone terminal</span>
      </div>
      <div ref={ref} className="h-70 p-1 bg-[#1a1b26]" />
    </div>
  );
}
