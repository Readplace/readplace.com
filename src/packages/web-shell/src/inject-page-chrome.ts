import assert from "node:assert";

export interface PageChromeState {
	bodyClass: string | undefined;
	showExtensionSuggestion: boolean;
}

/**
 * Carry the chrome state that varies per page INSIDE <main>, so a boosted
 * navigation can restore it. `<body class="page-*">` and the `.banner-area`
 * both sit outside the swapped subtree, and hx-select="main" keeps only <main>
 * — so after a boosted nav or card open they keep the origin page's values
 * (queue -> reader leaves `page-queue` and the queue's banner state),
 * misapplying every `body.page-* ...` rule and stranding the e2e helpers that
 * key on them. Putting the values inside the swap is what lets the shell's
 * global scripts re-apply them; an out-of-band element would need every route
 * to opt in.
 *
 * String insert, NOT a DOM parse — a parse/serialize round-trip decodes one
 * level of HTML escaping and would collapse the reader iframe's intentionally
 * double-escaped srcdoc, the same reason injectPageScriptsIntoMain is
 * string-based.
 */
export function injectPageChromeIntoMain(content: string, chrome: PageChromeState): string {
	const attrs = [
		chrome.bodyClass ? ` data-page-class="${assertClassTokens(chrome.bodyClass)}"` : "",
		` data-extension-suggestion="${chrome.showExtensionSuggestion}"`,
	].join("");
	const updated = content.replace(/<main\b/i, (openTag) => openTag + attrs);
	assert(updated !== content, "PageBody.content must contain a <main> element");
	return updated;
}

function assertClassTokens(bodyClass: string): string {
	assert(
		/^[A-Za-z0-9 _-]+$/.test(bodyClass),
		`PageBody.bodyClass must be plain class tokens, got: ${bodyClass}`,
	);
	return bodyClass;
}
