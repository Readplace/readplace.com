import { MinutesSchema, ReaderArticleHashId, articleDestinationUrl, articleDisplayMetadata, ANONYMOUS_VIEWER } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type { GlobalArticleData } from "@packages/provider-contracts/article-store";
import { initSubmitFreshness } from "./submit-freshness";

const canonicalUrl = "https://example.com/canonical";
const requester = { account: UserIdSchema.parse("user-1") };
const destination = articleDestinationUrl({ url: canonicalUrl, displayUrl: undefined });

function makeGlobalArticle(overrides: Partial<GlobalArticleData> = {}): GlobalArticleData {
	return {
		id: ReaderArticleHashId.from(canonicalUrl),
		url: canonicalUrl,
		destinationUrl: destination,
		metadata: articleDisplayMetadata({ url: canonicalUrl, destinationUrl: destination, title: "t", siteName: "s", excerpt: "e", wordCount: 100, imageUrl: undefined, publishedOn: undefined, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined }),
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
		resolveSaveIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
		requestStaleCheck: jest.fn().mockResolvedValue(undefined),
		...overrides,
	});
}

describe("initSubmitFreshness", () => {
	it("verdicts 'new' for a URL with no article row, without requesting a stale check", async () => {
		const requestStaleCheck = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({ requestStaleCheck });

		const freshness = await refreshArticleIfStale({ url: "https://example.com/post", requester });

		expect(freshness).toEqual({ action: "new", identity: { status: "resolved", originalUrl: "https://example.com/post", url: "https://example.com/post" } });
		expect(requestStaleCheck).not.toHaveBeenCalled();
	});

	it("verdicts 'new' for a tombstoned article so the save revives it with a fresh crawl", async () => {
		const requestStaleCheck = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest
				.fn()
				.mockResolvedValue(makeGlobalArticle({ purgedAt: new Date("2026-06-02T00:00:00.000Z") })),
			requestStaleCheck,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl, requester });

		expect(freshness).toEqual({ action: "new", identity: { status: "resolved", originalUrl: canonicalUrl, url: canonicalUrl } });
		expect(requestStaleCheck).not.toHaveBeenCalled();
	});

	it("verdicts 'new' for a crawl-pending row so a stuck stub re-fires its crawl instead of masking as a duplicate", async () => {
		const requestStaleCheck = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			findArticleCrawlStatus: jest.fn().mockResolvedValue({ status: "pending" }),
			requestStaleCheck,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl, requester });

		expect(freshness).toEqual({ action: "new", identity: { status: "resolved", originalUrl: canonicalUrl, url: canonicalUrl } });
		expect(requestStaleCheck).not.toHaveBeenCalled();
	});

	it("verdicts 'new' for a legacy row without crawl state so the save modernises it", async () => {
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			findArticleCrawlStatus: jest.fn().mockResolvedValue(undefined),
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl, requester });

		expect(freshness).toEqual({ action: "new", identity: { status: "resolved", originalUrl: canonicalUrl, url: canonicalUrl } });
	});

	it("verdicts 'skip' for a crawl-ready article and hands staleness to the async stale-check pipeline", async () => {
		const requestStaleCheck = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			requestStaleCheck,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl, requester });

		expect(freshness).toEqual({ action: "skip", identity: { status: "resolved", originalUrl: canonicalUrl, url: canonicalUrl } });
		expect(requestStaleCheck).toHaveBeenCalledWith({ url: canonicalUrl, requester });
	});

	it("verdicts 'skip' for a crawl-failed article — the stale-check pipeline owns any reprime", async () => {
		const requestStaleCheck = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
			findArticleCrawlStatus: jest.fn().mockResolvedValue({ status: "failed", reason: "x" }),
			requestStaleCheck,
		});

		const freshness = await refreshArticleIfStale({ url: canonicalUrl, requester });

		expect(freshness).toEqual({ action: "skip", identity: { status: "resolved", originalUrl: canonicalUrl, url: canonicalUrl } });
		expect(requestStaleCheck).toHaveBeenCalledWith({ url: canonicalUrl, requester });
	});

	it("keys the lookup and the stale check on the resolved canonical identity, not the submitted alias", async () => {
		const findArticleByUrl = jest.fn().mockResolvedValue(makeGlobalArticle());
		const requestStaleCheck = jest.fn().mockResolvedValue(undefined);
		const { refreshArticleIfStale } = createFreshness({
			findArticleByUrl,
			resolveSaveIdentity: async () => ({ status: "resolved", url: canonicalUrl, originalUrl: canonicalUrl }),
			requestStaleCheck,
		});

		await refreshArticleIfStale({ url: "https://alias.example.com/x", requester });

		expect(findArticleByUrl).toHaveBeenCalledWith(canonicalUrl);
		expect(requestStaleCheck).toHaveBeenCalledWith({ url: canonicalUrl, requester });
	});

	describe("an archive capture keyed on its original", () => {
		const snapshot = "https://web.archive.org/web/20081203185222/https://example.com/canonical";
		const keyedOnOriginal = async () => ({ status: "resolved" as const, url: canonicalUrl, originalUrl: canonicalUrl, contentSourceUrl: snapshot, sourceOriginalUrl: canonicalUrl });

		it.each([
			{ status: "failed" as const, reason: "x" },
			{ status: "unsupported" as const, reason: "pdf" },
		])("verdicts 'new' when the original's crawl is $status, so the save pins the snapshot and re-primes", async (crawl) => {
			const requestStaleCheck = jest.fn().mockResolvedValue(undefined);
			const { refreshArticleIfStale } = createFreshness({
				findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
				findArticleCrawlStatus: jest.fn().mockResolvedValue(crawl),
				resolveSaveIdentity: keyedOnOriginal,
				requestStaleCheck,
			});

			expect(await refreshArticleIfStale({ url: snapshot, requester })).toEqual({ action: "new", identity: { status: "resolved", originalUrl: canonicalUrl, url: canonicalUrl, contentSourceUrl: snapshot, sourceOriginalUrl: canonicalUrl } });
			expect(requestStaleCheck).not.toHaveBeenCalled();
		});

		it("verdicts 'skip' when the original already has live content — it is never re-pointed at the snapshot", async () => {
			const requestStaleCheck = jest.fn().mockResolvedValue(undefined);
			const { refreshArticleIfStale } = createFreshness({
				findArticleByUrl: jest.fn().mockResolvedValue(makeGlobalArticle()),
				resolveSaveIdentity: keyedOnOriginal,
				requestStaleCheck,
			});

			expect(await refreshArticleIfStale({ url: snapshot, requester })).toEqual({ action: "skip", identity: { status: "resolved", originalUrl: canonicalUrl, url: canonicalUrl, contentSourceUrl: snapshot, sourceOriginalUrl: canonicalUrl } });
			expect(requestStaleCheck).not.toHaveBeenCalled();
		});

		it("verdicts 'new' when the original has no row yet", async () => {
			const { refreshArticleIfStale } = createFreshness({ resolveSaveIdentity: keyedOnOriginal });

			expect(await refreshArticleIfStale({ url: snapshot, requester })).toEqual({ action: "new", identity: { status: "resolved", originalUrl: canonicalUrl, url: canonicalUrl, contentSourceUrl: snapshot, sourceOriginalUrl: canonicalUrl } });
		});
	});
});


it("does not query article state or publish freshness events for an unresolved wrapper", async () => {
	const findArticleByUrl = jest.fn();
	const findArticleCrawlStatus = jest.fn();
	const requestStaleCheck = jest.fn();
	const identity = { status: "unresolved" as const };
	const { refreshArticleIfStale } = createFreshness({ findArticleByUrl, findArticleCrawlStatus, requestStaleCheck, resolveSaveIdentity: async () => identity });
	expect(await refreshArticleIfStale({ url: "https://archive.ph/abc", requester })).toEqual({ action: "unresolved", identity });
	expect(findArticleByUrl).not.toHaveBeenCalled();
	expect(findArticleCrawlStatus).not.toHaveBeenCalled();
	expect(requestStaleCheck).not.toHaveBeenCalled();
});
