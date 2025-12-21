import { stepCountIs, streamText } from 'ai';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const csvProgram = createPadrone('csv')
  .command('read', (c) =>
    c.action(async () => {
      const content = await Bun.file('./src/test.csv').text();
      return content;
    }),
  )
  .command('grep', (c) =>
    c
      .options(
        z.object({
          pattern: z.string().describe('The pattern to search for'),
          ignoreCase: z.boolean().optional().default(false).describe('Ignore case when searching').meta({ alias: 'i' }),
        }),
        { positional: ['pattern'] },
      )
      .action(async (options) => {
        const { pattern, ignoreCase } = options;
        const content = await Bun.file('./src/test.csv').text();
        const lines = content.split('\n');
        const regex = new RegExp(pattern, ignoreCase ? 'i' : undefined);
        const matches = lines.filter((line) => regex.test(line));
        return matches.join('\n');
      }),
  );

try {
  const result = streamText({
    model: 'openai/gpt-5-nano',
    prompt: `What's the address of Pearl? Search for it using the csv tool.`,
    maxRetries: 0,
    tools: { csv: await csvProgram.tool() },
    toolChoice: 'auto',
    stopWhen: stepCountIs(5),
    onStepFinish: ({ toolCalls }) => {
      for (const toolCall of toolCalls) {
        console.log(`[Tool Called] ${toolCall.toolName}:`, toolCall.input);
      }
    },
  });

  console.log('\n');
  for await (const chunk of result.textStream) console.write(chunk);
  console.log('\n');
} catch (err) {
  console.error('Error during AI processing:', err);
}
