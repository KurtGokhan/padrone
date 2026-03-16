import { tasksProgram } from '@padrone/tasks-example';
import { FitAddon, init, Terminal } from 'ghostty-web';
import { useCallback, useRef } from 'react';

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
function createTerminalLineReader(term: InstanceType<typeof Terminal>) {
  let currentLine = '';
  let resolveInput: ((value: string | null) => void) | null = null;

  function onData(data: string) {
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
      resolveInput(null);
      resolveInput = null;
    } else if (data >= ' ') {
      currentLine += data;
      term.write(data);
    }
  }

  function readLine(prompt: string): Promise<string | null> {
    term.write(prompt);
    return new Promise<string | null>((resolve) => {
      resolveInput = resolve;
    });
  }

  return { readLine, onData };
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
      output: (text: string) => termWrite(term, text),
      error: (text: string) => termError(term, text),
      interactive: 'disabled',
      readLine,
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

  const { readLine, onData } = createTerminalLineReader(term);
  term.onData(onData);

  term.writeln('Welcome to Padrone terminal!');
  term.writeln('To try Padrone, type: tasks list');
  term.writeln('For REPL mode, type: tasks --repl\r\n');

  // Shell loop
  while (true) {
    const line = await readLine(PROMPT);
    if (line === null) break;
    if (!line.trim()) continue;
    await executeCommand(line, term, readLine);
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
