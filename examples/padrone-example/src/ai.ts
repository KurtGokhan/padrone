import { stepCountIs, streamText } from 'ai';
import { tasksProgram } from './tasks.ts';

// This demo shows how to expose the task manager CLI as an AI tool.
// The AI can then understand natural language requests and execute task commands.
//
// Example prompts:
// - "Add a high priority task to prepare the presentation for Monday"
// - "Show me all my pending tasks"
// - "Mark task-3 as completed"
// - "What tasks do I have tagged with 'work'?"

const prompt = process.argv[2] || 'Show me all my pending high priority tasks';

console.log(`## Prompt\n`);
console.log(prompt);

try {
  const result = streamText({
    // Replace with your preferred model (e.g., 'anthropic/claude-sonnet-4-20250514', 'openai/gpt-4')
    model: 'anthropic/claude-sonnet-4-20250514',
    prompt,
    maxRetries: 0,
    tools: { tasks: await tasksProgram.tool() },
    toolChoice: 'auto',
    stopWhen: stepCountIs(5),
    onStepFinish: ({ toolCalls, toolResults }) => {
      for (const toolCall of toolCalls) {
        console.log(`\n[Tool Call] ${toolCall.toolName}:`);
        console.log('\n```json');
        console.log(JSON.stringify(toolCall.input, null, 2));
        console.log('```\n');
      }
      for (const result of toolResults) {
        console.log(`[Tool Result]:`);
        console.log('\n```json');
        console.log(JSON.stringify(result.output, null, 2));
        console.log('```\n');
      }
    },
  });

  console.log('\n## AI Response\n');
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  console.log('\n');
} catch (err) {
  console.error('Error during AI processing:', err);
  console.log('\nNote: This demo requires an AI provider API key.');
  console.log('Set your API key environment variable (e.g., ANTHROPIC_API_KEY or OPENAI_API_KEY)');
}
