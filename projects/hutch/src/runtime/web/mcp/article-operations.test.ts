import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type {
	FindArticleById,
	FindArticlesByUser,
	ReadArticleContent,
} from "@packages/provider-contracts/article-store";
import type { FindGeneratedSummary } from "@packages/provider-contracts/article-summary";
import {
	initMcpArticleOperations,
	toMcpArticle,
	toSummaryResult,
} from "./article-operations";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");

function buildArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	const url = overrides.url ?? "https://example.com/a";
	return {
		id: ReaderArticleHashId.from(url),
		userId,
		url,
		metadata: {
			title: "Title",
			siteName: "Example",
			excerpt: "An excerpt",
			wordCount: 400,
			imageUrl: "https://example.com/i.png",
		},
		content: "<p>body</p>",
		estimatedReadTime: MinutesSchema.parse(2),
		status: "unread",
		savedAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
}

interface DepOverrides {
	findArticleById?: FindArticleById;
	findArticlesByUser?: FindArticlesByUser;
	readArticleContent?: ReadArticleContent;
	findGeneratedSummary?: FindGeneratedSummary;
}

function buildOps(overrides: DepOverrides = {}) {
	return initMcpArticleOperations({
		findArticleById: overrides.findArticleById ?? (async () => null),
		findArticlesByUser:
			overrides.findArticlesByUser ??
			(async () => ({ articles: [], total: 0, page: 1, pageSize: 20 })),
		readArticleContent: overrides.readArticleContent ?? (async () => undefined),
		findGeneratedSummary:
			overrides.findGeneratedSummary ?? (async () => undefined),
	});
}

describe("toMcpArticle", () => {
	it("maps every field, including optional imageUrl and readAt when present", () => {
		const article = buildArticle({
			status: "read",
			readAt: new Date("2026-02-02T00:00:00.000Z"),
		});
		expect(toMcpArticle(article)).toEqual({
			id: article.id.value,
			url: "https://example.com/a",
			title: "Title",
			siteName: "Example",
			excerpt: "An excerpt",
			wordCount: 400,
			imageUrl: "https://example.com/i.png",
			estimatedReadTime: 2,
			status: "read",
			savedAt: "2026-01-01T00:00:00.000Z",
			readAt: "2026-02-02T00:00:00.000Z",
		});
	});

	it("returns the redirect destination as the url for a merged article", () => {
		const article = buildArticle({
			url: "https://example.com/a.html",
			displayUrl: "https://example.com/a",
		});
		expect(toMcpArticle(article).url).toBe("https://example.com/a");
	});

	it("omits imageUrl and readAt when they are absent", () => {
		const article = buildArticle({
			metadata: {
				title: "T",
				siteName: "S",
				excerpt: "E",
				wordCount: 1,
			},
		});
		const mapped = toMcpArticle(article);
		expect(mapped).not.toHaveProperty("imageUrl");
		expect(mapped).not.toHaveProperty("readAt");
	});
});

describe("toSummaryResult", () => {
	it("treats a missing summary row as pending, mirroring the reader UI", () => {
		expect(toSummaryResult(undefined)).toEqual({ status: "pending" });
	});

	it("passes a pending summary through", () => {
		expect(toSummaryResult({ status: "pending" })).toEqual({ status: "pending" });
	});

	it("returns the summary and excerpt when ready", () => {
		expect(
			toSummaryResult({ status: "ready", summary: "TL;DR", excerpt: "ex" }),
		).toEqual({ status: "ready", summary: "TL;DR", excerpt: "ex" });
	});

	it("omits the excerpt when a ready summary has none", () => {
		expect(toSummaryResult({ status: "ready", summary: "TL;DR" })).toEqual({
			status: "ready",
			summary: "TL;DR",
		});
	});

	it("carries the reason for a failed summary", () => {
		expect(toSummaryResult({ status: "failed", reason: "too long" })).toEqual({
			status: "failed",
			reason: "too long",
		});
	});

	it("carries the reason for a skipped summary, and omits it when absent", () => {
		expect(toSummaryResult({ status: "skipped", reason: "too short" })).toEqual({
			status: "skipped",
			reason: "too short",
		});
		expect(toSummaryResult({ status: "skipped" })).toEqual({ status: "skipped" });
	});
});

describe("initMcpArticleOperations", () => {
	describe("listQueue", () => {
		it("forwards the query (excluding content) and maps rows to MCP articles", async () => {
			const article = buildArticle();
			const findArticlesByUser = jest.fn(async () => ({
				articles: [article],
				total: 1,
				page: 2,
				pageSize: 5,
			}));
			const ops = buildOps({ findArticlesByUser });

			const result = await ops.listQueue({
				userId,
				status: "read",
				sort: "readAt",
				order: "asc",
				page: 2,
				pageSize: 5,
			});

			expect(findArticlesByUser).toHaveBeenCalledWith({
				userId,
				status: "read",
				sort: "readAt",
				order: "asc",
				page: 2,
				pageSize: 5,
				excludeContent: true,
			});
			expect(result).toEqual({
				total: 1,
				page: 2,
				pageSize: 5,
				articles: [toMcpArticle(article)],
			});
		});
	});

	describe("getArticle", () => {
		it("returns the mapped article when the owner's id resolves", async () => {
			const article = buildArticle();
			const ops = buildOps({ findArticleById: async () => article });
			expect(await ops.getArticle({ userId, id: article.id.value })).toEqual(
				toMcpArticle(article),
			);
		});

		it("returns null when the id does not resolve to an owned article", async () => {
			const ops = buildOps({ findArticleById: async () => null });
			expect(
				await ops.getArticle({ userId, id: "0".repeat(32) }),
			).toBeNull();
		});

		it("returns null without hitting the store for a malformed id", async () => {
			const findArticleById = jest.fn(async () => null);
			const ops = buildOps({ findArticleById });
			expect(await ops.getArticle({ userId, id: "not-a-hash" })).toBeNull();
			expect(findArticleById).not.toHaveBeenCalled();
		});
	});

	describe("getArticleContent", () => {
		it("reports not_found when the id does not resolve", async () => {
			const ops = buildOps({ findArticleById: async () => null });
			expect(await ops.getArticleContent({ userId, id: "0".repeat(32) })).toEqual({
				status: "not_found",
			});
		});

		it("reports pending while the reader view is still being fetched", async () => {
			const article = buildArticle();
			const ops = buildOps({
				findArticleById: async () => article,
				readArticleContent: async () => undefined,
			});
			expect(
				await ops.getArticleContent({ userId, id: article.id.value }),
			).toEqual({ status: "pending" });
		});

		it("returns the cleaned HTML when ready", async () => {
			const article = buildArticle();
			const ops = buildOps({
				findArticleById: async () => article,
				readArticleContent: async () => "<article>hi</article>",
			});
			expect(
				await ops.getArticleContent({ userId, id: article.id.value }),
			).toEqual({ status: "ready", content: "<article>hi</article>" });
		});
	});

	describe("getArticleSummary", () => {
		it("reports not_found when the id does not resolve", async () => {
			const ops = buildOps({ findArticleById: async () => null });
			expect(await ops.getArticleSummary({ userId, id: "0".repeat(32) })).toEqual({
				status: "not_found",
			});
		});

		it("maps the stored summary for an owned article", async () => {
			const article = buildArticle();
			const ops = buildOps({
				findArticleById: async () => article,
				findGeneratedSummary: async () => ({ status: "ready", summary: "TL;DR" }),
			});
			expect(
				await ops.getArticleSummary({ userId, id: article.id.value }),
			).toEqual({ status: "ready", summary: "TL;DR" });
		});
	});
});
