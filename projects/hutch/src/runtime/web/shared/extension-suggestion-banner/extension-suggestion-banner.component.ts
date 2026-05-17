import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../render";

const EXTENSION_SUGGESTION_BANNER_TEMPLATE = readFileSync(
	join(__dirname, "extension-suggestion-banner.template.html"),
	"utf-8",
);

export const EXTENSION_SUGGESTION_BANNER_SCRIPT = `<script src="/client-dist/extension-suggestion-banner.client.js" defer></script>`;

export function renderExtensionSuggestionBanner(input: { show: boolean }): string {
	return render(EXTENSION_SUGGESTION_BANNER_TEMPLATE, {
		show: input.show ? "true" : "false",
	});
}
