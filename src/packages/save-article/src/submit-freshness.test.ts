import { MinutesSchema, ReaderArticleHashId, articleDestinationUrl, articleDisplayMetadata } from "@packages/domain/article";
import type { GlobalArticleData } from "@packages/provider-contracts/article-store";
import { initSubmitFreshness } from "./submit-freshness";

const canonicalUrl = "https://example.com/canonical";
const destination = articleDestinationUrl({ url: canonicalUrl, displayUrl: undefined });

function makeGlobalArticle(overrides: Partial<GlobalArticleData> = {}): GlobalArticleData {
	return {
		id: ReaderArticleHashId.from(canonicalUrl),
		url: canonicalUrl,
		destinationUrl: destination,
		metadata: { ...articleDisplayMetadata({ url: canonicalUrl, destinationUrl: destination, title: "t", siteName: "s", excerpt: "e" }), wordCount: 100 },
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
		resolveSaveIdentity: async (url) => ({ url }),
		publishStaleCheckRequested: jest.fn().mockResolvedValue(undefined),
		...overrides,
	});
}

describe("initSubmitFreshness", () => {
	it("verdicts 'new' for a URL with no article row, without requesting a stale check", async () => {
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({ publishStaleCheckRequested });

		const freshness = await refreshArticleIfStale({ url: "https://example.com/post" });

		expect(freshness).toEqual({ action: "new", identity: { url: "https://example.com/post" } });
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

		expect(freshness).toEqual({ action: "new", identity: { url: canonicalUrl } });
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

		expect(freshness).toEqual({ action: "new", identity: { url: canonicalUrl } });
		expect(publishStaleCheckRequested).not.toHaveBeenCalled();
	});

	it("verdicts 'new' for a legacy row without crawl state so the save modernises it", async () => {
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			findArticleCrawlStatus: jest.fn().mockResolvedValue(undefined),
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl });

		expect(freshness).toEqual({ action: "new", identity: { url: canonicalUrl } });
	});

	it("verdicts 'skip' for a crawl-ready article and hands staleness to the async stale-check pipeline", async () => {
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			publishStaleCheckRequested,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl });

		expect(freshness).toEqual({ action: "skip", identity: { url: canonicalUrl } });
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

		expect(freshness).toEqual({ action: "skip", identity: { url: canonicalUrl } });
		expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: canonicalUrl });
	});

	it("keys the lookup and the stale check on the resolved canonical identity, not the submitted alias", async () => {
		const findArticleByUrl = jest.fn().mockResolvedValue(makeGlobalArticle());
		const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl,
			resolveSaveIdentity: async () => ({ url: canonicalUrl }),
			publishStaleCheckRequested,
		});

		await refreshArticleIfStale({ url: "https://alias.example.com/x" });

		expect(findArticleByUrl).toHaveBeenCalledWith(canonicalUrl);
		expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: canonicalUrl });
	});

	describe("an archive capture keyed on its original", () => {
		const snapshot = "https://web.archive.org/web/20081203185222/https://example.com/canonical";
		const keyedOnOriginal = async () => ({ url: canonicalUrl, contentSourceUrl: snapshot });

		it.each([
			{ status: "failed" as const, reason: "x" },
			{ status: "unsupported" as const, reason: "pdf" },
		])("verdicts 'new' when the original's crawl is $status, so the save pins the snapshot and re-primes", async (crawl) => {
			const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
			const { refreshArticleIfStale } = createFreshness({
				findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
				findArticleCrawlStatus: jest.fn().mockResolvedValue(crawl),
				resolveSaveIdentity: keyedOnOriginal,
				publishStaleCheckRequested,
			});

			expect(await refreshArticleIfStale({ url: snapshot })).toEqual({ action: "new", identity: { url: canonicalUrl, contentSourceUrl: snapshot } });
			expect(publishStaleCheckRequested).not.toHaveBeenCalled();
		});

		it("verdicts 'skip' when the original already has live content — it is never re-pointed at the snapshot", async () => {
			const publishStaleCheckRequested = jest.fn().mockResolvedValue(undefined);
			const { refreshArticleIfStale } = createFreshness({
				findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
				resolveSaveIdentity: keyedOnOriginal,
				publishStaleCheckRequested,
			});

			expect(await refreshArticleIfStale({ url: snapshot })).toEqual({ action: "skip", identity: { url: canonicalUrl, contentSourceUrl: snapshot } });
			expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: canonicalUrl });
		});

		it("verdicts 'new' when the original has no row yet", async () => {
			const { refreshArticleIfStale } = createFreshness({ resolveSaveIdentity: keyedOnOriginal });

			expect(await refreshArticleIfStale({ url: snapshot })).toEqual({ action: "new", identity: { url: canonicalUrl, contentSourceUrl: snapshot } });
		});
	});
});
