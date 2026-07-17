import { clientGroupsInCategory } from "@packages/supported-clients";
import type { ClientGroupInCategory } from "@packages/supported-clients";
import { render } from "../../render";
import { EXTENSION_SUGGESTION_BANNER_TEMPLATE } from "./extension-suggestion-banner.template";

export const EXTENSION_SUGGESTION_BANNER_SCRIPT = `<script src="/client-dist/extension-suggestion-banner.client.js" defer></script>`;

/** How this banner names the save surfaces it points at. It pitches only the
 * content-capture clients — the browser extension and the iPhone app — because
 * they are the only ones that grab the full page a url-only save missed; an AI
 * assistant over MCP saves URLs too, so it can't help here. Keyed by the groups
 * in that category, so a new content-capture group is a compile error until it
 * gets banner copy. */
const CONTENT_CAPTURE_NOUNS = {
	browserExtension: "the browser extension",
	nativeApp: "iPhone app",
} satisfies Record<ClientGroupInCategory<"contentCapture">, string>;

const CONTENT_CAPTURE_PHRASE = clientGroupsInCategory("contentCapture")
	.map((group) => CONTENT_CAPTURE_NOUNS[group])
	.join(" or ");

export function renderExtensionSuggestionBanner(input: {
	show: boolean;
	extensionInstalled?: boolean;
}): string {
	return render(EXTENSION_SUGGESTION_BANNER_TEMPLATE, {
		show: input.show ? "true" : "false",
		extensionInstalled: input.extensionInstalled ?? false,
		clientsPhrase: CONTENT_CAPTURE_PHRASE,
	});
}
