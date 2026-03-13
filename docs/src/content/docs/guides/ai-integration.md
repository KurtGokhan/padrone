---
title: AI Integration
description: Expose your CLI as an AI tool with Vercel AI SDK
---

Padrone provides first-class support for the [Vercel AI SDK](https://ai-sdk.dev/), allowing you to expose your CLI commands as tools that AI models can use.

## Overview

The `.tool()` method converts your Padrone program into a Vercel AI SDK compatible tool. This lets AI assistants:

- Understand your CLI's capabilities through the schema
- Execute commands with proper type validation
- Receive structured responses

## Basic Setup

```typescript
import { streamText } from 'ai';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

// Define your CLI
const weatherCli = createPadrone('weather')
  .command('current', (c) =>
    c
      .configure({ description: 'Get current weather for a city' })
      .arguments(
        z.object({
          city: z.string().describe('City name'),
          units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
        }),
        { positional: ['city'] }
      )
      .action(async (args) => {
        // Fetch weather data...
        return {
          city: args.city,
          temperature: 22,
          units: args.units,
          condition: 'Sunny',
        };
      })
  )
  .command('forecast', (c) =>
    c
      .configure({ description: 'Get weather forecast' })
      .arguments(
        z.object({
          city: z.string().describe('City name'),
          days: z.number().default(3).describe('Number of days'),
        }),
        { positional: ['city'] }
      )
      .action(async (args) => {
        return {
          city: args.city,
          forecast: [
            { day: 'Mon', temp: 22 },
            { day: 'Tue', temp: 24 },
            { day: 'Wed', temp: 20 },
          ].slice(0, args.days),
        };
      })
  );

// Convert to AI tool
const weatherTool = weatherCli.tool();
```

## Using with AI Models

Pass the tool to any Vercel AI SDK function:

```typescript
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const result = await streamText({
  model: anthropic('claude-sonnet-4-20250514'),
  prompt: "What's the weather like in London?",
  tools: {
    weather: weatherTool,
  },
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

The AI model will:
1. Understand the available commands from the tool schema
2. Choose the appropriate command (`weather current`)
3. Provide the required args (`city: 'London'`)
4. Execute the command and use the response

## Return Values

Your action handlers should return data that the AI can use:

```typescript
.action(async (args) => {
  // Return structured data for the AI
  return {
    status: 'success',
    data: { /* ... */ },
  };
})
```

The return value is passed back to the AI model, allowing it to incorporate the results into its response.

## Multiple Tools

You can provide multiple Padrone CLIs as separate tools:

```typescript
const weatherCli = createPadrone('weather').command(/* ... */);
const calendarCli = createPadrone('calendar').command(/* ... */);
const notesCli = createPadrone('notes').command(/* ... */);

const result = await streamText({
  model: yourModel,
  prompt: "Check the weather in Paris and add it to my calendar",
  tools: {
    weather: weatherCli.tool(),
    calendar: calendarCli.tool(),
    notes: notesCli.tool(),
  },
});
```

## Tool Schema

The `.tool()` method generates a JSON schema from your Zod definitions. The descriptions you provide with `.describe()` help the AI understand how to use each argument:

```typescript
z.object({
  city: z.string().describe('The name of the city to get weather for'),
  units: z.enum(['celsius', 'fahrenheit'])
    .default('celsius')
    .describe('Temperature units (celsius or fahrenheit)'),
})
```

Good descriptions improve AI accuracy when selecting and using your tools.

## Error Handling

Handle errors gracefully so the AI can respond appropriately:

```typescript
.action(async (args) => {
  try {
    const data = await fetchWeather(args.city);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Could not fetch weather for ${args.city}`,
    };
  }
})
```

## Real-World Example

Here's a complete example of a task management CLI exposed as an AI tool:

```typescript
import { streamText } from 'ai';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

const tasks = createPadrone('tasks')
  .command('add', (c) =>
    c
      .configure({ description: 'Add a new task' })
      .arguments(
        z.object({
          title: z.string().describe('Task title'),
          priority: z.enum(['low', 'medium', 'high']).default('medium'),
          dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
        }),
        { positional: ['title'] }
      )
      .action((args) => {
        // Save task to database...
        return { id: 'task-1', ...args, status: 'created' };
      })
  )
  .command('list', (c) =>
    c
      .configure({ description: 'List all tasks' })
      .arguments(
        z.object({
          status: z.enum(['all', 'pending', 'completed']).default('all'),
        })
      )
      .action((args) => {
        // Fetch from database...
        return {
          tasks: [
            { id: '1', title: 'Buy groceries', status: 'pending' },
            { id: '2', title: 'Call mom', status: 'completed' },
          ],
        };
      })
  )
  .command('complete', (c) =>
    c
      .configure({ description: 'Mark a task as completed' })
      .arguments(
        z.object({
          id: z.string().describe('Task ID'),
        }),
        { positional: ['id'] }
      )
      .action((args) => {
        return { id: args.id, status: 'completed' };
      })
  );

// Use with AI
const result = await streamText({
  model: yourModel,
  prompt: "Add a high priority task to buy milk, then show me all my tasks",
  tools: {
    tasks: tasks.tool(),
  },
  maxSteps: 5, // Allow multiple tool calls
});
```

## Compatibility

Padrone's AI integration requires:
- Vercel AI SDK 5.x or 6.x (peer dependency)
- Zod 3.25+ or 4.x

Install the AI SDK if you haven't already:

```bash
npm install ai @ai-sdk/anthropic
# or your preferred AI provider
```
