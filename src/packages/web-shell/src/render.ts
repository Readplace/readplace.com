import assert from "node:assert";
import { DEFAULT_LOCALE, isSupportedLocale, type WebCatalog } from '@packages/translations';
import { WEB_CATALOG } from '@packages/translations/web-catalog';
import { findIconSvg } from '@packages/ui-icons';
import Handlebars from 'handlebars';
import { withInternalTracking } from './internal-link-tracking';
import { messageHtml } from './message-html';

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
	const { source, content, term } = options.hash;
	assert(typeof source === 'string', "{{track}} requires a source= named arg");
	assert(typeof content === 'string', "{{track}} requires a content= named arg");
	if (term !== undefined) assert(typeof term === 'string', "{{track}} term= must be a string when present");
	return withInternalTracking(href, { source, content, term });
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
Handlebars.registerHelper('icon', (name: unknown, options: Handlebars.HelperOptions): Handlebars.SafeString => {
	assert(typeof name === 'string', '{{icon}} requires an icon name');
	const { variant } = options.hash;
	if (variant !== undefined) assert(typeof variant === 'string', '{{icon}} variant= must be a string when present');
	const svg = findIconSvg(name, variant);
	assert(svg, `{{icon}} does not know the icon "${name}" in the ${variant ?? 'stroke'} variant`);
	return new Handlebars.SafeString(svg);
});

export function createTranslateHelper(catalog: WebCatalog) {
	return (key: unknown, options: Handlebars.HelperOptions): Handlebars.SafeString => {
		assert(typeof key === 'string', '{{t}} requires a message key');
		const locale: unknown = options.data?.locale;
		assert(isSupportedLocale(locale), `{{t}} needs a supported locale in the render data, got ${String(locale)}`);
		const message = catalog.findMessage({ locale, key });
		assert(message !== undefined, `{{t}} does not know the message "${key}"`);
		return messageHtml(message, options.hash);
	};
}

Handlebars.registerHelper('t', createTranslateHelper(WEB_CATALOG));

const compiledTemplates = new Map<string, HandlebarsTemplateDelegate>();

export function render(template: string, data: object, options?: { helpers?: Record<string, Handlebars.HelperDelegate> }): string {
	let compiled = compiledTemplates.get(template);
	if (!compiled) {
		compiled = Handlebars.compile(template);
		compiledTemplates.set(template, compiled);
	}
	return compiled(data, { helpers: options?.helpers, data: { locale: DEFAULT_LOCALE } });
}
