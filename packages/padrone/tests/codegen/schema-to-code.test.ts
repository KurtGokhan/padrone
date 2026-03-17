import { describe, expect, it } from 'bun:test';
import type { FieldMeta } from 'padrone/codegen';
import { fieldMetaToCode } from 'padrone/codegen';

describe('fieldMetaToCode', () => {
  it('should generate code for string fields', () => {
    const fields: FieldMeta[] = [{ name: 'name', type: 'string', required: true, description: 'User name' }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('name: z.string()');
    expect(result.code).toContain('.describe("User name")');
    expect(result.imports).toContain('z');
  });

  it('should generate code for optional fields', () => {
    const fields: FieldMeta[] = [{ name: 'verbose', type: 'boolean' }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('verbose: z.boolean().optional()');
  });

  it('should generate code for fields with defaults', () => {
    const fields: FieldMeta[] = [{ name: 'port', type: 'number', default: 3000 }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('port: z.number().default(3000)');
    // Should not have .optional() since it has a default
    expect(result.code).not.toContain('.optional()');
  });

  it('should generate code for enum fields', () => {
    const fields: FieldMeta[] = [{ name: 'format', type: 'enum', enumValues: ['json', 'yaml', 'xml'] }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('z.enum(["json", "yaml", "xml"])');
  });

  it('should generate code for array fields', () => {
    const fields: FieldMeta[] = [{ name: 'tags', type: 'array', items: 'string', required: true }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('tags: z.string().array()');
  });

  it('should generate code for number array fields', () => {
    const fields: FieldMeta[] = [{ name: 'ports', type: 'array', items: 'number', required: true }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('ports: z.number().array()');
  });

  it('should generate code for unknown type fields', () => {
    const fields: FieldMeta[] = [{ name: 'data', type: 'unknown', required: true }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('data: z.unknown()');
  });

  it('should mark ambiguous fields with TODO comment', () => {
    const fields: FieldMeta[] = [{ name: 'value', type: 'string', ambiguous: true }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('/* TODO: verify type */');
  });

  it('should generate complete z.object() wrapper', () => {
    const fields: FieldMeta[] = [
      { name: 'name', type: 'string', required: true },
      { name: 'age', type: 'number', required: true },
    ];

    const result = fieldMetaToCode(fields);

    expect(result.code).toMatch(/^z\.object\(\{/);
    expect(result.code).toMatch(/\}\)$/);
  });

  it('should generate code for enum with empty values fallback to string', () => {
    const fields: FieldMeta[] = [{ name: 'format', type: 'enum', enumValues: [] }];

    const result = fieldMetaToCode(fields);

    expect(result.code).toContain('format: z.string()');
  });
});
