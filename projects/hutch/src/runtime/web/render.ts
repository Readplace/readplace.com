import Handlebars from 'handlebars';

const compiledTemplates = new Map<string, HandlebarsTemplateDelegate>();

export function render(template: string, data: object, options?: { helpers?: Record<string, Handlebars.HelperDelegate> }): string {
  let compiled = compiledTemplates.get(template);
  if (!compiled) {
    compiled = Handlebars.compile(template);
    compiledTemplates.set(template, compiled);
  }
  return compiled(data, { helpers: options?.helpers });
}
