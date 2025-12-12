import { createPadrone } from 'padrone';
import z from 'zod/v4';

export const program = createPadrone('example')
  .command('greet', (c) =>
    c
      .args(z.array(z.string()).describe('Names to greet'))
      .options(
        z.object({
          prefix: z
            .string()
            .optional()
            .describe('prefix to use in greeting')
            .meta({ alias: 'p', examples: ['Mr.', 'Dr.'] }),
          title: z
            .string()
            .optional()
            .describe('title to use in greeting')
            .meta({ deprecated: 'Use prefix instead' as any }),
        }),
      )
      .handle((args, options) => {
        const prefix = options?.prefix ? `${options.prefix} ` : '';
        args.forEach((name) => {
          console.log(`Hello, ${prefix}${name}!`);
        });
      })
      .command('nested', (c) =>
        c
          .args(z.array(z.string()).describe('Names to greet in nested command'))
          .options(
            z.object({
              prefix: z.string().optional().describe('prefix to use in greeting').meta({ alias: 'p' }),
              suffix: z.string().optional().describe('suffix to use in greeting'),
            }),
          )
          .handle((args, options) => {
            const prefix = options?.prefix ? `${options.prefix} ` : '';
            const suffix = options?.suffix ? ` ${options.suffix}` : '';
            args.forEach((name) => {
              console.log(`(Nested) Hello, ${prefix}${name}${suffix}!`);
            });
          }),
      ),
  )
  .command('farewell', (c) =>
    c
      .args(z.void())
      .options(z.void())
      .handle(() => {
        console.log('Goodbye, World!');
      }),
  )
  .command('noop', (c) => c.handle());

program.run('greet', ['John', 'Jake'], { prefix: 'Mr.' });
program.run('greet nested', ['John', 'Jake'], { prefix: 'Mr.', suffix: 'Esq.' });
program.run('farewell', undefined, undefined);
program.run('noop', undefined, undefined);

program.cli('greet nested John Jake -p Mr. --suffix Esq2.');

const api = program.api();

api.greet.nested(['Alice', 'Bob'], { prefix: 'Dr.', suffix: 'PhD' });

try {
  await program.cli();
} catch {}

console.log('\n\n---- HELP ----\n');
console.log(await program.help());

console.log('\n\n---- HELP (greet) ----\n');
console.log(await program.help('greet'));
