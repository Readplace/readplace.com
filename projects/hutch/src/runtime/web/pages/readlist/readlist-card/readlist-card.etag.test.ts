import assert from "node:assert/strict";
import type { Minutes, SavedArticle } from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { destinationUrl, siteLabel } from "../../../test-helpers/article-fixtures";
import type { ReaderProvenance } from "../../../shared/article-body/article-header/provenance-label";
import { computeArticleContentVersion } from "../../../shared/article-content-version";
import { computeReadlistCardEtag } from "./readlist-card.etag";

const ARTICLE_URL = "https://example.com/post";

function makeArticle(overrides?: Partial<SavedArticle>): SavedArticle {
	return {
		id: ReaderArticleHashId.from(ARTICLE_URL),
		userId: "user-1" as UserId,
		url: ARTICLE_URL,
		destinationUrl: destinationUrl(ARTICLE_URL),
		metadata: {
			title: "Test Article",
			siteName: siteLabel("example.com"),
			excerpt: "An excerpt",
			wordCount: 500,
		},
		servedBody: { kind: "legacy" },
		estimatedReadTime: 3 as Minutes,
		status: "unread",
		savedAt: new Date("2025-06-01T12:00:00Z"),
		...overrides,
	};
}

describe("computeReadlistCardEtag", () => {
	it("returns a weak ETag", () => {
		const etag = computeReadlistCardEtag({
			article: makeArticle(),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: undefined,
		});
		assert(etag.startsWith('W/"'));
		assert(etag.endsWith('"'));
	});

	it("keeps the three-segment tag a card without a via always carried, so a web card still polling across the deploy answers 304", () => {
		const article = makeArticle();
		const crawl = { status: "ready" as const };
		const summary = { status: "ready" as const, summary: "TL;DR" };

		const etag = computeReadlistCardEtag({ article, crawl, summary, readerProvenance: undefined });

		expect(etag).toMatch(/^W\/"[0-9a-f]{32}:[a-z]+:[0-9a-f]+"$/);
		expect(etag).toBe(`W/"${article.id.value}:${article.status}:${computeArticleContentVersion({ article, crawl, summary })}"`);
	});

	it("is stable across calls with the same input", () => {
		const input = {
			article: makeArticle(),
			crawl: { status: "ready" as const },
			summary: { status: "ready" as const, summary: "TL;DR" },
			readerProvenance: undefined,
		};
		expect(computeReadlistCardEtag(input)).toBe(computeReadlistCardEtag(input));
	});

	it("changes when crawlStatus changes", () => {
		const article = makeArticle();
		const a = computeReadlistCardEtag({ article, crawl: { status: "pending" }, summary: undefined, readerProvenance: undefined });
		const b = computeReadlistCardEtag({ article, crawl: { status: "ready" }, summary: undefined, readerProvenance: undefined });
		expect(a).not.toBe(b);
	});

	it("changes when summaryStatus changes", () => {
		const article = makeArticle();
		const a = computeReadlistCardEtag({ article, crawl: { status: "ready" }, summary: { status: "pending" }, readerProvenance: undefined });
		const b = computeReadlistCardEtag({ article, crawl: { status: "ready" }, summary: { status: "ready", summary: "TL;DR" }, readerProvenance: undefined });
		expect(a).not.toBe(b);
	});

	it("changes when wordCount changes", () => {
		const a = computeReadlistCardEtag({
			article: makeArticle({ metadata: { title: "T", siteName: siteLabel("s.com"), excerpt: "e", wordCount: 0 } }),
			crawl: { status: "pending" },
			summary: { status: "pending" },
			readerProvenance: undefined,
		});
		const b = computeReadlistCardEtag({
			article: makeArticle({ metadata: { title: "T", siteName: siteLabel("s.com"), excerpt: "e", wordCount: 750 } }),
			crawl: { status: "pending" },
			summary: { status: "pending" },
			readerProvenance: undefined,
		});
		expect(a).not.toBe(b);
	});

	it("changes when imageUrl is filled in late by the S3 thumbnail copy", () => {
		const without = computeReadlistCardEtag({
			article: makeArticle({ metadata: { title: "T", siteName: siteLabel("s.com"), excerpt: "e", wordCount: 500 } }),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: undefined,
		});
		const withImage = computeReadlistCardEtag({
			article: makeArticle({
				metadata: { title: "T", siteName: siteLabel("s.com"), excerpt: "e", wordCount: 500, imageUrl: "https://cdn.example.com/img.jpg" },
			}),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: undefined,
		});
		expect(without).not.toBe(withImage);
	});

	it("changes when contentFetchedAt advances even though every metadata field is identical", () => {
		const earlier = computeReadlistCardEtag({
			article: makeArticle({ contentFetchedAt: new Date("2026-01-01T00:00:00Z") }),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: undefined,
		});
		const later = computeReadlistCardEtag({
			article: makeArticle({ contentFetchedAt: new Date("2026-02-01T00:00:00Z") }),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: undefined,
		});
		expect(earlier).not.toBe(later);
	});

	it("changes when the user-visible status flips between read and unread", () => {
		const unread = computeReadlistCardEtag({
			article: makeArticle({ status: "unread" }),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: undefined,
		});
		const read = computeReadlistCardEtag({
			article: makeArticle({ status: "read", readAt: new Date("2025-06-02T00:00:00Z") }),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: undefined,
		});
		expect(unread).not.toBe(read);
	});

	it("changes when the catalog starts naming the sender, so a 304 never keeps the address on a card that would now show the name", () => {
		const article = makeArticle();
		const address = computeReadlistCardEtag({
			article,
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: { kind: "email", senderEmail: "dan@tldr.tech" },
		});
		const named = computeReadlistCardEtag({
			article,
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
			readerProvenance: { kind: "newsletter", name: "TLDR", senderEmail: "dan@tldr.tech" },
		});
		expect(address).not.toBe(named);
	});

	it("changes when a re-save brings an emailed provenance to a card that showed none, and ignores provenances the card never renders", () => {
		const article = makeArticle();
		const etagFor = (readerProvenance: ReaderProvenance | undefined) =>
			computeReadlistCardEtag({ article, crawl: { status: "ready" }, summary: undefined, readerProvenance });

		expect(etagFor({ kind: "web" })).toBe(etagFor(undefined));
		expect(etagFor({ kind: "email", senderEmail: "news@example.com" })).not.toBe(etagFor({ kind: "web" }));
	});
});
