import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { GlobalArticleData } from "@packages/provider-contracts/article-store";
import { initSubmitFreshness } from "./submit-freshness";

const canonicalUrl = "https://example.com/canonical";

function makeGlobalArticle(overrides: Partial<GlobalArticleData> = {}): GlobalArticleData {
	return {
		id: ReaderArticleHashId.from(canonicalUrl),
		url: canonicalUrl,
		metadata: { title: "t", siteName: "s", excerpt: "e", wordCount: 100 },
		estimatedReadTime: MinutesSchema.parse(1),
		savedAt: new Date("2026-06-01T00:00:00.000Z"),
		...overrides,
	};
}

type FreshnessDeps = Parameters<typeof initSubmitFreshness>[0];

function createFreshness(overrides: Partial<FreshnessDeps> = {}) {
	return initSubmitFreshness({
		findArticleByUrl: jest.fn().mockResolvedValue(null),
		findArticleCrawlStatus: jest.fn().mockResolvedValue({ status: "ready" }),
		resolveCanonicalIdentity: async (url) => url,
		publishStaleCheckRequested: jest.fn().mockResolvedValue(undefined),
		...overrides,
	});
}

describe("initSubmitFreshness", () => {
	it("verdicts 'new' for a URL with no article row, without requesting a stale check", async () => {
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({ publishStaleCheckRequested });

		const freshness = await refreshArticleIfStale({ url: "https://example.com/post" });

		expect(freshness).toEqual({ action: "new" });
		expect(publishStaleCheckRequested).not.toHaveBeenCalled();
	});

	it("verdicts 'new' for a tombstoned article so the save revives it with a fresh crawl", async () => {
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest
				.fn()
				.mockResolvedValue(makeGlobalArticle({ purgedAt: new Date("2026-06-02T00:00:00.000Z") })),
			publishStaleCheckRequested,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl });

		expect(freshness).toEqual({ action: "new" });
		expect(publishStaleCheckRequested).not.toHaveBeenCalled();
	});

	it("verdicts 'new' for a crawl-pending row so a stuck stub re-fires its crawl instead of masking as a duplicate", async () => {
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			findArticleCrawlStatus: jest.fn().mockResolvedValue({ status: "pending" }),
			publishStaleCheckRequested,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl });

		expect(freshness).toEqual({ action: "new" });
		expect(publishStaleCheckRequested).not.toHaveBeenCalled();
	});

	it("verdicts 'new' for a legacy row without crawl state so the save modernises it", async () => {
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			findArticleCrawlStatus: jest.fn().mockResolvedValue(undefined),
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl });

		expect(freshness).toEqual({ action: "new" });
	});

	it("verdicts 'skip' for a crawl-ready article and hands staleness to the async stale-check pipeline", async () => {
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			publishStaleCheckRequested,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl });

		expect(freshness).toEqual({ action: "skip" });
		expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: canonicalUrl });
	});

	it("verdicts 'skip' for a crawl-failed article — the stale-check pipeline owns any reprime", async () => {
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			findArticleCrawlStatus: jest.fn().mockResolvedValue({ status: "failed", reason: "x" }),
			publishStaleCheckRequested,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl });

		expect(freshness).toEqual({ action: "skip" });
		expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: canonicalUrl });
	});

	it("keys the lookup and the stale check on the resolved canonical identity, not the submitted alias", async () => {
		const findArticleByUrl = jest.fn().mockResolvedValue(makeGlobalArticle());
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl,
			resolveCanonicalIdentity: async () => canonicalUrl,
			publishStaleCheckRequested,
		});

		await refreshArticleIfStale({ url: "https://alias.example.com/x" });

		expect(findArticleByUrl).toHaveBeenCalledWith(canonicalUrl);
		expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: canonicalUrl });
	});
});
