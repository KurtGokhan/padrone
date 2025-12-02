import { z } from 'zod';
import { createZodrun } from 'zodrun';

export const program = createZodrun()
  .command('greet', (c) =>
    c
      .args(z.array(z.string()).describe('Names to greet'))
      .options(
        z.object({
          prefix: z.string().optional().describe('prefix to use in greeting'),
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
              prefix: z.string().optional().describe('prefix to use in greeting'),
              suffix: z.string().optional().describe('suffix to use in greeting'),
            }),
          )
          .handle((args, options) => {
            const prefix = options?.prefix ? `${options.prefix} ` : '';
            args.forEach((name) => {
              console.log(`(Nested) Hello, ${prefix}${name}!`);
            });
          }),
      ),
  )
  .command('farewell', (c) =>
    c.handle(() => {
      console.log('Goodbye, World!');
    }),
  )
  .command('noop');

program.run('greet', ['John', 'Jake'], { prefix: 'Mr.' });
program.run('greet nested', ['John', 'Jake'], { prefix: 'Mr.', suffix: 'Esq.' });
program.run('farewell', undefined, undefined);
program.run('noop', undefined, undefined);
