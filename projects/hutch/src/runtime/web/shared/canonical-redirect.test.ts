import assert from "node:assert/strict";
import type { Minutes } from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { GlobalArticleData } from "@packages/provider-contracts/article-store";
import { canonicalRedirectTarget } from "./canonical-redirect";

const REQUESTED = "https://medium.com/p/9aceb0bdee03";
const CANONICAL = "https://fagnerbrack.com/the-post";

function row(overrides: Partial<GlobalArticleData> & { url: string }): GlobalArticleData {
	return {
		id: ReaderArticleHashId.from(overrides.url),
		metadata: { title: "T", siteName: "s", excerpt: "", wordCount: 0 },
		estimatedReadTime: 0 as Minutes,
		savedAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
}

describe("canonicalRedirectTarget", () => {
	it("returns undefined when the row is missing", () => {
		assert.equal(canonicalRedirectTarget({ requestedUrl: REQUESTED, article: null }), undefined);
	});

	it("returns undefined when the row carries no canonical pointer", () => {
		assert.equal(
			canonicalRedirectTarget({ requestedUrl: REQUESTED, article: row({ url: REQUESTED }) }),
			undefined,
		);
	});

	it("returns undefined when the pointer resolves to the same storage identity (never a redirect loop)", () => {
		// Scheme is stripped from the storage identity, so an http↔https pointer is
		// not a cross-identity alias — the reader renders the requested url in place.
		assert.equal(
			canonicalRedirectTarget({
				requestedUrl: REQUESTED,
				article: row({ url: REQUESTED, canonicalUrl: "http://medium.com/p/9aceb0bdee03" }),
			}),
			undefined,
		);
	});

	it("returns the canonical url when the pointer names a different storage identity", () => {
		assert.equal(
			canonicalRedirectTarget({
				requestedUrl: REQUESTED,
				article: row({ url: REQUESTED, canonicalUrl: CANONICAL }),
			}),
			CANONICAL,
		);
	});
});
