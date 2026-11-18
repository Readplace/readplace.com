import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	HIGHLIGHT_NOTE_MAX_LENGTH,
	type Highlight,
	type StoredHighlightState,
	viewerFor,
} from "@packages/domain/article";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { ListArticleHighlights } from "@packages/provider-contracts/highlights";
import { initCreateHighlightByQuote } from "../shared/article-body/highlights/create-highlight-by-quote";
import type { CreateReaderHighlight } from "../shared/article-body/highlights/create-reader-highlight";
import {
	prepareReaderContent,
	WHOLE_DOCUMENT_SECTION,
} from "../shared/article-body/reader-slot/reader-content";
import type { ResolveOwnedArticle } from "./article-lookup";
import type { McpHighlight, McpServerDeps } from "./mcp-ports.types";

function justWritten(highlight: Highlight): { highlight: Highlight; shown: StoredHighlightState } {
	return { highlight, shown: { state: "anchored", edited: false, quote: highlight.exact } };
}

function toMcpHighlight(params: { highlight: Highlight; shown: StoredHighlightState }): McpHighlight {
	const { highlight, shown } = params;
	return {
		id: highlight.highlightId,
		quote: shown.quote,
		...(shown.edited ? { highlighted: highlight.exact } : {}),
		...(highlight.note === undefined ? {} : { note: highlight.note }),
		state: shown.state,
		createdAt: highlight.createdAt.toISOString(),
		updatedAt: highlight.updatedAt.toISOString(),
	};
}

export function initMcpHighlightOperations(deps: {
	resolveOwnedArticle: ResolveOwnedArticle;
	readArticleContent: ReadArticleContent;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
	listArticleHighlights: ListArticleHighlights;
	createHighlight: CreateReaderHighlight;
	appOrigin: string;
}): Pick<McpServerDeps, "listHighlights" | "createHighlight"> {
	const createHighlightByQuote = initCreateHighlightByQuote({
		readArticleContent: deps.readArticleContent,
		readCanonicalSnapshot: deps.readCanonicalSnapshot,
		createHighlight: deps.createHighlight,
		appOrigin: deps.appOrigin,
	});
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
				.map(({ highlight, shown }) => toMcpHighlight({ highlight, shown }));
			return { status: "ready", articleId: article.id.value, readlist, highlights };
		},

		createHighlight: async ({ userId, id, quote, note, textBefore }) => {
			const owned = await deps.resolveOwnedArticle({ userId, id });
			if (!owned) return { status: "not_found" };
			const { article, readlist } = owned;
			const outcome = await createHighlightByQuote({ userId, articleUrl: article.url, quote, note, textBefore });
			switch (outcome.status) {
				case "not-an-article":
					return { status: "not_an_article" };
				case "pending":
					return { status: "pending" };
				case "quote-not-found":
					return { status: "quote_not_found" };
				case "quote-ambiguous":
					return { status: "quote_ambiguous", matches: outcome.matches };
				case "created":
				case "merged":
					return {
						status: outcome.status,
						articleId: article.id.value,
						readlist,
						highlight: toMcpHighlight(justWritten(outcome.highlights[outcome.highlights.length - 1])),
					};
				case "unchanged":
				case "noted":
					return {
						status: "merged",
						articleId: article.id.value,
						readlist,
						highlight: toMcpHighlight(justWritten(outcome.highlight)),
					};
				case "cancelled":
					return { status: "conflict" };
				case "passage-changed":
					return { status: "quote_not_found" };
				case "notes-too-long":
					return { status: "too_long", limit: HIGHLIGHT_NOTE_MAX_LENGTH };
			}
		},
	};
}
