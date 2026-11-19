import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { locateQuote, type QuoteLocation, viewerFor } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import type { UserId } from "@packages/domain/user";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import { parseHTML } from "linkedom";
import { prepareReaderContent, WHOLE_DOCUMENT_SECTION } from "../reader-slot/reader-content";
import { servedContentHash } from "../reader-slot/served-content-hash";
import type { CreateReaderHighlight, CreateReaderHighlightOutcome } from "./create-reader-highlight";

export type CreateHighlightByQuoteOutcome =
	| { status: "not-an-article" }
	| { status: "pending" }
	| { status: "quote-not-found" }
	| { status: "quote-ambiguous"; matches: number }
	| CreateReaderHighlightOutcome;

export type CreateHighlightByQuote = (params: {
	userId: UserId;
	articleUrl: string;
	quote: string;
	note?: string;
	textBefore?: string;
}) => Promise<CreateHighlightByQuoteOutcome>;

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

function locateQuoteInText(params: { text: string; quote: string; textBefore?: string }): QuoteLocation {
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

export function initCreateHighlightByQuote(deps: {
	readArticleContent: ReadArticleContent;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
	createHighlight: CreateReaderHighlight;
	appOrigin: string;
}): CreateHighlightByQuote {
	return async ({ userId, articleUrl, quote, note, textBefore }) => {
		const stored = await deps.readArticleContent({ url: articleUrl, viewer: viewerFor(userId) });
		if (stored.kind === "not-an-article") return { status: "not-an-article" };
		if (stored.kind === "missing") return { status: "pending" };
		const { text } = prepareReaderContent({
			content: stored.body,
			appOrigin: deps.appOrigin,
			url: articleUrl,
			section: WHOLE_DOCUMENT_SECTION,
		});
		const located = locateQuoteInText({ text, quote, textBefore });
		if (located.status === "not-found") return { status: "quote-not-found" };
		if (located.status === "ambiguous") return { status: "quote-ambiguous", matches: located.matches };
		const snapshot = await deps.readCanonicalSnapshot(articleUrl);
		return deps.createHighlight({
			text,
			contentHash: snapshot?.canonicalContentHash ?? servedContentHash(text),
			candidateId: snapshot?.canonicalCandidateId,
			userId,
			url: ArticleResourceUniqueId.parse(articleUrl).value,
			exact: text.slice(located.start, located.end),
			start: located.start,
			end: located.end,
			note,
		});
	};
}
