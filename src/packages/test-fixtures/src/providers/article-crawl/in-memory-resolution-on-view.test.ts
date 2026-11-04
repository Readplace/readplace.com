import { ANONYMOUS_VIEWER, viewerFor } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGeneratedSummary } from "../article-summary/in-memory-generated-summary";
import { initInMemoryArticleCrawl } from "./in-memory-article-crawl";
import { initInMemoryClaimResolutionOnView } from "./in-memory-resolution-on-view";

const URL = "https://example.com/article";
const OWNER = UserIdSchema.parse("owner-user");

function setup(owner = OWNER) {
	const crawl = initInMemoryArticleCrawl();
	const summary = initInMemoryGeneratedSummary({ findItemOwner: async () => owner });
	const claim = initInMemoryClaimResolutionOnView({ crawl, summary, findItemOwner: async () => owner });
	return { crawl, summary, claim };
}

describe("initInMemoryClaimResolutionOnView", () => {
	describe("crawl-and-summary", () => {
		it.each([
			{ label: "failed", mark: (crawl: ReturnType<typeof initInMemoryArticleCrawl>) => crawl.markCrawlFailed({ url: URL, reason: "blocked" }) },
			{ label: "unsupported", mark: (crawl: ReturnType<typeof initInMemoryArticleCrawl>) => crawl.markCrawlUnsupported({ url: URL, reason: "awaiting-reader" }) },
		])("claims a $label crawl, moving both axes to pending and resuming the metered legs", async ({ mark }) => {
			const { crawl, summary, claim } = setup();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });
			await mark(crawl);
			await summary.markSummarySkipped({ url: URL, reason: "awaiting-reader" });

			const result = await claim({ url: URL, axes: "crawl-and-summary", viewer: viewerFor(OWNER) });

			expect(result).toEqual({ kind: "claimed", crawl: { status: "pending" }, summary: { status: "pending" } });
			expect(crawl.isMeteredLegsDeferred(URL)).toBe(false);
		});

		it("lets only the first of two concurrent claims through", async () => {
			const { crawl, claim } = setup();
			await crawl.markCrawlFailed({ url: URL, reason: "blocked" });

			const results = await Promise.all([
				claim({ url: URL, axes: "crawl-and-summary", viewer: ANONYMOUS_VIEWER }),
				claim({ url: URL, axes: "crawl-and-summary", viewer: ANONYMOUS_VIEWER }),
			]);

			expect(results.map((r) => r.kind)).toEqual(["claimed", "not-eligible"]);
		});

		it("answers not-eligible for a ready crawl", async () => {
			const { crawl, claim } = setup();
			await crawl.markCrawlReady({ url: URL });

			expect(await claim({ url: URL, axes: "crawl-and-summary", viewer: ANONYMOUS_VIEWER })).toEqual({ kind: "not-eligible" });
		});
	});

	describe("summary", () => {
		it.each([
			{ label: "skipped awaiting the reader", mark: (summary: ReturnType<typeof initInMemoryGeneratedSummary>) => summary.markSummarySkipped({ url: URL, reason: "awaiting-reader" }) },
			{ label: "skipped for an unavailable AI", mark: (summary: ReturnType<typeof initInMemoryGeneratedSummary>) => summary.markSummarySkipped({ url: URL, reason: "ai-unavailable" }) },
			{ label: "that failed", mark: (summary: ReturnType<typeof initInMemoryGeneratedSummary>) => summary.markSummaryFailed({ url: URL, reason: "deepseek-call-failed" }) },
		])("claims a ready crawl's summary $label, resuming the metered legs", async ({ mark }) => {
			const { crawl, summary, claim } = setup();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });
			await crawl.markCrawlReady({ url: URL });
			await mark(summary);

			const result = await claim({ url: URL, axes: "summary", viewer: viewerFor(OWNER) });

			expect(result).toEqual({ kind: "claimed", crawl: { status: "ready" }, summary: { status: "pending" } });
			expect(crawl.isMeteredLegsDeferred(URL)).toBe(false);
		});

		it("hands a non-owner a skipped summary for a private item it claimed", async () => {
			const privateUrl = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
			const crawl = initInMemoryArticleCrawl();
			const summary = initInMemoryGeneratedSummary({ findItemOwner: async () => OWNER });
			const claim = initInMemoryClaimResolutionOnView({ crawl, summary, findItemOwner: async () => OWNER });
			await crawl.markCrawlReady({ url: privateUrl });
			await summary.markSummarySkipped({ url: privateUrl, reason: "ai-unavailable" });

			const result = await claim({ url: privateUrl, axes: "summary", viewer: viewerFor(UserIdSchema.parse("someone-else")) });

			expect(result).toEqual({ kind: "claimed", crawl: { status: "ready" }, summary: { status: "skipped" } });
			expect(summary.summaryStateOf(privateUrl)).toEqual({ status: "pending" });
		});

		it.each([
			{ label: "summary skipped as too short", reason: "content-too-short" },
			{ label: "summary skipped without a reason", reason: undefined },
		])("answers not-eligible for a ready crawl's $label", async ({ reason }) => {
			const { crawl, summary, claim } = setup();
			await crawl.markCrawlReady({ url: URL });
			await summary.markSummarySkipped({ url: URL, reason });

			expect(await claim({ url: URL, axes: "summary", viewer: ANONYMOUS_VIEWER })).toEqual({ kind: "not-eligible" });
		});

		it("answers not-eligible when the crawl is not ready", async () => {
			const { crawl, claim } = setup();
			await crawl.markCrawlFailed({ url: URL, reason: "blocked" });

			expect(await claim({ url: URL, axes: "summary", viewer: ANONYMOUS_VIEWER })).toEqual({ kind: "not-eligible" });
		});
	});
});
