import { initInMemoryArticleCrawl } from "./in-memory-article-crawl";

const URL = "https://example.com/article";

describe("initInMemoryArticleCrawl", () => {
	describe("markCrawlStage", () => {
		it("records the stage on a previously-pending row", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "run" });
			await crawl.markCrawlStage({ url: URL, stage: "crawl-fetched" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "pending",
				stage: "crawl-fetched",
			});
		});

		it("creates a pending+stage row when none existed", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlStage({ url: URL, stage: "crawl-fetching" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "pending",
				stage: "crawl-fetching",
			});
		});

		it("does not regress a row that has already gone ready", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlReady({ url: URL });
			await crawl.markCrawlStage({ url: URL, stage: "crawl-content-uploaded" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({ status: "ready" });
		});

		it("does not regress a row that has already failed", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlFailed({ url: URL, reason: "blocked" });
			await crawl.markCrawlStage({ url: URL, stage: "crawl-fetching" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "failed",
				reason: "blocked",
				outcomeRevision: 1,
			});
		});

		it("does not regress a row that has already been marked unsupported", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlUnsupported({
				url: URL,
				reason: "non-html content type: application/pdf",
			});
			await crawl.markCrawlStage({ url: URL, stage: "crawl-fetching" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "unsupported",
				reason: "non-html content type: application/pdf",
			});
		});

		it("preserves the recorded stage when markCrawlPending is re-called (legacy-stub healing path)", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "run" });
			await crawl.markCrawlStage({ url: URL, stage: "crawl-parsed" });
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "run" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "pending",
				stage: "crawl-parsed",
			});
		});
	});

	describe("markCrawlUnsupported", () => {
		it("flips a pending row to unsupported with the supplied reason", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "run" });
			await crawl.markCrawlUnsupported({
				url: URL,
				reason: "non-html content type: application/pdf",
			});

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "unsupported",
				reason: "non-html content type: application/pdf",
			});
		});

		it("does not regress a row that has already gone ready", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlReady({ url: URL });
			await crawl.markCrawlUnsupported({ url: URL, reason: "anything" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({ status: "ready" });
		});
	});

	describe("outcomeRevision", () => {
		it("moves on every terminal write and survives a return to pending, so a failure after a retry reads as a new outcome", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlUnsupported({ url: URL, reason: "non-html" });
			await crawl.forceMarkCrawlPending({ url: URL });
			await crawl.markCrawlFailed({ url: URL, reason: "first" });
			await crawl.forceMarkCrawlPending({ url: URL });
			await crawl.markCrawlFailed({ url: URL, reason: "second" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "failed",
				reason: "second",
				outcomeRevision: 3,
			});
		});

		it("counts a ready write, and does not move when a failure is refused on a ready row", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlReady({ url: URL });
			await crawl.markCrawlFailed({ url: URL, reason: "ignored" });
			await crawl.forceMarkCrawlPending({ url: URL });
			await crawl.markCrawlFailed({ url: URL, reason: "after ready" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "failed",
				reason: "after ready",
				outcomeRevision: 2,
			});
		});
	});

	describe("forceMarkCrawlPending", () => {
		it("overrides an unsupported row so an operator recrawl re-runs the worker", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlUnsupported({ url: URL, reason: "non-html" });
			await crawl.forceMarkCrawlPending({ url: URL });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "pending",
			});
		});
	});

	describe("meteredLegs", () => {
		it("parks a new row as pending with the metered legs deferred", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({ status: "pending" });
			expect(crawl.isMeteredLegsDeferred(URL)).toBe(true);
		});

		it.each([
			{ label: "failed", mark: (crawl: ReturnType<typeof initInMemoryArticleCrawl>) => crawl.markCrawlFailed({ url: URL, reason: "blocked" }) },
			{ label: "unsupported", mark: (crawl: ReturnType<typeof initInMemoryArticleCrawl>) => crawl.markCrawlUnsupported({ url: URL, reason: "non-html" }) },
		])("re-parks a $label row as pending with the metered legs deferred", async ({ mark }) => {
			const crawl = initInMemoryArticleCrawl();
			await mark(crawl);
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({ status: "pending" });
			expect(crawl.isMeteredLegsDeferred(URL)).toBe(true);
		});

		it("leaves a pending row a manual save started unparked", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "run" });
			await crawl.markCrawlStage({ url: URL, stage: "crawl-fetched" });
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({ status: "pending", stage: "crawl-fetched" });
			expect(crawl.isMeteredLegsDeferred(URL)).toBe(false);
		});

		it("leaves a ready row ready and unparked", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlReady({ url: URL });
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({ status: "ready" });
			expect(crawl.isMeteredLegsDeferred(URL)).toBe(false);
		});

		it("lets a manual co-save run the metered legs of a parked row", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });
			await crawl.markCrawlFailed({ url: URL, reason: "blocked" });
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "run" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({ status: "pending" });
			expect(crawl.isMeteredLegsDeferred(URL)).toBe(false);
		});

		it("clears the parked marker of a ready row on a run save and keeps it ready", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });
			await crawl.markCrawlReady({ url: URL });
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "run" });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({ status: "ready" });
			expect(crawl.isMeteredLegsDeferred(URL)).toBe(false);
		});

		it("lets an operator recrawl run the metered legs of a parked row", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL, measured: false, meteredLegs: "deferred" });
			await crawl.forceMarkCrawlPending({ url: URL });

			expect(crawl.isMeteredLegsDeferred(URL)).toBe(false);
		});
	});
});
