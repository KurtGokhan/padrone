import { useCallback, useMemo } from 'react';
import 'xterm/css/xterm.css';
import WasmTerminal, { fetchCommandFromWAPM } from '@wasmer/wasm-terminal';
import { lowerI64Imports } from '@wasmer/wasm-transformer';
import { createPadrone } from 'padrone';

const padrone = createPadrone('mycli')
  .version('0.1.0')
  .command('greet', (c) => c.action(() => 'Hello from Padrone!'));

export function Terminal() {
  const wasmTerminal = useMemo(() => {
    return new WasmTerminal({
      fetchCommand: async ({ args }: { args: string[] }) => {
        const commandName = args[0];

        if (commandName === 'clear') {
          return () => wasmTerminal.xterm.clear();
        }

        if (commandName === 'mycli') {
          return async (options: any) => {
            const result = await padrone.cli(options.args.join(' '));
            return result.result;
          };
        }

        if (commandName === 'test') {
          const callbackCommand = async (options: any, wasmFs: any) => {
            return `Test Working! Options: ${JSON.stringify(options, null, 2)}, fs: ${JSON.stringify(wasmFs, null, 2)}`;
          };
          return callbackCommand;
        }

        const wasmBinary = await fetchCommandFromWAPM({ args });

        return await lowerI64Imports(wasmBinary);
      },
    });
  }, []);

  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;

      wasmTerminal.print('Welcome to Padrone terminal!\n');
      wasmTerminal.print('To try Padrone, type: mycli greet\n\n');

      wasmTerminal.open(el);
      wasmTerminal.fit();
      wasmTerminal.focus();
    },
    [wasmTerminal],
  );

  return <div ref={ref} style={{ width: '100%', height: '300px' }} />;
}
