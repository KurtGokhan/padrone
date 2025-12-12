import { stepCountIs, streamText } from 'ai';
import { createWeatherProgram } from 'padrone/tests/common';

const weatherProgram = createWeatherProgram();

try {
  const result = streamText({
    model: 'openai/gpt-5-nano',
    prompt: `What's the weather like in London today? You can call current command with London as argument.`,
    maxRetries: 0,
    tools: { weather: await weatherProgram.tool() },
    toolChoice: 'auto',
    stopWhen: stepCountIs(5),
  });

  for await (const chunk of result.textStream) console.write(chunk);
} catch (err) {
  console.error('Error during AI processing:', err);
}
