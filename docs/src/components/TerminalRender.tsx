import { useCallback, useMemo } from 'react';
import 'xterm/css/xterm.css';
import { tasksProgram } from '@padrone/tasks-example';
import WasmTerminal from '@wasmer/wasm-terminal';

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

export function TerminalRender() {
  const wasmTerminal = useMemo(
    () =>
      new WasmTerminal({
        fetchCommand: async ({ args }: { args: string[] }) => {
          const commandName = args[0];

          if (commandName === 'clear') {
            return () => wasmTerminal.xterm.clear();
          }

          if (commandName === 'tasks') {
            return async (options: any) => {
              const output: string[] = [];
              const originalLog = console.log;
              const originalError = console.error;
              const originalWarn = console.warn;

              console.log = (...args) => output.push(args.map(String).join(' '));
              console.error = (...args) => output.push(args.map(String).join(' '));
              console.warn = (...args) => output.push(args.map(String).join(' '));

              try {
                const result = await tasksProgram.cli(options.args.join(' '));
                const consoleOutput = output.join('\n');
                return consoleOutput + (result.result ? (consoleOutput ? '\n' : '') + result.result : '');
              } finally {
                console.log = originalLog;
                console.error = originalError;
                console.warn = originalWarn;
              }
            };
          }

          if (commandName === 'test') {
            const callbackCommand = async (options: any, wasmFs: any) => {
              return `Test Working! Options: ${JSON.stringify(options, null, 2)}, fs: ${JSON.stringify(wasmFs, null, 2)}`;
            };
            return callbackCommand;
          }

          return () => {
            return `Command not found: ${commandName}`;
          };
          // const wasmBinary = await fetchCommandFromWAPM({ args });
          // return await lowerI64Imports(wasmBinary);
        },
      }),
    [],
  );

  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;

      wasmTerminal.print('Welcome to Padrone terminal!\n');
      wasmTerminal.print('To try Padrone, type: tasks list\n\n');

      if (typeof window !== 'undefined') {
        window.process = {
          env: {},
          stdout: { isTTY: true },
        } as any;
      }

      wasmTerminal.wasmTty.xterm.options ??= {};
      wasmTerminal.wasmTty.xterm.options.theme = terminalTheme;
      wasmTerminal.wasmTty.xterm.options.fontSize = 14;
      wasmTerminal.wasmTty.xterm.options.lineHeight = 1.4;
      wasmTerminal.wasmTty.xterm.options.cursorBlink = true;
      wasmTerminal.wasmTty.xterm.options.cursorStyle = 'bar';
      wasmTerminal.open(el);
      wasmTerminal.fit();
      wasmTerminal.xterm.focus({ preventScroll: true });
    },
    [wasmTerminal],
  );

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
