import assert from "node:assert";
import { iconSvg } from "@packages/ui-icons";
import { SYSTEM_THEME_VARIABLES } from "@packages/web-shell/design-system.styles";

export type PopupUtmSource = "chrome-extension" | "firefox-extension";

const APP_ORIGIN = "https://readplace.com";

function trackedHref(input: { path: string; utmSource: PopupUtmSource; utmContent: string }): string {
	const query = new URLSearchParams({
		utm_source: input.utmSource,
		utm_medium: "extension",
		utm_content: input.utmContent,
	});
	return `${APP_ORIGIN}${input.path}?${query.toString()}`.replaceAll("&", "&amp;");
}

export function renderPopupTemplate(input: { template: string; utmSource: PopupUtmSource }): string {
	const values: Record<string, string> = {
		brandHomeHref: trackedHref({ path: "/", utmSource: input.utmSource, utmContent: "brand-home" }),
		openReadlistHref: trackedHref({ path: "/queue", utmSource: input.utmSource, utmContent: "open-readlist" }),
		checkIcon: iconSvg("check"),
		errorIcon: iconSvg("x-circle"),
		signOutIcon: iconSvg("log-out"),
		themeTokens: SYSTEM_THEME_VARIABLES,
	};
	const rendered = Object.entries(values).reduce(
		(html, [name, value]) => html.replaceAll(`{{${name}}}`, value),
		input.template,
	);
	assert(!rendered.includes("{{"), "the popup template names a placeholder the build does not fill");
	return rendered;
}
