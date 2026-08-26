import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type {
	FindArticleById,
	FindArticlesByUser,
	ReadArticleContent,
	UpdateArticleStatus,
} from "@packages/provider-contracts/article-store";
import type { FindGeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { FindRelatedArticles } from "@packages/provider-contracts/related-articles";
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
	findRelatedArticles?: FindRelatedArticles;
	updateArticleStatus?: UpdateArticleStatus;
}

function buildOps(overrides: DepOverrides = {}) {
	return initMcpArticleOperations({
		findArticleById: overrides.findArticleById ?? (async () => null),
		findArticlesByUser:
			overrides.findArticlesByUser ??
			(async () => ({
				articles: [],
				total: 0,
				hasMore: false,
				page: 1,
				pageSize: 20,
			})),
		readArticleContent: overrides.readArticleContent ?? (async () => undefined),
		findGeneratedSummary:
			overrides.findGeneratedSummary ?? (async () => undefined),
		findRelatedArticles:
			overrides.findRelatedArticles ?? (async () => ({ status: "pending" })),
		updateArticleStatus: overrides.updateArticleStatus ?? (async () => null),
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
			readTime: { value: "2", label: "~2 min read" },
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

	it("omits readTime while the crawl has not landed — an uncrawled stub's minutes are synthetic", () => {
		const article = buildArticle({
			metadata: {
				title: "T",
				siteName: "S",
				excerpt: "E",
				wordCount: 0,
			},
			estimatedReadTime: MinutesSchema.parse(1),
		});
		const mcpArticle = toMcpArticle(article);
		expect([
			Object.hasOwn(mcpArticle, "estimatedReadTime"),
			Object.hasOwn(mcpArticle, "readTime"),
		]).toEqual([false, false]);
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
				hasMore: false,
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
				includeTotal: true,
			});
			expect(result).toEqual({
				total: 1,
				page: 2,
				pageSize: 5,
				articles: [toMcpArticle(article)],
			});
		});

		it("throws when the store answers the includeTotal query without a total", async () => {
			const ops = buildOps({
				findArticlesByUser: async () => ({
					articles: [],
					hasMore: false,
					page: 1,
					pageSize: 20,
				}),
			});

			await expect(ops.listQueue({ userId })).rejects.toThrow(
				"includeTotal query must return a total",
			);
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

	describe("getRelatedArticles", () => {
		it("reports not_found when the id does not resolve", async () => {
			const ops = buildOps({ findArticleById: async () => null });
			expect(await ops.getRelatedArticles({ userId, id: "0".repeat(32) })).toEqual({
				status: "not_found",
			});
		});

		it("reports pending while the relations have not been worked out", async () => {
			const article = buildArticle();
			const ops = buildOps({
				findArticleById: async () => article,
				findRelatedArticles: async () => ({ status: "pending" }),
			});
			expect(
				await ops.getRelatedArticles({ userId, id: article.id.value }),
			).toEqual({ status: "pending" });
		});

		it("reports a skipped computation", async () => {
			const article = buildArticle();
			const ops = buildOps({
				findArticleById: async () => article,
				findRelatedArticles: async () => ({ status: "skipped" }),
			});
			expect(
				await ops.getRelatedArticles({ userId, id: article.id.value }),
			).toEqual({ status: "skipped" });
		});

		it("flattens each relation to the id an agent can look up again, tagged with how far the reader got", async () => {
			const article = buildArticle();
			const relatedId = ReaderArticleHashId.from("https://example.com/earlier");
			const laterId = ReaderArticleHashId.from("https://example.com/later");
			const ops = buildOps({
				findArticleById: async () => article,
				findRelatedArticles: async () => ({
					status: "ready",
					items: [
						{
							id: relatedId,
							title: "Earlier read",
							siteName: "Example",
							reason: "Same argument",
							status: "read",
							savedAt: new Date("2026-06-01T00:00:00.000Z"),
							readAt: new Date("2026-07-01T00:00:00.000Z"),
						},
						{
							id: laterId,
							title: "Still to read",
							siteName: "Example",
							reason: "Follow-up",
							status: "unread",
							savedAt: new Date("2026-05-01T00:00:00.000Z"),
						},
					],
				}),
			});
			expect(
				await ops.getRelatedArticles({ userId, id: article.id.value }),
			).toEqual({
				status: "ready",
				articles: [
					{
						id: relatedId.value,
						title: "Earlier read",
						siteName: "Example",
						reason: "Same argument",
						status: "read",
						savedAt: "2026-06-01T00:00:00.000Z",
						readAt: "2026-07-01T00:00:00.000Z",
					},
					{
						id: laterId.value,
						title: "Still to read",
						siteName: "Example",
						reason: "Follow-up",
						status: "unread",
						savedAt: "2026-05-01T00:00:00.000Z",
					},
				],
			});
		});
	});

	describe("markAsRead / markAsUnread", () => {
		it("answers with the row the write itself returned, never a second read", async () => {
			const stored = buildArticle();
			const written = {
				...stored,
				status: "read" as const,
				readAt: new Date("2026-03-03T00:00:00.000Z"),
			};
			const findArticleById = jest.fn(async () => stored);
			const updateArticleStatus = jest.fn(async () => written);
			const ops = buildOps({ findArticleById, updateArticleStatus });

			const result = await ops.markAsRead({ userId, id: stored.id.value });

			expect(updateArticleStatus).toHaveBeenCalledWith(stored.id, userId, "read");
			expect(result).toEqual({ status: "ok", article: toMcpArticle(written) });
			expect(result).toMatchObject({
				article: { status: "read", readAt: "2026-03-03T00:00:00.000Z" },
			});
			expect(findArticleById).toHaveBeenCalledTimes(1);
		});

		it("writes the unread status and answers with the cleared read date", async () => {
			const stored = buildArticle({
				status: "read",
				readAt: new Date("2026-03-03T00:00:00.000Z"),
			});
			const written = { ...stored, status: "unread" as const, readAt: undefined };
			const updateArticleStatus = jest.fn(async () => written);
			const ops = buildOps({
				findArticleById: async () => stored,
				updateArticleStatus,
			});

			const result = await ops.markAsUnread({ userId, id: stored.id.value });

			expect(updateArticleStatus).toHaveBeenCalledWith(stored.id, userId, "unread");
			expect(result).toEqual({ status: "ok", article: toMcpArticle(written) });
			expect(result).toMatchObject({ article: { status: "unread" } });
			expect(result).not.toMatchObject({ article: { readAt: expect.anything() } });
		});

		it("leaves an already-read article alone, keeping the read date the reader earned", async () => {
			const stored = buildArticle({
				status: "read",
				readAt: new Date("2026-03-03T00:00:00.000Z"),
			});
			const updateArticleStatus = jest.fn(async () => stored);
			const ops = buildOps({
				findArticleById: async () => stored,
				updateArticleStatus,
			});

			const result = await ops.markAsRead({ userId, id: stored.id.value });

			expect(updateArticleStatus).not.toHaveBeenCalled();
			expect(result).toEqual({ status: "ok", article: toMcpArticle(stored) });
			expect(result).toMatchObject({
				article: { readAt: "2026-03-03T00:00:00.000Z" },
			});
		});

		it("leaves an already-unread article alone", async () => {
			const stored = buildArticle();
			const updateArticleStatus = jest.fn(async () => stored);
			const ops = buildOps({
				findArticleById: async () => stored,
				updateArticleStatus,
			});

			const result = await ops.markAsUnread({ userId, id: stored.id.value });

			expect(updateArticleStatus).not.toHaveBeenCalled();
			expect(result).toEqual({ status: "ok", article: toMcpArticle(stored) });
		});

		it("reports not_found and writes nothing for an id the user does not own", async () => {
			const updateArticleStatus = jest.fn(async () => buildArticle());
			const ops = buildOps({
				findArticleById: async () => null,
				updateArticleStatus,
			});

			expect(
				await ops.markAsRead({ userId, id: "0".repeat(32) }),
			).toEqual({ status: "not_found" });
			expect(updateArticleStatus).not.toHaveBeenCalled();
		});

		it("reports not_found without hitting the store for a malformed id", async () => {
			const findArticleById = jest.fn(async () => null);
			const updateArticleStatus = jest.fn(async () => buildArticle());
			const ops = buildOps({ findArticleById, updateArticleStatus });

			expect(
				await ops.markAsRead({ userId, id: "not-a-hash" }),
			).toEqual({ status: "not_found" });
			expect(findArticleById).not.toHaveBeenCalled();
			expect(updateArticleStatus).not.toHaveBeenCalled();
		});

		it("reports not_found when the row is gone by the time the write runs", async () => {
			const article = buildArticle();
			const ops = buildOps({
				findArticleById: async () => article,
				updateArticleStatus: async () => null,
			});

			expect(
				await ops.markAsRead({ userId, id: article.id.value }),
			).toEqual({ status: "not_found" });
		});
	});
});
