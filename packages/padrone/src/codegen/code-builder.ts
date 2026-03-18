import type { CodeBuilder, CodeBuildResult } from './types.ts';

interface ImportEntry {
  specifiers: Set<string>;
  defaultSpecifier?: string;
  typeOnly: boolean;
}

interface CodeLine {
  type: 'line' | 'raw' | 'block-open' | 'block-close';
  content: string;
}

class CodeBuilderImpl implements CodeBuilder {
  private imports = new Map<string, ImportEntry>();
  private lines: CodeLine[] = [];
  private indent: number;

  constructor(indent = 0) {
    this.indent = indent;
  }

  import(specifier: string | string[], source: string): CodeBuilder {
    const specs = Array.isArray(specifier) ? specifier : [specifier];
    const existing = this.imports.get(source);
    if (existing) {
      for (const s of specs) existing.specifiers.add(s);
      // If we're adding a value import and existing was type-only, downgrade to value
      existing.typeOnly = false;
    } else {
      this.imports.set(source, { specifiers: new Set(specs), typeOnly: false });
    }
    return this;
  }

  importDefault(name: string, source: string): CodeBuilder {
    const existing = this.imports.get(source);
    if (existing) {
      existing.defaultSpecifier = name;
      existing.typeOnly = false;
    } else {
      this.imports.set(source, { specifiers: new Set(), defaultSpecifier: name, typeOnly: false });
    }
    return this;
  }

  importType(specifier: string | string[], source: string): CodeBuilder {
    const specs = Array.isArray(specifier) ? specifier : [specifier];
    const existing = this.imports.get(source);
    if (existing) {
      for (const s of specs) existing.specifiers.add(s);
      // Don't downgrade: if existing is value import, keep it as value
    } else {
      this.imports.set(source, { specifiers: new Set(specs), typeOnly: true });
    }
    return this;
  }

  line(code?: string): CodeBuilder {
    this.lines.push({ type: 'line', content: code ?? '' });
    return this;
  }

  block(
    openOrBuilder: string | ((b: CodeBuilder) => CodeBuilder),
    builderOrClose?: string | ((b: CodeBuilder) => CodeBuilder),
    closeOrBuilder?: string | ((b: CodeBuilder) => CodeBuilder),
  ): CodeBuilder {
    let open: string | undefined;
    let close: string | undefined;
    let builder: (b: CodeBuilder) => CodeBuilder;

    if (typeof openOrBuilder === 'function') {
      // block(builder)
      builder = openOrBuilder;
    } else if (typeof builderOrClose === 'function') {
      // block(open, builder, close?)
      open = openOrBuilder;
      builder = builderOrClose;
      close = typeof closeOrBuilder === 'string' ? closeOrBuilder : undefined;
    } else if (typeof closeOrBuilder === 'function') {
      // block(open, close, builder)
      open = openOrBuilder;
      close = typeof builderOrClose === 'string' ? builderOrClose : undefined;
      builder = closeOrBuilder;
    } else {
      throw new Error('Invalid block() arguments');
    }

    // Always push block-open to increment indent
    this.lines.push({ type: 'block-open', content: open ?? '' });

    const inner = new CodeBuilderImpl(this.indent + 1);
    builder(inner);

    // Merge inner imports into ours
    for (const [source, entry] of inner.imports) {
      const existing = this.imports.get(source);
      if (existing) {
        for (const s of entry.specifiers) existing.specifiers.add(s);
        if (entry.defaultSpecifier) existing.defaultSpecifier = entry.defaultSpecifier;
        if (!entry.typeOnly) existing.typeOnly = false;
      } else {
        this.imports.set(source, {
          specifiers: new Set(entry.specifiers),
          defaultSpecifier: entry.defaultSpecifier,
          typeOnly: entry.typeOnly,
        });
      }
    }

    // Merge inner lines with extra indentation
    for (const line of inner.lines) {
      this.lines.push(line);
    }

    // Always push block-close to decrement indent
    this.lines.push({ type: 'block-close', content: close ?? '' });

    return this;
  }

  comment(text: string): CodeBuilder {
    this.lines.push({ type: 'line', content: `// ${text}` });
    return this;
  }

  docComment(text: string): CodeBuilder {
    const lines = text.split('\n');
    if (lines.length === 1) {
      this.lines.push({ type: 'line', content: `/** ${text} */` });
    } else {
      this.lines.push({ type: 'line', content: '/**' });
      for (const line of lines) {
        this.lines.push({ type: 'line', content: ` * ${line}` });
      }
      this.lines.push({ type: 'line', content: ' */' });
    }
    return this;
  }

  todoComment(text: string): CodeBuilder {
    this.lines.push({ type: 'line', content: `// TODO: ${text}` });
    return this;
  }

  raw(code: string): CodeBuilder {
    this.lines.push({ type: 'raw', content: code });
    return this;
  }

  build(): CodeBuildResult {
    const parts: string[] = [];

    // Emit imports first
    if (this.imports.size > 0) {
      const typeImports: string[] = [];
      const valueImports: string[] = [];

      for (const [source, entry] of this.imports) {
        const specs = [...entry.specifiers].sort();
        const namedPart =
          specs.length > 0 ? (specs.length === 1 && !specs[0]!.includes(' ') ? `{ ${specs[0]} }` : `{ ${specs.join(', ')} }`) : null;
        const specStr = entry.defaultSpecifier
          ? namedPart
            ? `${entry.defaultSpecifier}, ${namedPart}`
            : entry.defaultSpecifier
          : namedPart!;

        const line = entry.typeOnly ? `import type ${specStr} from '${source}'` : `import ${specStr} from '${source}'`;

        if (entry.typeOnly) {
          typeImports.push(line);
        } else {
          valueImports.push(line);
        }
      }

      // Value imports first, then type imports
      parts.push([...valueImports, ...typeImports].join('\n'));
      parts.push('');
    }

    // Emit code lines
    let currentIndent = this.indent;
    for (const line of this.lines) {
      if (line.type === 'raw') {
        parts.push(line.content);
      } else if (line.type === 'block-open') {
        if (line.content) {
          const indent = '  '.repeat(currentIndent);
          parts.push(`${indent}${line.content}`);
        }
        currentIndent++;
      } else if (line.type === 'block-close') {
        currentIndent--;
        if (line.content) {
          const indent = '  '.repeat(currentIndent);
          parts.push(`${indent}${line.content}`);
        }
      } else {
        // Regular line
        if (line.content === '') {
          parts.push('');
        } else {
          const indent = '  '.repeat(currentIndent);
          parts.push(`${indent}${line.content}`);
        }
      }
    }

    return {
      text: parts.join('\n'),
      imports: new Map(
        [...this.imports].map(([source, entry]) => [source, { specifiers: new Set(entry.specifiers), typeOnly: entry.typeOnly }]),
      ),
    };
  }
}

/**
 * Create a new CodeBuilder for constructing TypeScript source files.
 */
export function createCodeBuilder(): CodeBuilder {
  return new CodeBuilderImpl();
}
