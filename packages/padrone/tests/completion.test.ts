import { describe, expect, it } from 'bun:test';
import { createPadrone } from 'padrone';
import * as z from 'zod/v4';

function createProgramWithEnums() {
  return createPadrone('myapp')
    .command('deploy', (c) =>
      c
        .arguments(
          z.object({
            env: z.enum(['staging', 'production', 'dev']),
            format: z.enum(['json', 'yaml', 'toml']).default('json'),
            verbose: z.boolean().default(false),
            count: z.number().optional(),
          }),
          {
            fields: {
              env: { description: 'Target environment' },
              format: { description: 'Output format', alias: 'fmt' },
            },
          },
        )
        .action((args) => args),
    )
    .command('list', (c) =>
      c
        .arguments(
          z.object({
            status: z.enum(['active', 'archived']).optional(),
          }),
        )
        .action(() => []),
    );
}

describe('Completion - option value completion', () => {
  describe('Bash', () => {
    it('should include case statement for enum options', async () => {
      const program = createProgramWithEnums();
      const script = await program.completion('bash');

      // Should have a case block for --env with its enum values
      expect(script).toContain('--env)');
      expect(script).toContain('staging production dev');

      // Should have a case block for --format with alias
      expect(script).toContain('--format');
      expect(script).toContain('json yaml toml');

      // Should have a case block for --status
      expect(script).toContain('--status)');
      expect(script).toContain('active archived');

      // Boolean and number options should NOT have value completion case branches
      expect(script).not.toMatch(/case.*\n[\s\S]*--verbose\)/);
      expect(script).not.toMatch(/case.*\n[\s\S]*--count\)/);
    });

    it('should include alias in case patterns', async () => {
      const program = createProgramWithEnums();
      const script = await program.completion('bash');

      // --format should have --fmt alias in the same case pattern
      expect(script).toMatch(/--format\|--fmt\)/);
    });
  });

  describe('Zsh', () => {
    it('should include value actions for enum options', async () => {
      const program = createProgramWithEnums();
      const script = await program.completion('zsh');

      // Zsh uses :(val1 val2) syntax for value completion
      expect(script).toContain(':(staging production dev)');
      expect(script).toContain(':(json yaml toml)');
      expect(script).toContain(':(active archived)');

      // Boolean options should not have value actions (no :(values) after description)
      expect(script).toMatch(/--verbose\[.*\]'$/m);
    });

    it('should include descriptions in option specs', async () => {
      const program = createProgramWithEnums();
      const script = await program.completion('zsh');

      expect(script).toContain('Target environment');
      expect(script).toContain('Output format');
    });
  });

  describe('Fish', () => {
    it('should include -xa with enum values', async () => {
      const program = createProgramWithEnums();
      const script = await program.completion('fish');

      // Fish uses -xa 'val1 val2' for exclusive value completions
      expect(script).toContain("-l env -d 'Target environment' -xa 'staging production dev'");
      expect(script).toContain("-xa 'json yaml toml'");
      expect(script).toContain("-xa 'active archived'");

      // Boolean options should not have -xa
      expect(script).toMatch(/complete.*-l verbose/);
      expect(script).not.toMatch(/-l verbose.*-xa/);
    });
  });

  describe('PowerShell', () => {
    it('should include switch cases for enum options', async () => {
      const program = createProgramWithEnums();
      const script = await program.completion('powershell');

      // PowerShell uses a switch on the previous word
      expect(script).toContain("'--env'");
      expect(script).toContain("'staging', 'production', 'dev'");
      expect(script).toContain("'json', 'yaml', 'toml'");
      expect(script).toContain("'active', 'archived'");

      // Boolean/number options should not have value completion cases in the switch
      expect(script).not.toMatch(/switch[\s\S]*'--verbose'/);
      expect(script).not.toMatch(/switch[\s\S]*'--count'/);
    });

    it('should include alias in switch patterns', async () => {
      const program = createProgramWithEnums();
      const script = await program.completion('powershell');

      // format should have fmt alias in same switch case
      expect(script).toMatch(/'--format', '--fmt'/);
    });
  });

  describe('No enums', () => {
    it('should not generate value completion blocks when no enums exist', async () => {
      const program = createPadrone('simple').command('run', (c) =>
        c.arguments(z.object({ name: z.string(), verbose: z.boolean().default(false) })).action((args) => args),
      );

      const bash = await program.completion('bash');
      expect(bash).not.toContain('case "$prev"');

      const ps = await program.completion('powershell');
      expect(ps).not.toContain('switch');
    });
  });
});
