import { describe, expect, it } from 'bun:test';
import { template } from 'padrone/codegen';

describe('template', () => {
  it('should interpolate simple variables', () => {
    const render = template('Hello, {{name}}!');
    expect(render({ name: 'World' })).toBe('Hello, World!');
  });

  it('should handle missing variables as empty string', () => {
    const render = template('Hello, {{name}}!');
    expect(render({})).toBe('Hello, !');
  });

  it('should handle null/undefined as empty string', () => {
    const render = template('{{a}} and {{b}}');
    expect(render({ a: null, b: undefined })).toBe(' and ');
  });

  it('should iterate over arrays', () => {
    const render = template('{{#items}}[{{.}}]{{/items}}');
    expect(render({ items: ['a', 'b', 'c'] })).toBe('[a][b][c]');
  });

  it('should handle conditional blocks with truthy values', () => {
    const render = template('{{#show}}visible{{/show}}');
    expect(render({ show: true })).toBe('visible');
    expect(render({ show: false })).toBe('');
  });

  it('should handle conditional blocks with falsy values', () => {
    const render = template('{{#show}}visible{{/show}}');
    expect(render({ show: null })).toBe('');
    expect(render({ show: undefined })).toBe('');
  });

  it('should iterate over objects in arrays', () => {
    const render = template('{{#users}}{{name}}: {{age}}\n{{/users}}');
    const result = render({
      users: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ],
    });
    expect(result).toContain('Alice: 30');
    expect(result).toContain('Bob: 25');
  });

  it('should handle nested variable access in conditional object blocks', () => {
    const render = template('{{#config}}port={{port}}{{/config}}');
    expect(render({ config: { port: 3000 } })).toBe('port=3000');
  });

  it('should include partials', () => {
    const render = template('before {{>header}} after');
    expect(render({ title: 'Test' }, { header: 'Title: {{title}}' })).toBe('before Title: Test after');
  });

  it('should handle missing partials as empty string', () => {
    const render = template('before {{>missing}} after');
    expect(render({}, {})).toBe('before  after');
  });

  it('should handle complex template', () => {
    const render = template(`import { createPadrone } from 'padrone'

const program = createPadrone('{{name}}')
  .configure({
    version: '{{version}}',
  })
{{#commands}}  .command('{{.}}', (cmd) => cmd.action(() => {}))
{{/commands}}
export default program`);

    const result = render({
      name: 'my-app',
      version: '1.0.0',
      commands: ['init', 'build'],
    });

    expect(result).toContain("createPadrone('my-app')");
    expect(result).toContain("version: '1.0.0'");
    expect(result).toContain(".command('init'");
    expect(result).toContain(".command('build'");
  });
});
