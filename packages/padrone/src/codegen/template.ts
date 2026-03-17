/**
 * Lightweight string template engine.
 *
 * Syntax:
 * - `{{var}}` — interpolation
 * - `{{#arr}}...{{/arr}}` — iteration (`.` refers to current item)
 * - `{{#bool}}...{{/bool}}` — conditional blocks
 * - `{{>partial}}` — include a named sub-template
 */

type TemplateRenderer = (data: Record<string, unknown>, partials?: Record<string, string>) => string;

/**
 * Compile a template string into a reusable render function.
 */
export function template(text: string): TemplateRenderer {
  return (data: Record<string, unknown>, partials?: Record<string, string>) => {
    return render(text, data, partials);
  };
}

function render(text: string, data: Record<string, unknown>, partials?: Record<string, string>): string {
  let result = text;

  // Process block sections: {{#key}}...{{/key}}
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, key: string, body: string) => {
    const value = data[key];

    if (value === undefined || value === null || value === false) {
      return '';
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            return render(body, item as Record<string, unknown>, partials);
          }
          // For primitive items, replace {{.}} with the item value
          return body.replace(/\{\{\.\}\}/g, String(item));
        })
        .join('');
    }

    // Truthy conditional
    if (typeof value === 'object') {
      return render(body, value as Record<string, unknown>, partials);
    }
    return render(body, data, partials);
  });

  // Process partials: {{>partialName}}
  if (partials) {
    result = result.replace(/\{\{>(\w+)\}\}/g, (_match, name: string) => {
      const partialText = partials[name];
      if (!partialText) return '';
      return render(partialText, data, partials);
    });
  }

  // Process interpolation: {{var}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });

  return result;
}
