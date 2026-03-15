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

async function executeCommand(input: string): Promise<string> {
  const args = input.trim().split(/\s+/);
  const commandName = args[0];

  if (!commandName) return '';

  if (commandName === 'clear') return '\x1b[CLEAR]';

  if (commandName === 'tasks') {
    const output: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...a) => output.push(a.map(String).join(' '));
    console.error = (...a) => output.push(a.map(String).join(' '));
    console.warn = (...a) => output.push(a.map(String).join(' '));

    try {
      const result = await tasksProgram.eval(args.slice(1).join(' '));
      const consoleOutput = output.join('\n');
      return consoleOutput + (result.result ? (consoleOutput ? '\n' : '') + result.result : '');
    } finally {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    }
  }

  return `Command not found: ${commandName}`;
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

  let currentLine = '';
  let busy = false;
  const history: string[] = [];
  let historyIndex = -1;

  function writePrompt() {
    term.write(PROMPT);
  }

  term.writeln('Welcome to Padrone terminal!');
  term.writeln('To try Padrone, type: tasks list\r\n');
  writePrompt();

  term.onData((data: string) => {
    if (busy) return;

    if (data === '\r') {
      term.write('\r\n');
      const input = currentLine;
      if (input.trim()) history.push(input.trim());
      historyIndex = -1;
      currentLine = '';
      if (!input.trim()) {
        writePrompt();
        return;
      }
      busy = true;
      executeCommand(input).then((output) => {
        if (output === '\x1b[CLEAR]') {
          term.clear();
        } else if (output) {
          term.writeln(output.replace(/\n/g, '\r\n'));
        }
        busy = false;
        writePrompt();
      });
    } else if (data === '\x7f') {
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1);
        term.write('\b \b');
      }
    } else if (data === '\x03') {
      currentLine = '';
      term.write('^C\r\n');
      writePrompt();
    } else if (data === '\x1b[A') {
      if (history.length > 0) {
        if (historyIndex === -1) historyIndex = history.length;
        if (historyIndex > 0) {
          historyIndex--;
          term.write('\r\x1b[K');
          writePrompt();
          currentLine = history[historyIndex]!;
          term.write(currentLine);
        }
      }
    } else if (data === '\x1b[B') {
      if (historyIndex !== -1) {
        historyIndex++;
        term.write('\r\x1b[K');
        writePrompt();
        if (historyIndex < history.length) {
          currentLine = history[historyIndex]!;
          term.write(currentLine);
        } else {
          historyIndex = -1;
          currentLine = '';
        }
      }
    } else if (data >= ' ') {
      currentLine += data;
      term.write(data);
    }
  });
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
