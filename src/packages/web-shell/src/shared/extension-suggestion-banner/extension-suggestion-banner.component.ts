import type { AdvertisedClientNameInGroup } from "@packages/supported-clients";
import { render } from "../../render";
import { EXTENSION_SUGGESTION_BANNER_TEMPLATE } from "./extension-suggestion-banner.template";

export const EXTENSION_SUGGESTION_BANNER_SCRIPT = `<script src="/client-dist/extension-suggestion-banner.client.js" defer></script>`;

/**
 * How this banner names the save surfaces it points at. It pitches only the
 * content-capture clients — they are the only ones that grab the full page a
 * url-only save missed; an AI assistant over MCP saves URLs too, so it can't
 * help here. Keyed per ADVERTISED client rather than per group, so a client
 * starting or stopping being advertised is a compile error here until the
 * banner's wording is reconsidered — a group-level noun once had this banner
 * pitching "phone apps" while the only phone app anyone could install was the
 * iPhone one.
 */
const CONTENT_CAPTURE_NOUNS = {
	firefox: "the browser extension",
	chrome: "the browser extension",
	iphone: "the iPhone app",
} satisfies Record<
	AdvertisedClientNameInGroup<"browserExtension"> | AdvertisedClientNameInGroup<"nativeApp">,
	string
>;

const CONTENT_CAPTURE_PHRASE = [...new Set(Object.values(CONTENT_CAPTURE_NOUNS))].join(" or ");

function renderTemplate(input: {
	show: boolean;
	extensionInstalled: boolean;
	oob: boolean;
}): string {
	return render(EXTENSION_SUGGESTION_BANNER_TEMPLATE, {
		show: input.show ? "true" : "false",
		extensionInstalled: input.extensionInstalled,
		clientsPhrase: CONTENT_CAPTURE_PHRASE,
		oob: input.oob,
	});
}

export function renderExtensionSuggestionBanner(input: {
	show: boolean;
	extensionInstalled?: boolean;
}): string {
	return renderTemplate({
		show: input.show,
		extensionInstalled: input.extensionInstalled ?? false,
		oob: false,
	});
}

export function renderExtensionSuggestionBannerOob(input: {
	show: boolean;
	extensionInstalled: boolean;
}): string {
	return renderTemplate({
		show: input.show,
		extensionInstalled: input.extensionInstalled,
		oob: true,
	});
}
