import type { Minutes, SavedArticle } from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { destinationUrl, siteLabel } from "../../../test-helpers/article-fixtures";
import { cardProcessingOf } from "./card-processing";

const NOW = new Date("2026-11-05T10:03:20.000Z");
const URL_SAVED = "https://example.com/article";

function makeArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: ReaderArticleHashId.from(URL_SAVED),
		userId: "test-user-id" as UserId,
		url: URL_SAVED,
		destinationUrl: destinationUrl(URL_SAVED),
		metadata: { title: "T", siteName: siteLabel("Example"), excerpt: "", wordCount: 0 },
		servedBody: { kind: "legacy" },
		estimatedReadTime: 1 as Minutes,
		status: "unread",
		savedAt: new Date("2026-03-04T10:00:00.000Z"),
		...overrides,
	};
}

function pendingFor(seconds: number): ArticleCrawl {
	return { status: "pending", startedAt: new Date(NOW.getTime() - seconds * 1000).toISOString(), stage: "crawl-fetching" };
}

function processing(overrides: Partial<Parameters<typeof cardProcessingOf>[0]> = {}) {
	return cardProcessingOf({
		article: makeArticle(),
		crawl: undefined,
		summary: undefined,
		now: NOW,
		pollCount: 4,
		maxPolls: 300,
		...overrides,
	});
}

describe("cardProcessingOf", () => {
	it("keeps a row with no crawl or summary yet processing, with no estimate, on the current poll", () => {
		expect(processing().phase).toEqual({ kind: "processing", pollCursor: 4 });
	});

	it("estimates the seconds left while the crawl is pending, in each of its kinds", () => {
		expect(processing({ crawl: pendingFor(2) }).phase).toEqual({
			kind: "processing",
			pollCursor: 4,
			estimate: { kind: "quiet", revealInSeconds: 3, seconds: 148 },
		});
		expect(processing({ crawl: pendingFor(40) }).phase).toEqual({
			kind: "processing",
			pollCursor: 4,
			estimate: { kind: "counting", seconds: 120 },
		});
		expect(processing({ crawl: pendingFor(200) }).phase).toEqual({
			kind: "processing",
			pollCursor: 4,
			estimate: { kind: "almost-there" },
		});
	});

	it("gives no estimate once only the summary is pending", () => {
		expect(processing({ crawl: { status: "ready" }, summary: { status: "pending" } }).phase).toEqual({
			kind: "processing",
			pollCursor: 4,
		});
	});

	it("ends on a failed crawl and on a non-article host", () => {
		expect(processing({ crawl: { status: "failed", outcomeRevision: 1, reason: "boom" } }).phase).toEqual({
			kind: "terminal",
		});
		const webmail = "https://mail.google.com/mail/u/0/";
		expect(processing({ article: makeArticle({ url: webmail }) }).phase).toEqual({ kind: "terminal" });
	});

	it("goes stale only past the poll budget", () => {
		expect(processing({ pollCount: 300 }).phase).toEqual({ kind: "processing", pollCursor: 300 });
		expect(processing({ pollCount: 301 }).phase).toEqual({ kind: "stale" });
	});

	it("labels the work whatever the phase, naming a book's", () => {
		const book = makeArticle({ media: { kind: "book", fileName: "dune.epub", routeId: ReaderArticleHashId.from(URL_SAVED) } });
		expect(processing().label).toBe("Processing");
		expect(processing({ article: book }).label).toBe("Preparing your book…");
		expect(processing({ article: book, crawl: { status: "failed", outcomeRevision: 1, reason: "boom" } }).label).toBe(
			"Preparing your book…",
		);
	});
});
