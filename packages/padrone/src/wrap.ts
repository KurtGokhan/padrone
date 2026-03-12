import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { PadroneSchema } from './types.ts';

/**
 * Configuration options for wrapping an external CLI tool.
 */
export type WrapConfig<TCommandOpts extends PadroneSchema = PadroneSchema, TWrapOpts extends PadroneSchema = TCommandOpts> = {
  /**
   * The command to execute (e.g., 'git', 'docker', 'npm').
   */
  command: string;
  /**
   * Optional fixed arguments that always precede the options (e.g., ['commit'] for 'git commit').
   */
  args?: string[];
  /**
   * Positional argument configuration for the external command.
   * If not provided, defaults to the wrapping command's positional configuration.
   */
  positional?: string[];
  /**
   * Whether to inherit stdio streams (stdin, stdout, stderr) from the parent process.
   * Default: true
   */
  inheritStdio?: boolean;
  /**
   * Optional schema that transforms command options to external CLI arguments.
   * The schema's input type should match the command options, and its output type defines
   * the arguments expected by the external command.
   * If not provided, command options are passed through as-is.
   */
  schema?: TWrapOpts | ((commandOptions: TCommandOpts) => TWrapOpts);
};

/**
 * Result from executing a wrapped CLI tool.
 */
export type WrapResult = {
  /**
   * The exit code of the process.
   */
  exitCode: number;
  /**
   * Standard output from the process (only if inheritStdio is false).
   */
  stdout?: string;
  /**
   * Standard error from the process (only if inheritStdio is false).
   */
  stderr?: string;
  /**
   * Whether the process exited successfully (exit code 0).
   */
  success: boolean;
};

/**
 * Converts parsed options to CLI arguments for an external command.
 */
function optionsToArgs(options: Record<string, unknown> | undefined, positional: string[] = []): string[] {
  const args: string[] = [];

  // Handle undefined or null options
  if (!options) return args;

  const positionalValues: Record<string, unknown> = {};
  const regularOptions: Record<string, unknown> = {};

  // Separate positional and regular options
  for (const [key, value] of Object.entries(options)) {
    if (positional.includes(key) || positional.includes(`...${key}`)) {
      positionalValues[key] = value;
    } else {
      regularOptions[key] = value;
    }
  }

  // Add regular options first
  for (const [key, value] of Object.entries(regularOptions)) {
    if (value === undefined || value === null) continue;

    // Use the key as-is with -- prefix
    const flag = `--${key}`;

    if (typeof value === 'boolean') {
      if (value) args.push(flag);
    } else if (Array.isArray(value)) {
      // For arrays, add the flag multiple times
      for (const item of value) {
        args.push(flag, String(item));
      }
    } else {
      args.push(flag, String(value));
    }
  }

  // Add positional arguments in the specified order
  for (const posKey of positional) {
    const isVariadic = posKey.startsWith('...');
    const key = isVariadic ? posKey.slice(3) : posKey;
    const value = positionalValues[key];

    if (value === undefined || value === null) continue;

    if (isVariadic && Array.isArray(value)) {
      args.push(...value.map(String));
    } else {
      args.push(String(value));
    }
  }

  return args;
}

/**
 * Creates an action handler that wraps an external CLI tool.
 * @param config - Configuration for wrapping the external command (includes optional schema)
 * @param commandOptions - The command's options schema
 * @param commandPositional - Default positional config from the wrapping command
 */
export function createWrapHandler<TCommandOpts extends PadroneSchema, TWrapOpts extends PadroneSchema>(
  config: WrapConfig<TCommandOpts, TWrapOpts>,
  commandOptions: TCommandOpts,
  commandPositional?: string[],
): (options: StandardSchemaV1.InferOutput<TCommandOpts>) => Promise<WrapResult> {
  return async (options: StandardSchemaV1.InferOutput<TCommandOpts>): Promise<WrapResult> => {
    const { command, args: fixedArgs = [], inheritStdio = true, positional = commandPositional, schema: wrapSchema } = config;

    // Get the wrap schema (handle function or direct schema)
    const schema = wrapSchema ? (typeof wrapSchema === 'function' ? wrapSchema(commandOptions) : wrapSchema) : commandOptions;

    // Transform command options to external CLI options using the wrap schema
    const validationResult = schema['~standard'].validate(options);

    const processResult = (result: StandardSchemaV1.Result<unknown>) => {
      if (result.issues) {
        const issueMessages = result.issues
          .map((i: StandardSchemaV1.Issue) => `  - ${(i.path as (string | number)[] | undefined)?.join('.') || 'root'}: ${i.message}`)
          .join('\n');
        throw new Error(`Wrap schema validation failed:\n${issueMessages}`);
      }
      return result.value;
    };

    const externalOptions =
      validationResult instanceof Promise ? await validationResult.then(processResult) : processResult(validationResult);

    // Convert options to CLI arguments
    const optionArgs = optionsToArgs(externalOptions as Record<string, unknown>, positional);

    // Combine fixed args and option args
    const allArgs = [...fixedArgs, ...optionArgs];

    // Execute the external command
    const proc = Bun.spawn([command, ...allArgs], {
      stdout: inheritStdio ? 'inherit' : 'pipe',
      stderr: inheritStdio ? 'inherit' : 'pipe',
      stdin: inheritStdio ? 'inherit' : 'ignore',
    });

    const exitCode = await proc.exited;

    let stdout: string | undefined;
    let stderr: string | undefined;

    if (!inheritStdio) {
      if (proc.stdout) {
        const stdoutBuffer = await new Response(proc.stdout).arrayBuffer();
        stdout = new TextDecoder().decode(stdoutBuffer);
      }
      if (proc.stderr) {
        const stderrBuffer = await new Response(proc.stderr).arrayBuffer();
        stderr = new TextDecoder().decode(stderrBuffer);
      }
    }

    return {
      exitCode,
      stdout,
      stderr,
      success: exitCode === 0,
    };
  };
}
