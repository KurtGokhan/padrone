import { describe, expect, it, mock } from 'bun:test';
import type { InteractivePromptConfig } from 'padrone';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { createConsoleMocker } from './console-mocker.ts';

describe('Interactive', () => {
  createConsoleMocker();

  function createMockPrompt(responses: Record<string, unknown>) {
    return mock(async (config: InteractivePromptConfig) => {
      return responses[config.name];
    });
  }

  describe('interactive: true (all required fields)', () => {
    it('should prompt for missing required fields', async () => {
      const promptFn = createMockPrompt({ name: 'Alice', template: 'react' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                template: z.enum(['react', 'vue', 'svelte']),
                verbose: z.boolean().default(false),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      const result = await program.eval('init');

      expect(result.args).toEqual({ name: 'Alice', template: 'react', verbose: false });
      // Should have prompted for name and template (required fields missing)
      expect(promptFn).toHaveBeenCalledTimes(2);
      expect(promptFn.mock.calls[0]![0].name).toBe('name');
      expect(promptFn.mock.calls[1]![0].name).toBe('template');
    });

    it('should not prompt for fields already provided via CLI', async () => {
      const promptFn = createMockPrompt({ template: 'vue' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                template: z.enum(['react', 'vue', 'svelte']),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      const result = await program.eval('init --name Alice');

      expect(result.args).toEqual({ name: 'Alice', template: 'vue' });
      // Only template should be prompted (name was provided)
      expect(promptFn).toHaveBeenCalledTimes(1);
      expect(promptFn.mock.calls[0]![0].name).toBe('template');
    });

    it('should not prompt when all required fields are provided', async () => {
      const promptFn = createMockPrompt({});

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                template: z.enum(['react', 'vue', 'svelte']),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      const result = await program.eval('init --name Alice --template react');

      expect(result.args).toEqual({ name: 'Alice', template: 'react' });
      expect(promptFn).not.toHaveBeenCalled();
    });
  });

  describe('interactive: string[] (specific fields)', () => {
    it('should only prompt for specified fields', async () => {
      const promptFn = createMockPrompt({ name: 'Bob' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                template: z.enum(['react', 'vue', 'svelte']),
              }),
              { interactive: ['name'] },
            )
            .action((args) => args),
        );

      // template is missing but not in interactive list, so it won't be prompted
      const result = await program.eval('init --template react');

      expect(result.args).toEqual({ name: 'Bob', template: 'react' });
      expect(promptFn).toHaveBeenCalledTimes(1);
      expect(promptFn.mock.calls[0]![0].name).toBe('name');
    });
  });

  describe('optionalInteractive', () => {
    it('should show multiselect for optional fields after required prompts', async () => {
      const promptFn = mock(async (config: InteractivePromptConfig) => {
        if (config.name === 'name') return 'Alice';
        if (config.name === '_optionalFields') return ['verbose']; // user selects verbose
        if (config.name === 'verbose') return true;
        return undefined;
      });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                verbose: z.boolean().default(false),
                debug: z.boolean().default(false),
              }),
              {
                interactive: ['name'],
                optionalInteractive: ['verbose', 'debug'],
              },
            )
            .action((args) => args),
        );

      const result = await program.eval('init');

      expect(result.args).toEqual({ name: 'Alice', verbose: true, debug: false });
      // 3 calls: name prompt, multiselect for optional, verbose prompt
      expect(promptFn).toHaveBeenCalledTimes(3);
      expect(promptFn.mock.calls[0]![0].name).toBe('name');
      expect(promptFn.mock.calls[1]![0].type).toBe('multiselect');
      expect(promptFn.mock.calls[2]![0].name).toBe('verbose');
    });

    it('should skip optional prompts when user selects none', async () => {
      const promptFn = mock(async (config: InteractivePromptConfig) => {
        if (config.name === 'name') return 'Alice';
        if (config.name === '_optionalFields') return []; // user selects nothing
        return undefined;
      });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                verbose: z.boolean().default(false),
              }),
              {
                interactive: ['name'],
                optionalInteractive: ['verbose'],
              },
            )
            .action((args) => args),
        );

      const result = await program.eval('init');

      expect(result.args).toEqual({ name: 'Alice', verbose: false });
      // 2 calls: name prompt, multiselect (no individual optional prompts)
      expect(promptFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('prompt type auto-detection', () => {
    it('should detect confirm for boolean fields', async () => {
      const promptFn = createMockPrompt({ verbose: true });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('run', (c) => c.arguments(z.object({ verbose: z.boolean() }), { interactive: ['verbose'] }).action((args) => args));

      await program.eval('run');

      expect(promptFn.mock.calls[0]![0].type).toBe('confirm');
    });

    it('should detect select for enum fields', async () => {
      const promptFn = createMockPrompt({ template: 'react' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('run', (c) =>
          c.arguments(z.object({ template: z.enum(['react', 'vue', 'svelte']) }), { interactive: ['template'] }).action((args) => args),
        );

      await program.eval('run');

      const config = promptFn.mock.calls[0]![0];
      expect(config.type).toBe('select');
      expect(config.choices).toEqual([
        { label: 'react', value: 'react' },
        { label: 'vue', value: 'vue' },
        { label: 'svelte', value: 'svelte' },
      ]);
    });

    it('should use description as prompt message', async () => {
      const promptFn = createMockPrompt({ name: 'test' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('run', (c) =>
          c.arguments(z.object({ name: z.string().describe('Project name') }), { interactive: ['name'] }).action((args) => args),
        );

      await program.eval('run');

      expect(promptFn.mock.calls[0]![0].message).toBe('Project name');
    });

    it('should prefer field meta description over schema description', async () => {
      const promptFn = createMockPrompt({ name: 'test' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('run', (c) =>
          c
            .arguments(z.object({ name: z.string().describe('Schema description') }), {
              interactive: ['name'],
              fields: { name: { description: 'Meta description' } },
            })
            .action((args) => args),
        );

      await program.eval('run');

      expect(promptFn.mock.calls[0]![0].message).toBe('Meta description');
    });
  });

  describe('force interactive', () => {
    it('should prompt for already-provided fields when forceInteractive option is true', async () => {
      const promptFn = createMockPrompt({ name: 'Bob', template: 'vue' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                template: z.enum(['react', 'vue', 'svelte']),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      const result = await program.eval('init --name Alice --template react', { interactive: true });

      // Should have prompted for both fields even though they were provided
      expect(promptFn).toHaveBeenCalledTimes(2);
      // Should use prompted values
      expect(result.args).toEqual({ name: 'Bob', template: 'vue' });
    });

    it('should use current values as defaults when forcing', async () => {
      const configs: InteractivePromptConfig[] = [];
      const promptFn = mock(async (config: InteractivePromptConfig) => {
        configs.push(config);
        return config.default; // Return the default (current value)
      });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                template: z.enum(['react', 'vue', 'svelte']),
              }),
              { interactive: ['name', 'template'] },
            )
            .action((args) => args),
        );

      const result = await program.eval('init --name Alice --template react', { interactive: true });

      // Current values should be passed as defaults
      expect(configs[0]!.default).toBe('Alice');
      expect(configs[1]!.default).toBe('react');
      expect(result.args).toEqual({ name: 'Alice', template: 'react' });
    });

    it('should force via --interactive flag', async () => {
      const promptFn = createMockPrompt({ name: 'Bob' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: ['name'] },
            )
            .action((args) => args),
        );

      const result = await program.eval('init --name Alice --interactive');

      expect(promptFn).toHaveBeenCalledTimes(1);
      expect(result.args).toEqual({ name: 'Bob' });
    });

    it('should force via -i flag', async () => {
      const promptFn = createMockPrompt({ name: 'Bob' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: ['name'] },
            )
            .action((args) => args),
        );

      const result = await program.eval('init --name Alice -i');

      expect(promptFn).toHaveBeenCalledTimes(1);
      expect(result.args).toEqual({ name: 'Bob' });
    });

    it('should suppress via --no-interactive flag', async () => {
      const promptFn = createMockPrompt({ name: 'Alice' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: ['name'] },
            )
            .action((args) => args),
        );

      const result = await program.eval('init --no-interactive');

      expect(promptFn).not.toHaveBeenCalled();
      expect(result.argsResult?.issues).toBeDefined();
    });

    it('should suppress via -i false flag', async () => {
      const promptFn = createMockPrompt({ name: 'Alice' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: ['name'] },
            )
            .action((args) => args),
        );

      const result = await program.eval('init -i false');

      expect(promptFn).not.toHaveBeenCalled();
      expect(result.argsResult?.issues).toBeDefined();
    });

    it('should not consume -i flag when command has no interactive config', async () => {
      const program = createPadrone('test')
        .runtime({ interactive: 'forced' })
        .command('run', (c) =>
          c
            .arguments(
              z.object({
                input: z.string().meta({ flags: 'i' }),
              }),
            )
            .action((args) => args),
        );

      const result = program.eval('run -i myfile');

      expect(result.args).toEqual({ input: 'myfile' });
    });

    it('should show current values in optionalInteractive multiselect when forced', async () => {
      const configs: InteractivePromptConfig[] = [];
      const promptFn = mock(async (config: InteractivePromptConfig) => {
        configs.push(config);
        if (config.name === 'name') return 'Alice';
        if (config.name === '_optionalFields') return ['verbose'];
        if (config.name === 'verbose') return false;
        return undefined;
      });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
                verbose: z.boolean().default(false).describe('Enable verbose'),
              }),
              {
                interactive: ['name'],
                optionalInteractive: ['verbose'],
              },
            )
            .action((args) => args),
        );

      await program.eval('init --verbose', { interactive: true });

      // The multiselect should show current value next to the label
      const multiselectConfig = configs.find((c) => c.name === '_optionalFields');
      expect(multiselectConfig?.choices?.[0]?.label).toBe('Enable verbose (current: true)');
    });

    it('should include already-provided optional fields in multiselect when forced', async () => {
      const promptFn = mock(async (config: InteractivePromptConfig) => {
        if (config.name === '_optionalFields') return [];
        return undefined;
      });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                verbose: z.boolean().default(false),
                debug: z.boolean().default(false),
              }),
              { optionalInteractive: ['verbose', 'debug'] },
            )
            .action((args) => args),
        );

      await program.eval('init --verbose', { interactive: true });

      // Both fields should be in the multiselect even though verbose is already provided
      const multiselectConfig = (promptFn.mock.calls[0] as any)[0] as InteractivePromptConfig;
      expect(multiselectConfig.choices).toHaveLength(2);
    });
  });

  describe('non-interactive runtime', () => {
    it('should skip prompting when runtime.interactive is unsupported', async () => {
      const promptFn = createMockPrompt({ name: 'Alice' });

      const program = createPadrone('test')
        .runtime({ interactive: 'unsupported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      // Unsupported runtime — missing required field causes validation error
      const result = await program.eval('init');
      expect(result.argsResult?.issues).toBeDefined();
      expect(promptFn).not.toHaveBeenCalled();
    });

    it('should not override unsupported with --interactive flag', async () => {
      const promptFn = createMockPrompt({ name: 'Alice' });

      const program = createPadrone('test')
        .runtime({ interactive: 'unsupported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      // Even with --interactive flag, unsupported runtime can't be overridden
      const result = await program.eval('init --interactive');
      expect(result.argsResult?.issues).toBeDefined();
      expect(promptFn).not.toHaveBeenCalled();
    });

    it('should skip prompting when runtime.interactive is disabled by default', async () => {
      const promptFn = createMockPrompt({ name: 'Alice' });

      const program = createPadrone('test')
        .runtime({ interactive: 'disabled', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      // Disabled by default — prompts skipped without flag/pref override
      const result = await program.eval('init');
      expect(result.argsResult?.issues).toBeDefined();
      expect(promptFn).not.toHaveBeenCalled();
    });

    it('should allow --interactive flag to override disabled runtime', async () => {
      const promptFn = createMockPrompt({ name: 'Alice' });

      const program = createPadrone('test')
        .runtime({ interactive: 'disabled', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      // --interactive flag overrides disabled runtime
      const result = await program.eval('init --interactive');
      expect(result.args).toEqual({ name: 'Alice' });
      expect(promptFn).toHaveBeenCalledTimes(1);
    });

    it('should skip prompting when no prompt function is provided', async () => {
      const program = createPadrone('test')
        .runtime({ interactive: 'unsupported', prompt: undefined })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      const result = await program.eval('init');
      expect(result.argsResult?.issues).toBeDefined();
    });
  });

  describe('parse() should not trigger interactive prompts', () => {
    it('should not prompt during parse even with interactive config', async () => {
      const promptFn = createMockPrompt({ name: 'Alice' });

      const program = createPadrone('test')
        .runtime({ interactive: 'supported', prompt: promptFn })
        .command('init', (c) =>
          c
            .arguments(
              z.object({
                name: z.string(),
              }),
              { interactive: true },
            )
            .action((args) => args),
        );

      const result = await program.parse('init');
      // parse() should not call prompt
      expect(promptFn).not.toHaveBeenCalled();
      // Missing required field should cause validation issues
      expect(result.argsResult?.issues).toBeDefined();
    });
  });
});
