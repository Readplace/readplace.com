import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { Minutes } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { SaveArticleParams } from "./article-store.types";
import { initInMemoryArticleStore } from "./in-memory-article-store";

const USER_A = "user-a" as UserId;
const USER_B = "user-b" as UserId;

function makeArticleParams(
	overrides?: Partial<SaveArticleParams>,
): SaveArticleParams {
	return {
		userId: USER_A,
		url: "https://example.com/article",
		metadata: {
			title: "Test Article",
			siteName: "example.com",
			excerpt: "A test article excerpt",
			wordCount: 500,
		},
		estimatedReadTime: 3 as Minutes,
		...overrides,
	};
}

describe("initInMemoryArticleStore", () => {
	describe("saveArticle + findArticleById", () => {
		it("should save and retrieve an article", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams());

			const found = await store.findArticleById(saved.id, USER_A);

			expect(found?.url).toBe("https://example.com/article");
			expect(found?.status).toBe("unread");
		});

		it("should return null when user has no relationship to the article", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams({ userId: USER_A }));

			const found = await store.findArticleById(saved.id, USER_B);

			expect(found).toBeNull();
		});
	});

	describe("findArticleByUrl", () => {
		it("should return null for unknown URL", async () => {
			const store = initInMemoryArticleStore();

			const found = await store.findArticleByUrl("https://unknown.com/page");

			expect(found).toBeNull();
		});

		it("should return article data for known URL", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());

			const found = await store.findArticleByUrl("https://example.com/article");

			expect(found?.url).toBe("https://example.com/article");
			expect(found?.metadata.title).toBe("Test Article");
		});

		it("should return the global savedAt so downstream consumers can compute time-based policies", async () => {
			const store = initInMemoryArticleStore();
			const savedAt = new Date("2026-04-01T12:00:00.000Z");
			await store.saveArticleGlobally({
				url: "https://example.com/article",
				metadata: { title: "T", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: 0 as Minutes,
				savedAt,
			});

			const found = await store.findArticleByUrl("https://example.com/article");

			expect(found?.savedAt).toEqual(savedAt);
		});
	});

	describe("saveArticleGlobally savedAt semantics", () => {
		it("reports created=true on the first insert and created=false on subsequent calls", async () => {
			const store = initInMemoryArticleStore();
			const url = "https://example.com/article";
			const baseMetadata = { title: "T", siteName: "example.com", excerpt: "", wordCount: 0 };

			const first = await store.saveArticleGlobally({
				url,
				metadata: baseMetadata,
				estimatedReadTime: 0 as Minutes,
				savedAt: new Date("2026-04-01T12:00:00.000Z"),
			});
			const second = await store.saveArticleGlobally({
				url,
				metadata: baseMetadata,
				estimatedReadTime: 0 as Minutes,
				savedAt: new Date("2026-04-02T12:00:00.000Z"),
			});

			expect(first).toEqual({ created: true });
			expect(second).toEqual({ created: false });
		});

		it("does not clobber real parsed metadata when a stub re-save lands on an existing row", async () => {
			// Simulates the /view fallback path landing on a row that already
			// holds parsed metadata: title/excerpt/wordCount must stay intact;
			// only savedAt is allowed to advance (via bumpArticleSavedAt).
			const store = initInMemoryArticleStore();
			const url = "https://example.com/article";
			const realMetadata = {
				title: "Real Parsed Title",
				siteName: "example.com",
				excerpt: "Real parsed excerpt.",
				wordCount: 500,
			};
			const firstSavedAt = new Date("2026-04-01T12:00:00.000Z");
			const stubSavedAt = new Date("2026-04-02T12:00:00.000Z");

			await store.saveArticleGlobally({
				url,
				metadata: realMetadata,
				estimatedReadTime: 3 as Minutes,
				savedAt: firstSavedAt,
			});

			const stubResult = await store.saveArticleGlobally({
				url,
				metadata: { title: "example.com", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: 0 as Minutes,
				savedAt: stubSavedAt,
			});
			expect(stubResult.created).toBe(false);

			await store.bumpArticleSavedAt({ url, savedAt: stubSavedAt });

			const found = await store.findArticleByUrl(url);
			expect(found?.metadata).toEqual(realMetadata);
			expect(found?.estimatedReadTime).toBe(3);
			expect(found?.savedAt).toEqual(stubSavedAt);
		});

		it("bumps the global savedAt when the same user re-saves the article", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());
			const firstFound = await store.findArticleByUrl(
				"https://example.com/article",
			);
			assert(firstFound, "article must exist after first save");
			await new Promise((resolve) => setTimeout(resolve, 10));

			await store.saveArticle(makeArticleParams());
			const secondFound = await store.findArticleByUrl(
				"https://example.com/article",
			);
			assert(secondFound, "article must still exist after re-save");

			expect(secondFound.savedAt.getTime()).toBeGreaterThan(
				firstFound.savedAt.getTime(),
			);
		});

		it("ignores a bumpArticleSavedAt call for a URL that has never been saved", async () => {
			const store = initInMemoryArticleStore();

			await store.bumpArticleSavedAt({
				url: "https://example.com/missing",
				savedAt: new Date("2026-04-02T12:00:00.000Z"),
			});

			const found = await store.findArticleByUrl("https://example.com/missing");
			expect(found).toBeNull();
		});
	});

	describe("findArticleUrlById", () => {
		it("should return null for an unknown hash", async () => {
			const store = initInMemoryArticleStore();
			const unknown = ReaderArticleHashId.from("https://nobody-saved.com/this");

			const url = await store.findArticleUrlById(unknown);

			expect(url).toBeNull();
		});

		it("should return the original URL even when no user owns the article", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticleGlobally({
				url: "https://example.com/global-only",
				metadata: {
					title: "Global Only",
					siteName: "example.com",
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: 0 as Minutes,
				savedAt: new Date(),
			});
			const id = ReaderArticleHashId.from("https://example.com/global-only");

			const url = await store.findArticleUrlById(id);

			expect(url).toBe("https://example.com/global-only");
		});
	});

	describe("article deduplication", () => {
		it("should reuse the same global article when two users save the same URL", async () => {
			const store = initInMemoryArticleStore();
			const savedA = await store.saveArticle(makeArticleParams({ userId: USER_A }));
			const savedB = await store.saveArticle(makeArticleParams({ userId: USER_B }));

			expect(savedA.id.value).toBe(savedB.id.value);
		});

		it("should produce the same routeId regardless of scheme or fragment", async () => {
			const store = initInMemoryArticleStore();
			const https = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/article" }),
			);
			const http = await store.saveArticle(
				makeArticleParams({ userId: USER_B, url: "http://example.com/article" }),
			);
			const withFragment = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/article#heading" }),
			);

			expect(https.id.value).toBe(http.id.value);
			expect(https.id.value).toBe(withFragment.id.value);
		});

		it("should create separate user-article relationships for each user", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ userId: USER_A }));
			await store.saveArticle(makeArticleParams({ userId: USER_B }));

			const resultA = await store.findArticlesByUser({ userId: USER_A });
			const resultB = await store.findArticlesByUser({ userId: USER_B });

			expect(resultA.articles.length).toBe(1);
			expect(resultB.articles.length).toBe(1);
		});

		it("should not create a duplicate user-article when the same user saves the same URL twice", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ userId: USER_A }));
			await store.saveArticle(makeArticleParams({ userId: USER_A }));

			const result = await store.findArticlesByUser({ userId: USER_A });

			expect(result.articles.length).toBe(1);
			expect(result.total).toBe(1);
		});

		it("should bump savedAt to top on re-save so the article moves to the head of the queue", async () => {
			const store = initInMemoryArticleStore();
			const first = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			await store.saveArticle(
				makeArticleParams({ url: "https://example.com/second" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);

			const result = await store.findArticlesByUser({ userId: USER_A });

			expect(result.articles[0].id.value).toBe(first.id.value);
		});

		it("should preserve status and readAt on re-save", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams());
			await store.updateArticleStatus(saved.id, USER_A, "read");

			await store.saveArticle(makeArticleParams());
			const found = await store.findArticleById(saved.id, USER_A);

			expect(found?.status).toBe("read");
			expect(found?.readAt).toBeInstanceOf(Date);
		});
	});

	describe("findArticlesByUser", () => {
		it("should return only articles belonging to the user", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ userId: USER_A }));
			await store.saveArticle(
				makeArticleParams({ userId: USER_B, url: "https://other.com/page" }),
			);

			const result = await store.findArticlesByUser({ userId: USER_A });

			expect(result.articles.length).toBe(1);
			expect(result.total).toBe(1);
		});

		it("should filter by status", async () => {
			const store = initInMemoryArticleStore();
			const a1 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/1" }),
			);
			await store.saveArticle(
				makeArticleParams({ url: "https://example.com/2" }),
			);
			await store.updateArticleStatus(a1.id, USER_A, "read");

			const result = await store.findArticlesByUser({
				userId: USER_A,
				status: "read",
			});

			expect(result.articles.length).toBe(1);
			expect(result.articles[0].id.value).toBe(a1.id.value);
		});

		it("should sort by savedAt descending by default", async () => {
			const store = initInMemoryArticleStore();
			const a1 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const a2 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/second" }),
			);

			const result = await store.findArticlesByUser({ userId: USER_A });

			expect(result.articles[0].id.value).toBe(a2.id.value);
			expect(result.articles[1].id.value).toBe(a1.id.value);
		});

		it("should sort ascending when specified", async () => {
			const store = initInMemoryArticleStore();
			const a1 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const a2 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/second" }),
			);

			const result = await store.findArticlesByUser({
				userId: USER_A,
				order: "asc",
			});

			expect(result.articles[0].id.value).toBe(a1.id.value);
			expect(result.articles[1].id.value).toBe(a2.id.value);
		});

		it("should sort by readAt descending when sort=readAt", async () => {
			const store = initInMemoryArticleStore();
			const a1 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const a2 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/second" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const a3 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/third" }),
			);

			await store.updateArticleStatus(a2.id, USER_A, "read");
			await new Promise((resolve) => setTimeout(resolve, 10));
			await store.updateArticleStatus(a1.id, USER_A, "read");
			await new Promise((resolve) => setTimeout(resolve, 10));
			await store.updateArticleStatus(a3.id, USER_A, "read");

			const result = await store.findArticlesByUser({
				userId: USER_A,
				status: "read",
				sort: "readAt",
			});

			expect(result.articles.map((a) => a.id.value)).toEqual([
				a3.id.value,
				a1.id.value,
				a2.id.value,
			]);
		});

		it("should sort by readAt ascending when sort=readAt and order=asc", async () => {
			const store = initInMemoryArticleStore();
			const a1 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			const a2 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/second" }),
			);
			const a3 = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/third" }),
			);

			await store.updateArticleStatus(a2.id, USER_A, "read");
			await new Promise((resolve) => setTimeout(resolve, 10));
			await store.updateArticleStatus(a1.id, USER_A, "read");
			await new Promise((resolve) => setTimeout(resolve, 10));
			await store.updateArticleStatus(a3.id, USER_A, "read");

			const result = await store.findArticlesByUser({
				userId: USER_A,
				status: "read",
				sort: "readAt",
				order: "asc",
			});

			expect(result.articles.map((a) => a.id.value)).toEqual([
				a2.id.value,
				a1.id.value,
				a3.id.value,
			]);
		});

		it("should paginate results", async () => {
			const store = initInMemoryArticleStore();
			for (let i = 0; i < 5; i++) {
				await store.saveArticle(
					makeArticleParams({ url: `https://example.com/${i}` }),
				);
			}

			const page1 = await store.findArticlesByUser({
				userId: USER_A,
				page: 1,
				pageSize: 2,
			});
			const page2 = await store.findArticlesByUser({
				userId: USER_A,
				page: 2,
				pageSize: 2,
			});

			expect(page1.articles.length).toBe(2);
			expect(page2.articles.length).toBe(2);
			expect(page1.total).toBe(5);
		});
	});

	describe("deleteArticle", () => {
		it("should remove user's relationship to the article", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams());

			const deleted = await store.deleteArticle(saved.id, USER_A);

			expect(deleted).toBe(true);
			expect(await store.findArticleById(saved.id, USER_A)).toBeNull();
		});

		it("should not affect another user's relationship to the same article", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams({ userId: USER_A }));
			await store.saveArticle(makeArticleParams({ userId: USER_B }));

			await store.deleteArticle(saved.id, USER_A);

			const foundByB = await store.findArticleById(saved.id, USER_B);
			expect(foundByB?.url).toBe("https://example.com/article");
		});

		it("should not delete another user's article", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams({ userId: USER_A }));

			const deleted = await store.deleteArticle(saved.id, USER_B);

			expect(deleted).toBe(false);
		});

		it("should return false when deleting a non-existent article", async () => {
			const store = initInMemoryArticleStore();
			const fakeId = ReaderArticleHashId.fromHash("0".repeat(32));

			const deleted = await store.deleteArticle(fakeId, USER_A);

			expect(deleted).toBe(false);
		});
	});

	describe("freshness operations", () => {
		it("findArticleFreshness returns null for unknown URL", async () => {
			const store = initInMemoryArticleStore();

			const result = await store.findArticleFreshness("https://unknown.com/page");

			expect(result).toBeNull();
		});

	});

	describe("updateArticleStatus", () => {
		it("should update status and set readAt for read", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams());

			await store.updateArticleStatus(saved.id, USER_A, "read");
			const found = await store.findArticleById(saved.id, USER_A);

			expect(found?.status).toBe("read");
			expect(found?.readAt).toBeInstanceOf(Date);
		});

		it("should clear readAt when marking unread", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams());
			await store.updateArticleStatus(saved.id, USER_A, "read");
			await store.updateArticleStatus(saved.id, USER_A, "unread");

			const found = await store.findArticleById(saved.id, USER_A);

			expect(found?.status).toBe("unread");
			expect(found?.readAt).toBeUndefined();
		});

		it("should not update another user's article", async () => {
			const store = initInMemoryArticleStore();
			const saved = await store.saveArticle(makeArticleParams({ userId: USER_A }));

			const updated = await store.updateArticleStatus(saved.id, USER_B, "read");

			expect(updated).toBe(false);
			const found = await store.findArticleById(saved.id, USER_A);
			expect(found?.status).toBe("unread");
		});

		it("should return false when updating status of a non-existent article", async () => {
			const store = initInMemoryArticleStore();
			const fakeId = ReaderArticleHashId.fromHash("0".repeat(32));

			const updated = await store.updateArticleStatus(fakeId, USER_A, "read");

			expect(updated).toBe(false);
		});
	});

	describe("readContent", () => {
		it("should return undefined when article does not exist", async () => {
			const store = initInMemoryArticleStore();

			const content = await store.readContent(ArticleResourceUniqueId.parse("https://example.com/nonexistent"));
			expect(content).toBeUndefined();
		});

		it("should return undefined for newly saved article since content is stored in S3", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());

			const content = await store.readContent(ArticleResourceUniqueId.parse("https://example.com/article"));
			expect(content).toBeUndefined();
		});
	});
});
