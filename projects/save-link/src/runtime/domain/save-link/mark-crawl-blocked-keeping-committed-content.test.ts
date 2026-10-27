import type { Article } from "@packages/domain/article-aggregate";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import { markCrawlBlockedKeepingCommittedContent } from "./mark-crawl-blocked-keeping-committed-content";

const NOW = "2026-10-27T00:00:00.000Z";
const STORED_BODY = "<article><p>The stored body a reader has already read in full.</p></article>";
const RATE_LIMITED = { reason: { kind: "blocked", cause: "rate-limited" }, now: NOW } as const;

function forcedPendingArticle(canonicalContentHash: string | undefined): Article {
	return {
		url: "https://example.com/article",
		metadata: { title: "Title", siteName: "example.com", excerpt: "Excerpt", wordCount: 1274 },
		freshness: { contentFetchedAt: "2026-08-20T00:00:00.000Z", canonicalContentHash },
		estimatedReadTime: 6,
		crawl: { kind: "pending", pendingSince: "2026-10-22T07:38:00.000Z" },
		summary: { kind: "skipped", reason: "crawl-failed" },
		summaryAutoHeal: { attempts: 0 },
		readerAvailableAt: "2026-08-20T00:00:00.000Z",
		contentSelection: { tier: "tier-1", contentLocation: "s3://content/stored.html" },
	};
}

describe("markCrawlBlockedKeepingCommittedContent", () => {
	it("keeps an article that holds a stored body ready when its re-crawl is rate-limited, and re-arms its summary", () => {
		const before = forcedPendingArticle(computeCanonicalContentHash(STORED_BODY));

		const { article, effects } = markCrawlBlockedKeepingCommittedContent(before, RATE_LIMITED);

		expect(article.crawl).toEqual({ kind: "ready" });
		expect(article.summary).toEqual({ kind: "pending", pendingSince: NOW });
		expect(effects).toContainEqual({ kind: "generate-summary", url: "https://example.com/article" });
		expect(article.freshness).toEqual(before.freshness);
		expect(article.metadata).toEqual(before.metadata);
		expect(article.contentSelection).toEqual(before.contentSelection);
		expect(article.readerAvailableAt).toBe("2026-08-20T00:00:00.000Z");
	});

	it.each([
		["holds no stored body", undefined],
		["holds only an empty body", computeCanonicalContentHash("")],
	])("marks the crawl failed as blocked when the article %s", (_label, canonicalContentHash) => {
		const { article } = markCrawlBlockedKeepingCommittedContent(forcedPendingArticle(canonicalContentHash), RATE_LIMITED);

		expect(article.crawl).toEqual({ kind: "failed", reason: { kind: "blocked", cause: "rate-limited" } });
		expect(article.summary).toEqual({ kind: "skipped", reason: "crawl-failed" });
	});
});
