import assert from "node:assert";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { browserExtension } from "@packages/translations/browser-extension";
import { iconSvg } from "@packages/ui-icons";
import { renderIllustration } from "@packages/web-shell";
import { SYSTEM_THEME_VARIABLES } from "@packages/web-shell/design-system.styles";

export type PopupUtmSource = "chrome-extension" | "firefox-extension";

const APP_ORIGIN = "https://readplace.com";

const { t } = translator(browserExtension, DEFAULT_LOCALE);

function escapedText(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#x27;");
}

function trackedHref(input: { path: string; utmSource: PopupUtmSource; utmContent: string }): string {
	const url = new URL(input.path, APP_ORIGIN);
	const tracking = {
		utm_source: input.utmSource,
		utm_medium: "extension",
		utm_content: input.utmContent,
	};
	for (const [key, value] of Object.entries(tracking)) url.searchParams.set(key, value);
	return url.href.replaceAll("&", "&amp;");
}

export function renderPopupTemplate(input: { template: string; utmSource: PopupUtmSource }): string {
	const values: Record<string, string> = {
		brandHomeHref: trackedHref({ path: "/", utmSource: input.utmSource, utmContent: "brand-home" }),
		allReadlistHref: trackedHref({ path: "/queue", utmSource: input.utmSource, utmContent: "save-all-result" }),
		openReadlistHref: trackedHref({ path: "/queue?queue=default", utmSource: input.utmSource, utmContent: "open-readlist" }),
		checkIcon: iconSvg("check"),
		errorIcon: iconSvg("x-circle"),
		warningIcon: iconSvg("alert-triangle"),
		searchIcon: iconSvg("search"),
		searchLabel: escapedText(t("popup.search.label")),
		noMatchesText: escapedText(t("popup.search.noMatches")),
		emptyArt: renderIllustration("book-lightbulb"),
		themeTokens: SYSTEM_THEME_VARIABLES,
	};
	const rendered = Object.entries(values).reduce(
		(html, [name, value]) => html.replaceAll(`{{${name}}}`, value),
		input.template,
	);
	assert(!rendered.includes("{{"), "the popup template names a placeholder the build does not fill");
	return rendered;
}
