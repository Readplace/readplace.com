import { render } from "../../render";
import { EXTENSION_SUGGESTION_BANNER_TEMPLATE } from "./extension-suggestion-banner.template";

export const EXTENSION_SUGGESTION_BANNER_SCRIPT = `<script src="/client-dist/extension-suggestion-banner.client.js" defer></script>`;

export function renderExtensionSuggestionBanner(input: {
	show: boolean;
	extensionInstalled?: boolean;
}): string {
	return render(EXTENSION_SUGGESTION_BANNER_TEMPLATE, {
		show: input.show ? "true" : "false",
		extensionInstalled: input.extensionInstalled ?? false,
	});
}
