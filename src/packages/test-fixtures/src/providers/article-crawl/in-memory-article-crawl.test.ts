import { initInMemoryArticleCrawl } from "./in-memory-article-crawl";

const URL = "https://example.com/article";

describe("initInMemoryArticleCrawl", () => {
	describe("markCrawlStage", () => {
		it("records the stage on a previously-pending row", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL });
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
			});
		});

		it("preserves the recorded stage when markCrawlPending is re-called (legacy-stub healing path)", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.markCrawlPending({ url: URL });
			await crawl.markCrawlStage({ url: URL, stage: "crawl-parsed" });
			await crawl.markCrawlPending({ url: URL });

			expect(await crawl.findArticleCrawlStatus(URL)).toEqual({
				status: "pending",
				stage: "crawl-parsed",
			});
		});
	});

	describe("incrementCrawlAutoHealAttempt", () => {
		const NOW_ISO = "2026-05-10T05:00:00.000Z";
		const MAX = 3;
		const TTL_MS = 24 * 60 * 60 * 1000;

		it("returns 'reprimed' on the first attempt and records the count", async () => {
			const crawl = initInMemoryArticleCrawl();
			expect(
				await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS }),
			).toBe("reprimed");
		});

		it("returns 'reprimed' for attempts strictly under the cap", async () => {
			const crawl = initInMemoryArticleCrawl();
			await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS });
			await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS });
			expect(
				await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS }),
			).toBe("reprimed");
		});

		it("returns 'capped' once the cap is hit within the TTL window", async () => {
			const crawl = initInMemoryArticleCrawl();
			for (let i = 0; i < MAX; i += 1) {
				await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS });
			}
			expect(
				await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS }),
			).toBe("capped");
		});

		it("re-allows reprime once the TTL window since the last attempt has elapsed", async () => {
			const crawl = initInMemoryArticleCrawl();
			for (let i = 0; i < MAX; i += 1) {
				await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS });
			}
			const laterIso = new Date(new Date(NOW_ISO).getTime() + TTL_MS + 1).toISOString();
			expect(
				await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: laterIso, maxAttempts: MAX, ttlMs: TTL_MS }),
			).toBe("reprimed");
		});

		it("clears the auto-heal counter when markCrawlReady runs (mirrors prod promote reset)", async () => {
			const crawl = initInMemoryArticleCrawl();
			for (let i = 0; i < MAX; i += 1) {
				await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS });
			}
			await crawl.markCrawlReady({ url: URL });
			expect(
				await crawl.incrementCrawlAutoHealAttempt({ url: URL, nowIso: NOW_ISO, maxAttempts: MAX, ttlMs: TTL_MS }),
			).toBe("reprimed");
		});
	});
});
