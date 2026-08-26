import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { renderEmbedCopyable } from "./embed-copyable.component";
import { EMBED_PAGE_STYLES } from "./embed.styles";

import { byteLength, renderCanonicalSnippet, renderSnippet } from "./snippet.component";

const EMBED_TEMPLATE = readFileSync(join(__dirname, "embed.template.html"), "utf-8");

const CANONICAL_EMBED_ORIGIN = "https://readplace.com/embed";

const PRIVACY_STATEMENT =
	"The Readplace save button is a plain HTML link with a small icon image. It sets no cookies on this site and runs no JavaScript. The icon image is fetched from readplace.com as a static asset, the same way any third-party image from any domain would be. When a reader clicks the button, they navigate to readplace.com, where Readplace's privacy policy applies.";

function snippetCopyable(variant: "a" | "b" | "c", source: string): string {
	return renderEmbedCopyable({
		kind: "code",
		targetId: `snippet-${variant}-code`,
		bodyTestId: `source-${variant}`,
		copyTestId: `copy-${variant}`,
		text: source,
	});
}

export interface EmbedPageInput {
	appOrigin: string;
	embedOrigin: string;
}

export function EmbedPage(input: EmbedPageInput): PageBody {
	const origins = { appOrigin: input.appOrigin, embedOrigin: input.embedOrigin, pageUrl: `${input.embedOrigin}/` };
	const previewA = renderSnippet("a", origins);
	const previewB = renderSnippet("b", origins);
	const previewC = renderSnippet("c", origins);
	const sourceA = renderCanonicalSnippet("a");
	const sourceB = renderCanonicalSnippet("b");
	const sourceC = renderCanonicalSnippet("c");

	const content = render(EMBED_TEMPLATE, {
		heroDemo: previewB,
		previewA,
		previewB,
		previewC,
		copyableA: snippetCopyable("a", sourceA),
		copyableB: snippetCopyable("b", sourceB),
		copyableC: snippetCopyable("c", sourceC),
		privacyCopyable: renderEmbedCopyable({
			kind: "prose",
			targetId: "privacy-text",
			bodyTestId: "privacy-text",
			copyTestId: "copy-privacy",
			text: PRIVACY_STATEMENT,
		}),
		bytesA: byteLength(sourceA),
		bytesB: byteLength(sourceB),
		bytesC: byteLength(sourceC),
		appOrigin: input.appOrigin,
	});

	return {
		seo: {
			title: "Readplace embed kit — a save button for your readers",
			description:
				"A copy-paste save button for bloggers and newsletter operators. Under 1 KB, no JavaScript, no tracking.",
			canonicalUrl: `${CANONICAL_EMBED_ORIGIN}/`,
		},
		styles: EMBED_PAGE_STYLES,
		bodyClass: "page-embed",
		content: { html: content },
		scripts: `<script src="${input.embedOrigin}/embed.client.js" defer></script>`,
	};
}
