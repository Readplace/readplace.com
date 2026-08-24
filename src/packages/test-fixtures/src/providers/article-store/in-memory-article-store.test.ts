import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { Minutes } from "@packages/domain/article";
import {
	QUEUE_MAX_PER_USER,
	QueueLimitReachedError,
	QueueSlugSchema,
} from "@packages/domain/queue";
import type { UserId } from "@packages/domain/user";
import type { SaveArticleParams } from "./article-store.types";
import { initInMemoryArticleStore } from "./in-memory-article-store";

const USER_A = "user-a" as UserId;
const USER_B = "user-b" as UserId;
const WORK = QueueSlugSchema.parse("work");
const LATER = QueueSlugSchema.parse("later");

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
		provenance: { kind: "web" },
		savedAt: new Date(),
		...overrides,
	};
}

describe("initInMemoryArticleStore", () => {
	describe("saveArticle + findArticleById", () => {
		it("should save and retrieve an article", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());

			const found = await store.findArticleById(saved.id, USER_A);

			expect(found?.url).toBe("https://example.com/article");
			expect(found?.status).toBe("unread");
		});

		it("should return null when user has no relationship to the article", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams({ userId: USER_A }));

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

		it("revives a tombstoned row on re-save: reports created=true and clears purgedAt so the tombstone gate reopens", async () => {
			const store = initInMemoryArticleStore();
			const url = "https://example.com/article";
			const metadata = { title: "T", siteName: "example.com", excerpt: "", wordCount: 0 };
			await store.saveArticleGlobally({ url, metadata, estimatedReadTime: 0 as Minutes, savedAt: new Date("2026-04-01T12:00:00.000Z") });
			await store.setPurgedAt({ url, at: new Date("2026-07-16T10:00:00.000Z") });

			const revived = await store.saveArticleGlobally({
				url,
				metadata,
				estimatedReadTime: 0 as Minutes,
				savedAt: new Date("2026-07-20T12:00:00.000Z"),
			});

			expect(revived).toEqual({ created: true });
			expect((await store.findArticleByUrl(url))?.purgedAt).toBeUndefined();
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

		it("moves the user row to the newer savedAt when a later save lands", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ savedAt: new Date("2026-08-01T10:00:00.000Z") }));

			const { saved } = await store.saveArticle(makeArticleParams({ savedAt: new Date("2026-08-01T10:00:01.000Z") }));

			expect(saved.savedAt).toEqual(new Date("2026-08-01T10:00:01.000Z"));
		});

		it("keeps the user row's newer savedAt when a slower, older-stamped save lands after it", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ savedAt: new Date("2026-08-01T10:00:01.000Z") }));

			const { saved, createdUserArticle, wroteUserArticle } = await store.saveArticle(
				makeArticleParams({ savedAt: new Date("2026-08-01T10:00:00.000Z") }),
			);

			expect(saved.savedAt).toEqual(new Date("2026-08-01T10:00:01.000Z"));
			expect(createdUserArticle).toBe(false);
			expect(wroteUserArticle).toBe(false);
		});

		it("rejects a same-instant re-save exactly as the store's strict savedAt < :savedAt condition does", async () => {
			const store = initInMemoryArticleStore();
			const instant = new Date("2026-08-01T10:00:00.000Z");
			await store.saveArticle(makeArticleParams({ savedAt: instant, provenance: { kind: "web" } }));

			const { saved, wroteUserArticle } = await store.saveArticle(
				makeArticleParams({ savedAt: instant, provenance: { kind: "import" } }),
			);

			expect(wroteUserArticle).toBe(false);
			expect(saved.savedAt).toEqual(instant);
			expect(saved.provenance).toEqual({ kind: "web" });
		});

		it("saveArticleKeepingPosition leaves an existing row's savedAt, status, and provenance untouched", async () => {
			const store = initInMemoryArticleStore();
			const urlSaveInstant = new Date("2026-08-01T10:00:00.000Z");
			const { saved: first } = await store.saveArticle(makeArticleParams({ savedAt: urlSaveInstant }));
			await store.updateArticleStatus(first.id, USER_A, "read");

			const { saved, createdUserArticle, wroteUserArticle } = await store.saveArticleKeepingPosition(
				makeArticleParams({ savedAt: new Date("2026-08-01T11:00:00.000Z"), provenance: { kind: "import" } }),
			);

			expect(createdUserArticle).toBe(false);
			expect(wroteUserArticle).toBe(false);
			expect(saved.savedAt).toEqual(urlSaveInstant);
			expect(saved.status).toBe("read");
			expect(saved.provenance).toEqual({ kind: "web" });
		});

		it("saveArticleKeepingPosition creates the row when the link was never saved, exactly like a first save", async () => {
			const store = initInMemoryArticleStore();
			const instant = new Date("2026-08-01T10:00:00.000Z");

			const { saved, createdUserArticle, wroteUserArticle } = await store.saveArticleKeepingPosition(
				makeArticleParams({ savedAt: instant }),
			);

			expect(createdUserArticle).toBe(true);
			expect(wroteUserArticle).toBe(true);
			expect(saved.savedAt).toEqual(instant);
			expect(saved.status).toBe("unread");
		});

		it("allocateSavedAt hands out strictly increasing instants per user, even within one millisecond", async () => {
			const store = initInMemoryArticleStore();

			const first = await store.allocateSavedAt({ userId: USER_A });
			const second = await store.allocateSavedAt({ userId: USER_A });
			const third = await store.allocateSavedAt({ userId: USER_A });

			expect(second.getTime()).toBeGreaterThan(first.getTime());
			expect(third.getTime()).toBeGreaterThan(second.getTime());
		});

		it("allocateSavedAt returns to tracking wall clock once it moves past the cursor", async () => {
			const store = initInMemoryArticleStore();
			const first = await store.allocateSavedAt({ userId: USER_A });
			await new Promise((resolve) => setTimeout(resolve, 10));

			const second = await store.allocateSavedAt({ userId: USER_A });

			expect(second.getTime()).toBeGreaterThan(first.getTime() + 1);
		});

		it("allocateSavedAt restarts from wall clock after account deletion clears the cursor", async () => {
			const store = initInMemoryArticleStore();
			let cursorPushedAheadOfClock = new Date(0);
			for (let i = 0; i < 50; i += 1) {
				cursorPushedAheadOfClock = await store.allocateSavedAt({ userId: USER_A });
			}

			await store.deleteAllUserArticles(USER_A);
			const after = await store.allocateSavedAt({ userId: USER_A });

			expect(after.getTime()).toBeLessThan(cursorPushedAheadOfClock.getTime());
		});

		it("allocateSavedAtSequence hands out ascending contiguous instants, each strictly newer than every prior allocation", async () => {
			const store = initInMemoryArticleStore();
			const before = await store.allocateSavedAt({ userId: USER_A });

			const sequence = await store.allocateSavedAtSequence({ userId: USER_A, count: 3 });

			expect(sequence).toHaveLength(3);
			expect(sequence[0].getTime()).toBeGreaterThan(before.getTime());
			expect(sequence[1].getTime()).toBe(sequence[0].getTime() + 1);
			expect(sequence[2].getTime()).toBe(sequence[1].getTime() + 1);
		});

		it("allocateSavedAtSequence advances the cursor past its own span, so the next single save lands strictly after the batch", async () => {
			const store = initInMemoryArticleStore();

			const sequence = await store.allocateSavedAtSequence({ userId: USER_A, count: 4 });
			const next = await store.allocateSavedAt({ userId: USER_A });

			expect(next.getTime()).toBeGreaterThan(sequence[3].getTime());
		});

		it("findSavedUrls answers with the subset the user already has, so a batch can tell a re-save from a first save", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(
				makeArticleParams({ url: "https://example.com/already-saved" }),
			);

			const saved = await store.findSavedUrls({
				userId: USER_A,
				urls: ["https://example.com/already-saved", "https://example.com/never-saved"],
			});

			expect(saved).toEqual(["https://example.com/already-saved"]);
		});

		it("findSavedUrls scopes the answer to the asking user, so another reader's save never counts as this one's", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(
				makeArticleParams({ userId: USER_B, url: "https://example.com/other-users-save" }),
			);

			const saved = await store.findSavedUrls({
				userId: USER_A,
				urls: ["https://example.com/other-users-save"],
			});

			expect(saved).toEqual([]);
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
			const { saved: savedA } = await store.saveArticle(makeArticleParams({ userId: USER_A }));
			const { saved: savedB } = await store.saveArticle(makeArticleParams({ userId: USER_B }));

			expect(savedA.id.value).toBe(savedB.id.value);
		});

		it("should produce the same routeId regardless of scheme or fragment", async () => {
			const store = initInMemoryArticleStore();
			const { saved: https } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/article" }),
			);
			const { saved: http } = await store.saveArticle(
				makeArticleParams({ userId: USER_B, url: "http://example.com/article" }),
			);
			const { saved: withFragment } = await store.saveArticle(
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
			const first = await store.saveArticle(makeArticleParams({ userId: USER_A }));
			const second = await store.saveArticle(makeArticleParams({ userId: USER_A }));

			const result = await store.findArticlesByUser({
				userId: USER_A,
				includeTotal: true,
			});

			expect(result.articles.length).toBe(1);
			expect(result.total).toBe(1);
			expect(first.createdUserArticle).toBe(true);
			expect(second.createdUserArticle).toBe(false);
		});

		it("should report a queue entry as created for each user saving an already-known URL", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ userId: USER_A }));
			const other = await store.saveArticle(makeArticleParams({ userId: USER_B }));

			expect(other.createdUserArticle).toBe(true);
		});

		it("should bump savedAt to top on re-save so the article moves to the head of the queue", async () => {
			const store = initInMemoryArticleStore();
			const { saved: first } = await store.saveArticle(
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
			const { saved } = await store.saveArticle(makeArticleParams());
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

			const result = await store.findArticlesByUser({
				userId: USER_A,
				includeTotal: true,
			});

			expect(result.articles.length).toBe(1);
			expect(result.total).toBe(1);
		});

		it("should filter by status", async () => {
			const store = initInMemoryArticleStore();
			const { saved: a1 } = await store.saveArticle(
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
			const { saved: a1 } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const { saved: a2 } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/second" }),
			);

			const result = await store.findArticlesByUser({ userId: USER_A });

			expect(result.articles[0].id.value).toBe(a2.id.value);
			expect(result.articles[1].id.value).toBe(a1.id.value);
		});

		it("should sort ascending when specified", async () => {
			const store = initInMemoryArticleStore();
			const { saved: a1 } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const { saved: a2 } = await store.saveArticle(
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
			const { saved: a1 } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const { saved: a2 } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/second" }),
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const { saved: a3 } = await store.saveArticle(
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
			const { saved: a1 } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/first" }),
			);
			const { saved: a2 } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/second" }),
			);
			const { saved: a3 } = await store.saveArticle(
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
				includeTotal: true,
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

		it("should omit total unless the query asks for it", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(
				makeArticleParams({ url: "https://example.com/1" }),
			);
			await store.saveArticle(
				makeArticleParams({ url: "https://example.com/2" }),
			);

			const withoutTotal = await store.findArticlesByUser({ userId: USER_A });
			const withTotal = await store.findArticlesByUser({
				userId: USER_A,
				includeTotal: true,
			});

			expect(withoutTotal.total).toBeUndefined();
			expect(withTotal.total).toBe(2);
		});

		it("should report the whole matching set as the total, uncapped", async () => {
			const store = initInMemoryArticleStore();
			for (let i = 0; i < 5; i++) {
				await store.saveArticle(
					makeArticleParams({ url: `https://example.com/${i}` }),
				);
			}

			const result = await store.findArticlesByUser({
				userId: USER_A,
				pageSize: 2,
				includeTotal: true,
			});

			expect(result.total).toBe(5);
			expect(result.articles.length).toBe(2);
		});

		it("should report hasMore until the last page", async () => {
			const store = initInMemoryArticleStore();
			for (let i = 0; i < 3; i++) {
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

			expect(page1.hasMore).toBe(true);
			expect(page2.hasMore).toBe(false);
		});
	});

	describe("countArticlesByUser", () => {
		it("counts all of a user's articles when no status filter is given", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ url: "https://example.com/1" }));
			await store.saveArticle(makeArticleParams({ url: "https://example.com/2" }));

			expect(await store.countArticlesByUser({ userId: USER_A })).toBe(2);
		});

		it("counts only articles matching the status filter", async () => {
			const store = initInMemoryArticleStore();
			const { saved: a1 } = await store.saveArticle(
				makeArticleParams({ url: "https://example.com/1" }),
			);
			await store.saveArticle(makeArticleParams({ url: "https://example.com/2" }));
			await store.updateArticleStatus(a1.id, USER_A, "read");

			expect(await store.countArticlesByUser({ userId: USER_A, status: "unread" })).toBe(1);
			expect(await store.countArticlesByUser({ userId: USER_A, status: "read" })).toBe(1);
		});

		it("counts only the requesting user's articles", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ userId: USER_A }));
			await store.saveArticle(
				makeArticleParams({ userId: USER_B, url: "https://other.com/page" }),
			);

			expect(await store.countArticlesByUser({ userId: USER_A })).toBe(1);
		});

		it("stops counting at countLimit", async () => {
			const store = initInMemoryArticleStore();
			for (let i = 0; i < 5; i++) {
				await store.saveArticle(
					makeArticleParams({ url: `https://example.com/${i}` }),
				);
			}

			expect(await store.countArticlesByUser({ userId: USER_A, countLimit: 3 })).toBe(3);
		});

		it("reports the exact count when it sits under countLimit", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ url: "https://example.com/1" }));
			await store.saveArticle(makeArticleParams({ url: "https://example.com/2" }));

			expect(await store.countArticlesByUser({ userId: USER_A, countLimit: 5 })).toBe(2);
		});
	});

	describe("deleteArticle", () => {
		it("should remove user's relationship to the article", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());

			const deleted = await store.deleteArticle(saved.id, USER_A);

			expect(deleted).toBe(true);
			expect(await store.findArticleById(saved.id, USER_A)).toBeNull();
		});

		it("should not affect another user's relationship to the same article", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams({ userId: USER_A }));
			await store.saveArticle(makeArticleParams({ userId: USER_B }));

			await store.deleteArticle(saved.id, USER_A);

			const foundByB = await store.findArticleById(saved.id, USER_B);
			expect(foundByB?.url).toBe("https://example.com/article");
		});

		it("should not delete another user's article", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams({ userId: USER_A }));

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

	describe("deleteAllUserArticles", () => {
		it("removes every row for the user while leaving the global article and other users' rows intact", async () => {
			const store = initInMemoryArticleStore();
			const { saved: a1 } = await store.saveArticle(makeArticleParams({ userId: USER_A, url: "https://example.com/1" }));
			await store.saveArticle(makeArticleParams({ userId: USER_A, url: "https://example.com/2" }));
			const { saved: shared } = await store.saveArticle(makeArticleParams({ userId: USER_A }));
			await store.saveArticle(makeArticleParams({ userId: USER_B }));

			await store.deleteAllUserArticles(USER_A);

			expect(await store.countArticlesByUser({ userId: USER_A })).toBe(0);
			expect(await store.findArticleById(a1.id, USER_A)).toBeNull();
			// Another user's relationship to the shared article survives.
			expect((await store.findArticleById(shared.id, USER_B))?.url).toBe("https://example.com/article");
			// The global article cache is untouched (still resolvable by URL).
			expect((await store.findArticleByUrl("https://example.com/1"))?.url).toBe("https://example.com/1");
		});

		it("is a no-op when the user has no saved articles", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ userId: USER_B }));

			await store.deleteAllUserArticles(USER_A);

			expect(await store.countArticlesByUser({ userId: USER_B })).toBe(1);
		});
	});

	describe("listUserArticleUrls", () => {
		it("returns the user's original URLs and excludes other users' saves", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ userId: USER_A, url: "https://example.com/one" }));
			await store.saveArticle(makeArticleParams({ userId: USER_A, url: "https://example.com/two" }));
			await store.saveArticle(makeArticleParams({ userId: USER_B, url: "https://example.com/three" }));

			const urls = await store.listUserArticleUrls(USER_A);

			expect(urls.sort()).toEqual(["https://example.com/one", "https://example.com/two"]);
		});

		it("returns an empty list for a user with no saves", async () => {
			const store = initInMemoryArticleStore();

			expect(await store.listUserArticleUrls(USER_A)).toEqual([]);
		});
	});

	describe("freshness operations", () => {
		it("findArticleFreshness returns null for unknown URL", async () => {
			const store = initInMemoryArticleStore();

			const result = await store.findArticleFreshness("https://unknown.com/page");

			expect(result).toBeNull();
		});

	});

	describe("crawl versions", () => {
		it("findArticleCrawlVersions returns an empty list before any versions are recorded", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());

			const versions = await store.findArticleCrawlVersions("https://example.com/article");

			expect(versions).toEqual([]);
		});

		it("setCrawlVersions seeds the newest-first log surfaced by findArticleCrawlVersions", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());

			await store.setCrawlVersions({
				url: "https://example.com/article",
				versions: [
					{ crawledAtMinute: "2026-07-10T09:41Z", authorUserId: USER_A },
					{ crawledAtMinute: "2026-06-28T22:01Z" },
				],
			});
			const versions = await store.findArticleCrawlVersions("https://example.com/article");

			expect(versions).toEqual([
				{ crawledAtMinute: "2026-07-10T09:41Z", authorUserId: USER_A },
				{ crawledAtMinute: "2026-06-28T22:01Z" },
			]);
		});
	});

	describe("updateArticleStatus", () => {
		it("should update status and set readAt for read, answering with the written row", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());

			const updated = await store.updateArticleStatus(saved.id, USER_A, "read");
			const found = await store.findArticleById(saved.id, USER_A);

			expect(found?.status).toBe("read");
			expect(found?.readAt).toBeInstanceOf(Date);
			expect(updated).toEqual(found);
		});

		it("should clear readAt when marking unread", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());
			await store.updateArticleStatus(saved.id, USER_A, "read");
			const updated = await store.updateArticleStatus(saved.id, USER_A, "unread");

			const found = await store.findArticleById(saved.id, USER_A);

			expect(found?.status).toBe("unread");
			expect(found?.readAt).toBeUndefined();
			expect(updated).toEqual(found);
		});

		it("should not update another user's article", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams({ userId: USER_A }));

			const updated = await store.updateArticleStatus(saved.id, USER_B, "read");

			expect(updated).toBeNull();
			const found = await store.findArticleById(saved.id, USER_A);
			expect(found?.status).toBe("unread");
		});

		it("should return null when updating status of a non-existent article", async () => {
			const store = initInMemoryArticleStore();
			const fakeId = ReaderArticleHashId.fromHash("0".repeat(32));

			const updated = await store.updateArticleStatus(fakeId, USER_A, "read");

			expect(updated).toBeNull();
		});
	});

	describe("reader-ready notification columns", () => {
		const URL = "https://example.com/article";

		it("markArticleViewed stamps viewedAt on the user's row", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());
			const at = new Date("2026-05-30T10:00:00.000Z");

			await store.markArticleViewed({ userId: USER_A, url: URL, at });

			const state = await store.findUserArticleNotificationState({ userId: USER_A, url: URL });
			expect(state?.viewedAt).toEqual(at);
		});

		it("mark stamps on a missing row are no-ops so a delete race cannot resurrect the row", async () => {
			const store = initInMemoryArticleStore();

			await store.markArticleViewed({ userId: USER_A, url: URL, at: new Date("2026-05-30T10:00:00.000Z") });
			await store.markSummaryToggled({ userId: USER_A, url: URL, state: "open", at: new Date("2026-05-30T10:00:00.000Z") });
			await store.markReaderReadyEmailSent({ userId: USER_A, url: URL, at: new Date("2026-05-30T10:00:00.000Z") });

			expect(await store.findUserArticlesByUrl(URL)).toEqual([]);
			expect(await store.findUserArticleNotificationState({ userId: USER_A, url: URL })).toBeNull();
		});

		it("findUserArticlesByUrl returns every saver of the URL with their viewedAt, excluding savers of other URLs", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams({ userId: USER_A }));
			await store.saveArticle(makeArticleParams({ userId: USER_B }));
			await store.saveArticle(makeArticleParams({ userId: USER_A, url: "https://example.com/other" }));
			const viewedAt = new Date("2026-05-30T10:00:00.000Z");
			await store.markArticleViewed({ userId: USER_A, url: URL, at: viewedAt });

			const savers = await store.findUserArticlesByUrl(URL);

			expect(savers).toHaveLength(2);
			expect(savers).toContainEqual({ userId: USER_A, viewedAt });
			expect(savers).toContainEqual({ userId: USER_B, viewedAt: undefined });
		});

		it("markReaderReadyEmailSent is set-once: a later call does not overwrite the first send", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());
			const first = new Date("2026-05-30T10:05:00.000Z");
			const later = new Date("2026-05-30T11:05:00.000Z");

			await store.markReaderReadyEmailSent({ userId: USER_A, url: URL, at: first });
			await store.markReaderReadyEmailSent({ userId: USER_A, url: URL, at: later });

			const state = await store.findUserArticleNotificationState({ userId: USER_A, url: URL });
			expect(state?.emailSentAt).toEqual(first);
		});

		it("findUserArticleNotificationState returns the gate fields for an existing row", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());

			const state = await store.findUserArticleNotificationState({ userId: USER_A, url: URL });

			expect(state?.status).toBe("unread");
			expect(state?.savedAt).toBeInstanceOf(Date);
			expect(state?.viewedAt).toBeUndefined();
			expect(state?.emailSentAt).toBeUndefined();
		});

		it("findUserArticleNotificationState returns null when the user never saved the URL", async () => {
			const store = initInMemoryArticleStore();

			const state = await store.findUserArticleNotificationState({ userId: USER_A, url: URL });

			expect(state).toBeNull();
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

	describe("markSummaryToggled + getSummaryToggleState", () => {
		const URL = "https://example.com/article";

		it("stamps lastSummaryOpenedAt on state=open and lastSummaryClosedAt on state=closed (last-write-wins)", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());

			await store.markSummaryToggled({ userId: USER_A, url: URL, state: "open", at: new Date("2026-06-01T10:00:00.000Z") });
			await store.markSummaryToggled({ userId: USER_A, url: URL, state: "closed", at: new Date("2026-06-01T10:01:00.000Z") });
			// Overwrite the open stamp to prove last-write-wins (not set-once).
			await store.markSummaryToggled({ userId: USER_A, url: URL, state: "open", at: new Date("2026-06-01T10:02:00.000Z") });

			const state = await store.getSummaryToggleState({ userId: USER_A, url: URL });
			assert(state);
			assert.deepEqual(state.lastSummaryOpenedAt, new Date("2026-06-01T10:02:00.000Z"));
			assert.deepEqual(state.lastSummaryClosedAt, new Date("2026-06-01T10:01:00.000Z"));
		});

		it("getSummaryToggleState returns null when no user-article row exists", async () => {
			const store = initInMemoryArticleStore();
			expect(await store.getSummaryToggleState({ userId: USER_A, url: URL })).toBeNull();
		});
	});

	describe("multiple queues", () => {
		it("keeps the same URL as an independent copy in each queue the reader saved it into", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });

			await store.updateQueueArticleStatus({
				id: saved.id,
				userId: USER_A,
				queue: WORK,
				status: "read",
			});

			const inDefault = await store.findArticleById(saved.id, USER_A);
			const inWork = await store.findQueueArticleById({ id: saved.id, userId: USER_A, queue: WORK });
			expect(inDefault?.status).toBe("unread");
			expect(inWork?.status).toBe("read");
		});

		it("deletes only the copy in the queue the reader deleted it from", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });

			expect(
				await store.deleteQueueArticle({ id: saved.id, userId: USER_A, queue: WORK }),
			).toBe(true);
			expect(
				await store.findQueueArticleById({ id: saved.id, userId: USER_A, queue: WORK }),
			).toBeNull();
			expect(await store.findArticleById(saved.id, USER_A)).not.toBeNull();
		});

		it("answers false when the queue never held the article", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());

			expect(
				await store.deleteQueueArticle({ id: saved.id, userId: USER_A, queue: WORK }),
			).toBe(false);
			expect(
				await store.updateQueueArticleStatus({
					id: saved.id,
					userId: USER_A,
					queue: WORK,
					status: "read",
				}),
			).toBeNull();
		});

		it("keeps queue copies out of the default listing and counts", async () => {
			const store = initInMemoryArticleStore();
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });

			const listing = await store.findArticlesByUser({ userId: USER_A });
			expect(listing.articles).toEqual([]);
			expect(await store.countArticlesByUser({ userId: USER_A })).toBe(0);
			expect(await store.countQueueArticles({ userId: USER_A, queue: WORK })).toBe(1);
		});

		it("lists only the addressed queue's copies", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());
			await store.saveQueueArticle({
				...makeArticleParams({ url: "https://example.com/second" }),
				queue: WORK,
			});

			const work = await store.findQueueArticles({ userId: USER_A, queue: WORK });
			expect(work.articles.map((a) => a.url)).toEqual(["https://example.com/second"]);
		});

		it("reports every queue holding a URL so a delete can tell the last copy from one of many", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });

			expect(
				await store.listUserSavesForUrl({
					userId: USER_A,
					url: "https://example.com/article",
				}),
			).toEqual([{}, { queue: "work" }]);
		});

		it("assigns the default copy into a queue keeping its read state", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());
			await store.updateArticleStatus(saved.id, USER_A, "read");

			const result = await store.assignSavedArticleToQueue({
				userId: USER_A,
				queue: WORK,
				url: "https://example.com/article",
				savedAt: new Date("2026-08-24T10:00:00.000Z"),
			});

			expect(result).toEqual({ assigned: true });
			const copy = await store.findQueueArticleById({ id: saved.id, userId: USER_A, queue: WORK });
			assert(copy, "the queue must hold the assigned copy");
			expect(copy.status).toBe("read");
			expect(copy.savedAt).toEqual(new Date("2026-08-24T10:00:00.000Z"));
			expect(
				await store.listUserSavesForUrl({ userId: USER_A, url: "https://example.com/article" }),
			).toEqual([{}, { queue: "work" }]);
		});

		it("does not assign what the default queue does not hold", async () => {
			const store = initInMemoryArticleStore();

			const result = await store.assignSavedArticleToQueue({
				userId: USER_A,
				queue: WORK,
				url: "https://example.com/article",
				savedAt: new Date("2026-08-24T10:00:00.000Z"),
			});

			expect(result).toEqual({ assigned: false });
		});

		it("keeps the first copy when the same queue is assigned twice", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());
			await store.assignSavedArticleToQueue({
				userId: USER_A,
				queue: WORK,
				url: "https://example.com/article",
				savedAt: new Date("2026-08-24T10:00:00.000Z"),
			});

			const again = await store.assignSavedArticleToQueue({
				userId: USER_A,
				queue: WORK,
				url: "https://example.com/article",
				savedAt: new Date("2026-08-24T11:00:00.000Z"),
			});

			expect(again).toEqual({ assigned: false });
			const copy = await store.findQueueArticleById({ id: saved.id, userId: USER_A, queue: WORK });
			assert(copy, "the queue must hold the assigned copy");
			expect(copy.savedAt).toEqual(new Date("2026-08-24T10:00:00.000Z"));
		});

		it("stamps viewedAt on the addressed queue's copy only", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });
			const at = new Date("2026-08-19T10:00:00.000Z");

			await store.markQueueArticleViewed({
				userId: USER_A,
				queue: WORK,
				url: "https://example.com/article",
				at,
			});
			await store.markQueueArticleViewed({
				userId: USER_A,
				queue: LATER,
				url: "https://example.com/article",
				at,
			});

			expect(await store.findUserArticlesByUrl("https://example.com/article")).toEqual([
				{ userId: USER_A, viewedAt: undefined },
			]);
			assert.ok(saved.id);
		});

		it("keeps a queue copy out of the reader-ready fan-out", async () => {
			const store = initInMemoryArticleStore();
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });

			expect(await store.findUserArticlesByUrl("https://example.com/article")).toEqual([]);
		});

		it("covers a queue-only URL when listing everything the reader saved", async () => {
			const store = initInMemoryArticleStore();
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });

			expect(await store.listUserArticleUrls(USER_A)).toEqual([
				"https://example.com/article",
			]);
		});

		it("reports a URL held in two queues once", async () => {
			const store = initInMemoryArticleStore();
			await store.saveArticle(makeArticleParams());
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });

			expect(await store.listUserArticleUrls(USER_A)).toEqual([
				"https://example.com/article",
			]);
		});

		it("drops every queue copy and definition when the account is deleted", async () => {
			const store = initInMemoryArticleStore();
			await store.saveQueueArticle({ ...makeArticleParams(), queue: WORK });
			await store.createQueueDefinition({
				userId: USER_A,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			});

			await store.deleteAllUserArticles(USER_A);

			expect(await store.findQueueArticles({ userId: USER_A, queue: WORK })).toMatchObject({
				articles: [],
			});
			expect(await store.listQueueDefinitions(USER_A)).toEqual([]);
		});
	});

	describe("queue definitions", () => {
		it("lists a reader's own queues oldest first", async () => {
			const store = initInMemoryArticleStore();
			await store.createQueueDefinition({
				userId: USER_A,
				slug: LATER,
				label: "Later",
				createdAt: new Date("2026-08-19T11:00:00.000Z"),
			});
			await store.createQueueDefinition({
				userId: USER_A,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			});
			await store.createQueueDefinition({
				userId: USER_B,
				slug: WORK,
				label: "Someone else",
				createdAt: new Date("2026-08-19T09:00:00.000Z"),
			});

			expect((await store.listQueueDefinitions(USER_A)).map((d) => d.slug)).toEqual([
				"work",
				"later",
			]);
		});

		it("orders queues created in the same instant by slug", async () => {
			const store = initInMemoryArticleStore();
			const createdAt = new Date("2026-08-19T10:00:00.000Z");
			await store.createQueueDefinition({ userId: USER_A, slug: WORK, label: "Work", createdAt });
			await store.createQueueDefinition({ userId: USER_A, slug: LATER, label: "Later", createdAt });

			expect((await store.listQueueDefinitions(USER_A)).map((d) => d.slug)).toEqual([
				"later",
				"work",
			]);
		});

		it("renames a queue in place, leaving its address and position alone", async () => {
			const store = initInMemoryArticleStore();
			const createdAt = new Date("2026-08-19T10:00:00.000Z");
			await store.createQueueDefinition({ userId: USER_A, slug: WORK, label: "Work", createdAt });
			await store.createQueueDefinition({ userId: USER_A, slug: LATER, label: "Later", createdAt });

			expect(
				await store.renameQueueDefinition({ userId: USER_A, slug: WORK, label: "Deep Work" }),
			).toEqual({ renamed: true });
			expect(
				(await store.listQueueDefinitions(USER_A)).map((d) => [d.slug, d.label]),
			).toEqual([
				["later", "Later"],
				["work", "Deep Work"],
			]);
		});

		it("reports a queue the reader does not hold as unrenamed", async () => {
			const store = initInMemoryArticleStore();

			expect(
				await store.renameQueueDefinition({ userId: USER_A, slug: WORK, label: "Deep Work" }),
			).toEqual({ renamed: false });
		});

		it("drops the definition it deletes and leaves the reader's others", async () => {
			const store = initInMemoryArticleStore();
			const createdAt = new Date("2026-08-19T10:00:00.000Z");
			await store.createQueueDefinition({ userId: USER_A, slug: WORK, label: "Work", createdAt });
			await store.createQueueDefinition({ userId: USER_A, slug: LATER, label: "Later", createdAt });

			expect(await store.deleteQueueDefinition({ userId: USER_A, slug: WORK })).toEqual({
				deleted: true,
			});
			expect((await store.listQueueDefinitions(USER_A)).map((d) => d.slug)).toEqual(["later"]);
		});

		it("reports a queue the reader does not hold as undeleted", async () => {
			const store = initInMemoryArticleStore();

			expect(await store.deleteQueueDefinition({ userId: USER_A, slug: WORK })).toEqual({
				deleted: false,
			});
		});

		it("never deletes another reader's queue of the same name", async () => {
			const store = initInMemoryArticleStore();
			const createdAt = new Date("2026-08-19T10:00:00.000Z");
			await store.createQueueDefinition({ userId: USER_B, slug: WORK, label: "Theirs", createdAt });

			expect(await store.deleteQueueDefinition({ userId: USER_A, slug: WORK })).toEqual({
				deleted: false,
			});
			expect((await store.listQueueDefinitions(USER_B)).map((d) => d.label)).toEqual(["Theirs"]);
		});

		it("never renames another reader's queue of the same name", async () => {
			const store = initInMemoryArticleStore();
			const createdAt = new Date("2026-08-19T10:00:00.000Z");
			await store.createQueueDefinition({ userId: USER_B, slug: WORK, label: "Theirs", createdAt });

			expect(
				await store.renameQueueDefinition({ userId: USER_A, slug: WORK, label: "Mine" }),
			).toEqual({ renamed: false });
			expect((await store.listQueueDefinitions(USER_B)).map((d) => d.label)).toEqual(["Theirs"]);
		});

		it("refuses a slug the reader already holds", async () => {
			const store = initInMemoryArticleStore();
			const createdAt = new Date("2026-08-19T10:00:00.000Z");
			await store.createQueueDefinition({ userId: USER_A, slug: WORK, label: "Work", createdAt });

			expect(
				await store.createQueueDefinition({
					userId: USER_A,
					slug: WORK,
					label: "Work again",
					createdAt,
				}),
			).toEqual({ created: false });
		});

		it("raises the limit error at the per-reader cap", async () => {
			const store = initInMemoryArticleStore();
			const createdAt = new Date("2026-08-19T10:00:00.000Z");
			for (let index = 0; index < QUEUE_MAX_PER_USER; index += 1) {
				await store.createQueueDefinition({
					userId: USER_A,
					slug: QueueSlugSchema.parse(`queue${index}`),
					label: `Queue ${index}`,
					createdAt,
				});
			}

			await expect(
				store.createQueueDefinition({ userId: USER_A, slug: WORK, label: "Work", createdAt }),
			).rejects.toThrow(QueueLimitReachedError);
		});
	});

	describe("markRelatedDismissed", () => {
		const URL = "https://example.com/article";

		const SUGGESTION_ID = ReaderArticleHashId.fromHash("0123456789abcdef0123456789abcdef");

		it("surfaces the dismissal and the suggestion it named, so the reader can tell a snooze from a permanent dismissal", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());

			await store.markRelatedDismissed({ userId: USER_A, url: URL, at: new Date("2026-06-01T10:00:00.000Z"), suggestionId: SUGGESTION_ID });

			const article = await store.findArticleById(saved.id, USER_A);
			assert(article);
			assert.deepEqual(article.relatedDismissedAt, new Date("2026-06-01T10:00:00.000Z"));
			assert.equal(article.relatedDismissedSuggestionId, SUGGESTION_ID);
		});

		it("clears a previously recorded suggestion when the dismissal names none", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());
			await store.markRelatedDismissed({ userId: USER_A, url: URL, at: new Date("2026-06-01T10:00:00.000Z"), suggestionId: SUGGESTION_ID });

			await store.markRelatedDismissed({ userId: USER_A, url: URL, at: new Date("2026-06-02T10:00:00.000Z"), suggestionId: undefined });

			const article = await store.findArticleById(saved.id, USER_A);
			assert(article);
			assert.equal(article.relatedDismissedSuggestionId, undefined);
		});

		it("leaves relatedDismissedAt unset until the owner dismisses", async () => {
			const store = initInMemoryArticleStore();
			const { saved } = await store.saveArticle(makeArticleParams());

			const article = await store.findArticleById(saved.id, USER_A);
			assert(article);
			assert.equal(article.relatedDismissedAt, undefined);
		});

		it("is a no-op for a url the user never saved", async () => {
			const store = initInMemoryArticleStore();
			await store.markRelatedDismissed({ userId: USER_A, url: URL, at: new Date("2026-06-01T10:00:00.000Z"), suggestionId: undefined });

			expect(await store.findArticleByUrl(URL)).toBeNull();
		});
	});
});
