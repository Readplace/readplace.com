import assert from "node:assert";
import { type YouTubeEmbed, parseYouTubeEmbed } from "./parse-embed-url";

/* A YouTube <iframe> embed never plays in the reader: the body renders inside a
 * sandboxed iframe with no allow-scripts, so the player's JS is blocked and the
 * frame collapses to YouTube's own error thumbnail. Replace each such embed with
 * a static poster card (built by the injected `renderFacade`) that links to the
 * watch page — pure HTML that needs no script permission. Runs before
 * Readability so the unplayable frame is gone before extraction scores it. */
export function replaceEmbedsWithFacade(params: {
	document: Document;
	renderFacade: (ctx: { document: Document; embed: YouTubeEmbed }) => Element;
}): void {
	const iframes = Array.from(params.document.querySelectorAll("iframe"));
	for (const iframe of iframes) {
		const src = iframe.getAttribute("src");
		if (!src) continue;
		const embed = parseYouTubeEmbed(src);
		if (!embed) continue;
		const facade = params.renderFacade({ document: params.document, embed });
		const parent = iframe.parentNode;
		assert(parent, "Iframe element selected from the document must have a parent node");
		parent.insertBefore(facade, iframe);
		iframe.remove();
	}
}
