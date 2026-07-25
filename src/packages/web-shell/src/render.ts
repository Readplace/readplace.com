import assert from "node:assert";
import { findIconSvg } from '@packages/ui-icons';
import Handlebars from 'handlebars';
import { withInternalTracking } from './internal-link-tracking';

/**
 * `{{track '/account' source='queue' content='subscribe'}}` stamps the
 * internal-click UTM params onto a literal href in a template; URLs built in
 * component TS call withInternalTracking directly. Registered once on the
 * shared Handlebars instance so every template can use it without threading a
 * helper through each render() call. Double-stache escaping turns the joining
 * `&` into `&amp;`, the correct form inside an HTML attribute.
 */
Handlebars.registerHelper('track', (href: unknown, options: Handlebars.HelperOptions): string => {
	assert(typeof href === 'string', '{{track}} requires a string href');
	const { source, content } = options.hash;
	assert(typeof source === 'string', "{{track}} requires a source= named arg");
	assert(typeof content === 'string', "{{track}} requires a content= named arg");
	return withInternalTracking(href, { source, content });
});

/**
 * `{{icon "arrow-right"}}` draws one icon from the shared set inline. A helper
 * rather than a view-model field because an icon is a template-authoring
 * decision, not page state: threading an `arrowRightSvg` through every display
 * model that happens to render an arrow is how the set drifts apart again.
 *
 * The markup is a SafeString, so it lands unescaped. That is safe precisely
 * because the argument is a *name* resolved against the set rather than markup —
 * an unknown name fails the render instead of interpolating anything.
 */
Handlebars.registerHelper('icon', (name: unknown): Handlebars.SafeString => {
	assert(typeof name === 'string', '{{icon}} requires an icon name');
	const svg = findIconSvg(name);
	assert(svg, `{{icon}} does not know the icon "${name}"`);
	return new Handlebars.SafeString(svg);
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
