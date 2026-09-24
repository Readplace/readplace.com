import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { renderEmbedCopyable } from "./embed-copyable.component";
import { EMBED_PAGE_STYLES } from "./embed.styles";

import {
	PAGE_URL_PLACEHOLDER,
	SNIPPET_MAX_BYTES,
	type SnippetVariant,
	byteLength,
	renderCanonicalSnippet,
	renderLiveSnippet,
} from "./snippet.component";

const EMBED_TEMPLATE = readFileSync(join(__dirname, "embed.template.html"), "utf-8");

const CANONICAL_EMBED_ORIGIN = "https://readplace.com/embed";

const PRIVACY_STATEMENT =
	"The Readplace save button is a plain HTML link with a small icon image. It sets no cookies on this site and runs no JavaScript. The icon image is fetched from readplace.com as a static asset, the same way any third-party image from any domain would be. When a reader clicks the button, they navigate to readplace.com, where Readplace's privacy policy applies.";

const INVALID_PAGE_URL_MESSAGE = "Enter a full link, including https://.";

const SNIPPET_SIZE_LIMIT = `${SNIPPET_MAX_BYTES / 1024} KB`;

interface EmbedVariant {
	id: SnippetVariant;
	name: string;
	note: string;
}

const EMBED_VARIANTS: readonly EmbedVariant[] = [
	{
		id: "a",
		name: "Variant A — icon only",
		note: "Inline next to article titles in link lists, sidebars, comment footers.",
	},
	{
		id: "b",
		name: "Variant B — icon and label",
		note: "Top or bottom of an individual article, or inside a navigation bar.",
	},
	{
		id: "c",
		name: "Variant C — end-of-post card",
		note: "After the last paragraph of a long post, so readers can save it and come back to it later.",
	},
];

const CUSTOMISE_SNIPPETS_HREF = withInternalTracking("/embed", {
	source: "embed-variants",
	content: "customise-snippets",
});

const CUSTOMISE_SNIPPETS_INPUTS = Array.from(
	new URLSearchParams(CUSTOMISE_SNIPPETS_HREF.slice(CUSTOMISE_SNIPPETS_HREF.indexOf("?"))),
	([name, value]) => ({ name, value }),
);

export type EmbedPageUrl = { kind: "empty" } | { kind: "valid"; url: string } | { kind: "invalid"; raw: string };

interface PageUrlView {
	snippetPageUrl: string;
	field: { value: string; className: string; ariaInvalid: "true" | "false"; error: string };
}

function pageUrlView(pageUrl: EmbedPageUrl): PageUrlView {
	if (pageUrl.kind === "valid") {
		return {
			snippetPageUrl: pageUrl.url,
			field: { value: pageUrl.url, className: "embed-url-input__field", ariaInvalid: "false", error: "" },
		};
	}
	if (pageUrl.kind === "invalid") {
		return {
			snippetPageUrl: PAGE_URL_PLACEHOLDER,
			field: {
				value: pageUrl.raw,
				className: "embed-url-input__field embed-url-input__field--invalid",
				ariaInvalid: "true",
				error: INVALID_PAGE_URL_MESSAGE,
			},
		};
	}
	return {
		snippetPageUrl: PAGE_URL_PLACEHOLDER,
		field: { value: "", className: "embed-url-input__field", ariaInvalid: "false", error: "" },
	};
}

function bytesLabel(source: string): string {
	return `${byteLength(source).toLocaleString("en-US")} bytes`;
}

export interface EmbedPageInput {
	embedOrigin: string;
	pageUrl: EmbedPageUrl;
}

export function EmbedPage(input: EmbedPageInput): PageBody {
	const livePageUrl = `${input.embedOrigin}/`;
	const view = pageUrlView(input.pageUrl);

	const variants = EMBED_VARIANTS.map((variant) => {
		const source = renderCanonicalSnippet({ variant: variant.id, pageUrl: view.snippetPageUrl });
		const codeId = `snippet-${variant.id}-code`;
		return {
			...variant,
			codeId,
			bytes: bytesLabel(source),
			preview: renderLiveSnippet({
				variant: variant.id,
				pageUrl: livePageUrl,
				embedOrigin: input.embedOrigin,
				tracking: { source: "embed-variants", content: `save-variant-${variant.id}` },
			}),
			copyable: renderEmbedCopyable({
				kind: "code",
				targetId: codeId,
				bodyTestId: `source-${variant.id}`,
				copyTestId: `copy-${variant.id}`,
				text: source,
				template: renderCanonicalSnippet({ variant: variant.id, pageUrl: PAGE_URL_PLACEHOLDER }),
			}),
		};
	});

	const content = render(EMBED_TEMPLATE, {
		heroDemo: renderLiveSnippet({
			variant: "b",
			pageUrl: livePageUrl,
			embedOrigin: input.embedOrigin,
			tracking: { source: "embed-hero", content: "save-demo" },
		}),
		sizeLimit: SNIPPET_SIZE_LIMIT,
		customiseInputs: CUSTOMISE_SNIPPETS_INPUTS,
		field: view.field,
		variants,
		privacyCopyable: renderEmbedCopyable({
			kind: "prose",
			targetId: "privacy-text",
			bodyTestId: "privacy-text",
			copyTestId: "copy-privacy",
			text: PRIVACY_STATEMENT,
		}),
	});

	return {
		seo: {
			title: "Readplace embed kit — a save button for your readers",
			description:
				`A copy-paste save button for bloggers and newsletter operators. Under ${SNIPPET_SIZE_LIMIT} before your link goes in, no JavaScript, no tracking.`,
			canonicalUrl: `${CANONICAL_EMBED_ORIGIN}/`,
		},
		styles: EMBED_PAGE_STYLES,
		bodyClass: "page-embed",
		content: { html: content },
		scripts: '<script src="/embed/embed.client.js" defer></script>',
	};
}
