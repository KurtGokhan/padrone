import type { StandardSchemaV1 } from '@standard-schema/spec';
import { JSON_SCHEMA_OPTS } from '../args.ts';
import type { FieldMeta } from './types.ts';

interface SchemaToCodeResult {
  /** The generated Zod source code */
  code: string;
  /** Imports needed (e.g. ['z']) */
  imports: string[];
}

/**
 * Convert a JSON Schema property to Zod code.
 */
function jsonSchemaPropertyToZod(prop: Record<string, any>, required: boolean, ambiguous?: boolean): string {
  let code: string;

  const type = prop.type as string | undefined;
  const enumValues = prop.enum as unknown[] | undefined;

  if (enumValues && enumValues.length > 0) {
    const values = enumValues.map((v) => JSON.stringify(v)).join(', ');
    code = `z.enum([${values}])`;
  } else if (type === 'string') {
    code = 'z.string()';
  } else if (type === 'number' || type === 'integer') {
    code = 'z.number()';
  } else if (type === 'boolean') {
    code = 'z.boolean()';
  } else if (type === 'array') {
    const items = prop.items as Record<string, any> | undefined;
    const itemCode = items ? jsonSchemaPropertyToZod(items, true) : 'z.unknown()';
    code = `${itemCode}.array()`;
  } else {
    code = 'z.unknown()';
  }

  if (prop.default !== undefined) {
    code += `.default(${JSON.stringify(prop.default)})`;
  } else if (!required) {
    code += '.optional()';
  }

  if (prop.description) {
    code += `.describe(${JSON.stringify(prop.description)})`;
  }

  if (ambiguous) {
    code += ' /* TODO: verify type */';
  }

  return code;
}

/**
 * Generate Zod source code from a Standard Schema instance by introspecting
 * its `~standard.jsonSchema` interface.
 */
export function schemaToCode(schema: StandardSchemaV1): SchemaToCodeResult {
  try {
    const jsonSchema = (schema as any)['~standard'].jsonSchema.input(JSON_SCHEMA_OPTS) as Record<string, any>;
    return jsonSchemaToCode(jsonSchema);
  } catch {
    return { code: 'z.unknown()', imports: ['z'] };
  }
}

function jsonSchemaToCode(jsonSchema: Record<string, any>): SchemaToCodeResult {
  if (jsonSchema.type === 'object' && jsonSchema.properties) {
    const properties = jsonSchema.properties as Record<string, any>;
    const required = new Set((jsonSchema.required as string[]) || []);

    const entries = Object.entries(properties).map(([key, prop]) => {
      const isRequired = required.has(key);
      const zodCode = jsonSchemaPropertyToZod(prop as Record<string, any>, isRequired);
      return `  ${key}: ${zodCode},`;
    });

    const code = `z.object({\n${entries.join('\n')}\n})`;
    return { code, imports: ['z'] };
  }

  // Fallback for non-object schemas
  const code = jsonSchemaPropertyToZod(jsonSchema, true);
  return { code, imports: ['z'] };
}

/**
 * Build a real Zod schema from FieldMeta objects.
 * Returns the schema as Zod source code, since we can't dynamically import Zod here
 * (codegen has no runtime dependency on padrone's main entry point).
 */
export function fieldMetaToCode(fields: FieldMeta[]): SchemaToCodeResult {
  const entries = fields.map((field) => {
    let code: string;

    switch (field.type) {
      case 'string':
        code = 'z.string()';
        break;
      case 'number':
        code = 'z.number()';
        break;
      case 'boolean':
        code = 'z.boolean()';
        break;
      case 'array': {
        const itemType = field.items || 'string';
        const itemCode = itemType === 'number' ? 'z.number()' : 'z.string()';
        code = `${itemCode}.array()`;
        break;
      }
      case 'enum':
        if (field.enumValues && field.enumValues.length > 0) {
          const values = field.enumValues.map((v) => JSON.stringify(v)).join(', ');
          code = `z.enum([${values}])`;
        } else {
          code = 'z.string()';
        }
        break;
      default:
        code = 'z.unknown()';
        break;
    }

    if (field.default !== undefined) {
      code += `.default(${JSON.stringify(field.default)})`;
    } else if (!field.required) {
      code += '.optional()';
    }

    if (field.description) {
      code += `.describe(${JSON.stringify(field.description)})`;
    }

    if (field.ambiguous) {
      code += ' /* TODO: verify type */';
    }

    const key = needsQuoting(field.name) ? JSON.stringify(field.name) : field.name;
    return `  ${key}: ${code},`;
  });

  const code = `z.object({\n${entries.join('\n')}\n})`;
  return { code, imports: ['z'] };
}

const JS_RESERVED = new Set([
  'break',
  'case',
  'catch',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'class',
  'const',
  'enum',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'await',
  'async',
]);

/** Returns true if the name needs quoting to be a valid JS object key. */
function needsQuoting(name: string): boolean {
  if (JS_RESERVED.has(name)) return true;
  // Must be a valid identifier: starts with letter/$/_, contains only word chars
  return !/^[a-zA-Z_$][\w$]*$/.test(name);
}
