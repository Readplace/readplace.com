import assert from "node:assert";
import Handlebars from 'handlebars';
import { withInternalTracking } from './internal-link-tracking';

/**
 * `{{track '/account' medium='queue' content='subscribe_cta'}}` stamps the
 * internal-click UTM params onto a literal href in a template; URLs built in
 * component TS call withInternalTracking directly. Registered once on the
 * shared Handlebars instance so every template can use it without threading a
 * helper through each render() call. Double-stache escaping turns the joining
 * `&` into `&amp;`, the correct form inside an HTML attribute.
 */
Handlebars.registerHelper('track', (href: unknown, options: Handlebars.HelperOptions): string => {
  assert(typeof href === 'string', '{{track}} requires a string href');
  const { medium, content } = options.hash;
  assert(typeof medium === 'string', "{{track}} requires a medium= named arg");
  assert(typeof content === 'string', "{{track}} requires a content= named arg");
  return withInternalTracking(href, { medium, content });
});

const compiledTemplates = new Map<string, HandlebarsTemplateDelegate>();

export function render(template: string, data: object, options?: { helpers?: Record<string, Handlebars.HelperDelegate> }): string {
  let compiled = compiledTemplates.get(template);
  if (!compiled) {
    compiled = Handlebars.compile(template);
    compiledTemplates.set(template, compiled);
  }
  return compiled(data, { helpers: options?.helpers });
}
