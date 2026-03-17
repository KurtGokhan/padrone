import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CodeBuildResult, EmitResult, FileEmitter, FileEmitterOptions } from './types.ts';

interface QueuedFile {
  path: string;
  content: string;
}

class FileEmitterImpl implements FileEmitter {
  private files: QueuedFile[] = [];
  private options: FileEmitterOptions;

  constructor(options: FileEmitterOptions) {
    this.options = options;
  }

  addFile(path: string, content: string | CodeBuildResult): void {
    const text = typeof content === 'string' ? content : content.text;
    const fullContent = this.options.header ? `${this.options.header}\n\n${text}` : text;

    this.files.push({ path, content: fullContent });
  }

  async emit(): Promise<EmitResult> {
    const result: EmitResult = {
      written: [],
      skipped: [],
      errors: [],
    };

    const outDir = resolve(this.options.outDir);

    for (const file of this.files) {
      const fullPath = join(outDir, file.path);

      try {
        // Check if file already exists
        if (existsSync(fullPath) && !this.options.overwrite) {
          result.skipped.push(file.path);
          continue;
        }

        if (this.options.dryRun) {
          result.written.push(file.path);
          continue;
        }

        // Ensure directory exists
        const dir = dirname(fullPath);
        mkdirSync(dir, { recursive: true });

        // Write the file
        writeFileSync(fullPath, file.content, 'utf-8');
        result.written.push(file.path);
      } catch (err) {
        result.errors.push({
          file: file.path,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    return result;
  }
}

/**
 * Create a FileEmitter for writing multiple generated files to disk.
 */
export function createFileEmitter(options: FileEmitterOptions): FileEmitter {
  return new FileEmitterImpl(options);
}
