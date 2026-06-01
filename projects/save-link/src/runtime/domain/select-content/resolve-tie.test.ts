import type { Article } from "@packages/domain/article-aggregate";
import { initResolveTie } from "./resolve-tie";
import type { FindContentSourceTier } from "../../providers/article-store/find-content-source-tier";
import type { TierSource, TierSourceMetadata } from "./tier-source.types";

const stubMetadata: TierSourceMetadata = {
	title: "Title",
	siteName: "example.com",
	excerpt: "excerpt",
	wordCount: 100,
	estimatedReadTime: 1,
};

function source(tier: TierSource["tier"], html = `<p>${tier} html</p>`): TierSource {
	return { tier, html, metadata: stubMetadata };
}

function articleWithSummary(summary: Article["summary"]): Article {
	return {
		url: "https://example.com/a",
		metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary,
		summaryAutoHeal: { attempts: 0 },
	};
}

describe("initResolveTie", () => {
	it("promotes the fresh tier when media differs, without consulting the existing canonical", async () => {
		const findContentSourceTier: jest.MockedFunction<FindContentSourceTier> = jest.fn();
		const loadArticle = jest.fn();
		const resolveTie = initResolveTie({ findContentSourceTier, loadArticle });

		const result = await resolveTie({
			sources: [
				source("tier-0", '<p>body</p><img src="https://cdn/old.png">'),
				source("tier-1", '<p>body</p><img src="https://cdn/new.png">'),
			],
			freshTier: "tier-1",
			url: "https://example.com/a",
		});

		expect(result).toEqual({
			kind: "promote",
			tier: "tier-1",
			reason: "media changed on prose tie; promoted tier-1",
			existingTier: undefined,
		});
		expect(findContentSourceTier).not.toHaveBeenCalled();
		expect(loadArticle).not.toHaveBeenCalled();
	});

	it("keeps the canonical when it exists and the summary is healthy", async () => {
		const resolveTie = initResolveTie({
			findContentSourceTier: jest.fn<ReturnType<FindContentSourceTier>, Parameters<FindContentSourceTier>>().mockResolvedValue("tier-1"),
			loadArticle: jest.fn().mockResolvedValue(
				articleWithSummary({ kind: "ready", summary: "ok" }),
			),
		});

		const result = await resolveTie({
			sources: [source("tier-0"), source("tier-1")],
			freshTier: "tier-1",
			url: "https://example.com/a",
		});

		expect(result).toEqual({ kind: "keep-canonical" });
	});

	it("promotes the fallback when the canonical summary is stuck on content-too-short and returns the existing tier", async () => {
		const resolveTie = initResolveTie({
			findContentSourceTier: jest.fn<ReturnType<FindContentSourceTier>, Parameters<FindContentSourceTier>>().mockResolvedValue("tier-0"),
			loadArticle: jest.fn().mockResolvedValue(
				articleWithSummary({ kind: "skipped", reason: "content-too-short" }),
			),
		});

		const result = await resolveTie({
			sources: [source("tier-0"), source("tier-1")],
			freshTier: "tier-1",
			url: "https://example.com/a",
		});

		expect(result).toEqual({
			kind: "promote",
			tier: "tier-1",
			reason: "tie + canonical summary skipped on too-short content; promoted tier-1 to retry",
			existingTier: "tier-0",
		});
	});

	it("promotes the fallback when no canonical exists", async () => {
		const loadArticle = jest.fn();
		const resolveTie = initResolveTie({
			findContentSourceTier: jest.fn<ReturnType<FindContentSourceTier>, Parameters<FindContentSourceTier>>().mockResolvedValue(undefined),
			loadArticle,
		});

		const result = await resolveTie({
			sources: [source("tier-0"), source("tier-1")],
			freshTier: "tier-1",
			url: "https://example.com/a",
		});

		expect(result).toEqual({
			kind: "promote",
			tier: "tier-1",
			reason: "tie with no canonical; defaulted to tier-1",
			existingTier: undefined,
		});
		expect(loadArticle).not.toHaveBeenCalled();
	});

	it("falls back to tier-0 when tier-1 is not among the candidates", async () => {
		const resolveTie = initResolveTie({
			findContentSourceTier: jest.fn<ReturnType<FindContentSourceTier>, Parameters<FindContentSourceTier>>().mockResolvedValue(undefined),
			loadArticle: jest.fn(),
		});

		const result = await resolveTie({
			sources: [source("tier-0")],
			freshTier: "tier-0",
			url: "https://example.com/a",
		});

		expect(result).toEqual({
			kind: "promote",
			tier: "tier-0",
			reason: "tie with no canonical; defaulted to tier-0",
			existingTier: undefined,
		});
	});

	it("keeps the canonical when the summary is skipped for a non-too-short reason", async () => {
		const resolveTie = initResolveTie({
			findContentSourceTier: jest.fn<ReturnType<FindContentSourceTier>, Parameters<FindContentSourceTier>>().mockResolvedValue("tier-1"),
			loadArticle: jest.fn().mockResolvedValue(
				articleWithSummary({ kind: "skipped", reason: "ai-unavailable" }),
			),
		});

		const result = await resolveTie({
			sources: [source("tier-0"), source("tier-1")],
			freshTier: "tier-1",
			url: "https://example.com/a",
		});

		expect(result).toEqual({ kind: "keep-canonical" });
	});

	it("throws when the freshly-written tier is not in the candidate set on a media-different tie", async () => {
		const resolveTie = initResolveTie({
			findContentSourceTier: jest.fn(),
			loadArticle: jest.fn(),
		});

		await expect(resolveTie({
			sources: [
				source("tier-0", '<p>body</p><img src="https://cdn/old.png">'),
				source("tier-0", '<p>body</p><img src="https://cdn/new.png">'),
			],
			freshTier: "tier-1",
			url: "https://example.com/a",
		})).rejects.toThrow("freshly-written tier tier-1 missing from candidate set");
	});
});
