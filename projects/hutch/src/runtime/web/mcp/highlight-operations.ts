import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type AnchorState,
	HIGHLIGHT_NOTE_MAX_LENGTH,
	type Highlight,
	locateQuote,
	type QuoteLocation,
	viewerFor,
} from "@packages/domain/article";
import {
	collectTextChunks,
	HIGHLIGHT_MAX_EXACT_LENGTH,
	normaliseText,
} from "@packages/domain/article/highlight";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { ListArticleHighlights } from "@packages/provider-contracts/highlights";
import { parseHTML } from "linkedom";
import type { CreateReaderHighlight } from "../shared/article-body/highlights/create-reader-highlight";
import {
	prepareReaderContent,
	WHOLE_DOCUMENT_SECTION,
} from "../shared/article-body/reader-slot/reader-content";
import { servedContentHash } from "../shared/article-body/reader-slot/served-content-hash";
import type { ResolveOwnedArticle } from "./article-lookup";
import type { McpHighlight, McpServerDeps } from "./mcp-ports.types";

function toMcpHighlight(params: { highlight: Highlight; state: AnchorState }): McpHighlight {
	const { highlight, state } = params;
	return {
		id: highlight.highlightId,
		quote: highlight.exact,
		...(highlight.note === undefined ? {} : { note: highlight.note }),
		state,
		createdAt: highlight.createdAt.toISOString(),
		updatedAt: highlight.updatedAt.toISOString(),
	};
}

function hasVisibleText(value: string): boolean {
	return normaliseText([{ text: value, blockBoundaryBefore: false }]).text.trim() !== "";
}

const NOT_FOUND: QuoteLocation = { status: "not-found" };

function decodedFragmentText(fragment: string): string {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="mcp-quote-root">${fragment}</div></body></html>`,
	);
	const root = document.querySelector("div#mcp-quote-root");
	assert(root, "parseHTML must produce the quote wrapper div");
	return normaliseText(collectTextChunks<Node>(root)).text;
}

function locateQuoteInText(params: {
	text: string;
	quote: string;
	textBefore?: string;
}): QuoteLocation {
	const { text, textBefore } = params;
	let quote = params.quote;
	let located = hasVisibleText(quote) ? locateQuote({ text, quote, textBefore }) : NOT_FOUND;
	if (located.status === "not-found") {
		quote = decodedFragmentText(params.quote);
		if (!hasVisibleText(quote)) return NOT_FOUND;
		located = locateQuote({ text, quote, textBefore });
	}
	if (located.status !== "ambiguous" || textBefore === undefined) return located;
	return locateQuote({ text, quote, textBefore: decodedFragmentText(textBefore) });
}

export function initMcpHighlightOperations(deps: {
	resolveOwnedArticle: ResolveOwnedArticle;
	readArticleContent: ReadArticleContent;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
	listArticleHighlights: ListArticleHighlights;
	createHighlight: CreateReaderHighlight;
	appOrigin: string;
}): Pick<McpServerDeps, "listHighlights" | "createHighlight"> {
	return {
		listHighlights: async ({ userId, id }) => {
			const owned = await deps.resolveOwnedArticle({ userId, id });
			if (!owned) return { status: "not_found" };
			const { article, readlist } = owned;
			const stored = await deps.readArticleContent({ url: article.url, viewer: viewerFor(userId) });
			if (stored.kind === "not-an-article") return { status: "not_an_article" };
			if (stored.kind === "missing") return { status: "pending" };
			const rows = await deps.listArticleHighlights({
				userId,
				url: ArticleResourceUniqueId.parse(article.url).value,
			});
			const snapshot = await deps.readCanonicalSnapshot(article.url);
			const prepared = prepareReaderContent({
				content: stored.body,
				appOrigin: deps.appOrigin,
				url: article.url,
				section: WHOLE_DOCUMENT_SECTION,
				highlights: { rows, canonicalContentHash: snapshot?.canonicalContentHash },
			});
			const highlights = [...prepared.states]
				.sort(
					(a, b) =>
						a.highlight.orderKey - b.highlight.orderKey ||
						a.highlight.highlightId.localeCompare(b.highlight.highlightId),
				)
				.map(({ highlight, anchor }) => toMcpHighlight({ highlight, state: anchor.anchorState }));
			return { status: "ready", articleId: article.id.value, readlist, highlights };
		},

		createHighlight: async ({ userId, id, quote, note, textBefore }) => {
			const owned = await deps.resolveOwnedArticle({ userId, id });
			if (!owned) return { status: "not_found" };
			const { article, readlist } = owned;
			const stored = await deps.readArticleContent({ url: article.url, viewer: viewerFor(userId) });
			if (stored.kind === "not-an-article") return { status: "not_an_article" };
			if (stored.kind === "missing") return { status: "pending" };
			const { text } = prepareReaderContent({
				content: stored.body,
				appOrigin: deps.appOrigin,
				url: article.url,
				section: WHOLE_DOCUMENT_SECTION,
			});
			const located = locateQuoteInText({ text, quote, textBefore });
			if (located.status === "not-found") return { status: "quote_not_found" };
			if (located.status === "ambiguous") return { status: "quote_ambiguous", matches: located.matches };
			const snapshot = await deps.readCanonicalSnapshot(article.url);
			const outcome = await deps.createHighlight({
				text,
				contentHash: snapshot?.canonicalContentHash ?? servedContentHash(text),
				candidateId: snapshot?.canonicalCandidateId,
				userId,
				url: ArticleResourceUniqueId.parse(article.url).value,
				exact: text.slice(located.start, located.end),
				start: located.start,
				end: located.end,
				note,
			});
			switch (outcome.status) {
				case "created":
				case "merged":
					return {
						status: outcome.status,
						articleId: article.id.value,
						readlist,
						highlight: toMcpHighlight({ highlight: outcome.highlight, state: "anchored" }),
					};
				case "cancelled":
					return { status: "conflict" };
				case "passage-changed":
					return { status: "quote_not_found" };
				case "too-long":
					return { status: "too_long", limit: HIGHLIGHT_MAX_EXACT_LENGTH };
				case "notes-too-long":
					return { status: "too_long", limit: HIGHLIGHT_NOTE_MAX_LENGTH };
			}
		},
	};
}
