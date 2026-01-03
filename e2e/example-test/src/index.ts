import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

export const program = createPadrone('example')
  .configure({
    description: 'An example CLI application built with Padrone',
    version: '1.0.0',
  })
  .command('greet', (c) =>
    c
      .configure({
        title: 'Greet People',
        description: 'Send greetings to one or more people with optional prefix and title',
        aliases: 'hello', // Command alias
      })
      .options(
        z.object({
          names: z.array(z.string()).describe('Names to greet'),
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
        {
          positional: ['...names'],
        },
      )
      .action((options) => {
        const prefix = options?.prefix ? `${options.prefix} ` : '';
        options.names.forEach((name) => {
          console.log(`Hello, ${prefix}${name}!`);
        });
      })
      .command('nested', (c) =>
        c
          .configure({
            title: 'Nested Greet',
            description: 'A nested greeting command with additional suffix option',
            aliases: 'sub', // Nested command alias
          })
          .options(
            z.object({
              names: z.array(z.string()).describe('Names to greet'),
              prefix: z.string().optional().describe('prefix to use in greeting').meta({ alias: 'p' }),
              suffix: z.string().optional().describe('suffix to use in greeting'),
            }),
            {
              positional: ['...names'],
            },
          )
          .action((options) => {
            const prefix = options?.prefix ? `${options.prefix} ` : '';
            const suffix = options?.suffix ? ` ${options.suffix}` : '';
            options.names.forEach((name) => {
              console.log(`(Nested) Hello, ${prefix}${name}${suffix}!`);
            });
          }),
      ),
  )
  .command('farewell', (c) =>
    c
      .configure({
        title: 'Say Goodbye',
        deprecated: 'Use "goodbye" command instead',
      })
      .action(() => {
        console.log('Goodbye, World!');
      }),
  )
  .command('goodbye', (c) =>
    c
      .configure({
        title: 'Say Goodbye',
        description: 'The new way to say goodbye',
      })
      .action(() => {
        console.log('Goodbye, World!');
      }),
  )
  .command('hidden-cmd', (c) =>
    c
      .configure({
        hidden: true,
        description: 'This command is hidden from help',
      })
      .action(() => {
        console.log('You found the secret command!');
      }),
  )
  .command('noop', (c) => c.action());

program.run('greet', { names: ['John', 'Jake'], prefix: 'Mr.' });
program.run('greet nested', { names: ['John', 'Jake'], prefix: 'Mr.', suffix: 'Esq.' });
program.run('farewell', undefined);
program.run('noop', undefined);

program.cli('greet nested John Jake -p Mr. --suffix Esq2.');

const api = program.api();

api.greet.nested({ names: ['Alice', 'Bob'], prefix: 'Dr.', suffix: 'PhD' });

try {
  await program.cli();
} catch {}

console.log('\n\n---- HELP ----\n');
console.log(await program.help());

console.log('\n\n---- HELP (greet) ----\n');
console.log(await program.help('greet'));
