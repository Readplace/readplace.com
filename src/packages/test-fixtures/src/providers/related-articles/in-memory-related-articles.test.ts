import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryArticleStore } from "../article-store/in-memory-article-store";
import { initInMemoryRelatedArticles } from "./in-memory-related-articles";

const USER_ID = UserIdSchema.parse("user_abc");
const OTHER_USER_ID = UserIdSchema.parse("user_xyz");
const URL = "https://example.com/post";
const RELATED_URL = "https://example.com/earlier";
const AT = new Date("2026-08-04T00:00:00.000Z");

function build() {
	const articleStore = initInMemoryArticleStore();
	const store = initInMemoryRelatedArticles({
		findArticleByUrl: articleStore.findArticleByUrl,
		findArticleById: articleStore.findArticleById,
	});

	async function save(params: { userId: UserId; url: string; title: string }) {
		const { saved } = await articleStore.saveArticle({
			userId: params.userId,
			url: params.url,
			metadata: {
				title: params.title,
				siteName: "Example",
				excerpt: "An excerpt",
				wordCount: 400,
			},
			estimatedReadTime: MinutesSchema.parse(2),
		});
		return saved;
	}

	return { articleStore, store, save };
}

describe("initInMemoryRelatedArticles", () => {
	it("reports pending until something is written", async () => {
		const { store } = build();

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "pending",
		});
	});

	it("keeps each reader's relations to themselves", async () => {
		const { store, save } = build();
		await save({ userId: USER_ID, url: URL, title: "Target" });
		await save({ userId: USER_ID, url: RELATED_URL, title: "Earlier read" });
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [{ url: RELATED_URL, reason: "Same argument" }],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		expect(await store.findRelatedArticles({ userId: OTHER_USER_ID, url: URL })).toEqual({
			status: "pending",
		});
	});

	it("resolves each relation against the reader's own saved article", async () => {
		const { store, save } = build();
		await save({ userId: USER_ID, url: URL, title: "Target" });
		const related = await save({
			userId: USER_ID,
			url: RELATED_URL,
			title: "Earlier read",
		});
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [{ url: RELATED_URL, reason: "Same argument" }],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [
				{
					id: related.id,
					title: "Earlier read",
					siteName: "Example",
					reason: "Same argument",
					savedAt: related.savedAt,
				},
			],
		});
	});

	it("drops a relation once the reader marks it read, and brings it back when they mark it unread", async () => {
		const { articleStore, store, save } = build();
		await save({ userId: USER_ID, url: URL, title: "Target" });
		const related = await save({
			userId: USER_ID,
			url: RELATED_URL,
			title: "Earlier read",
		});
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [{ url: RELATED_URL, reason: "Same argument" }],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		await articleStore.updateArticleStatus(related.id, USER_ID, "read");
		const afterRead = await store.findRelatedArticles({ userId: USER_ID, url: URL });

		await articleStore.updateArticleStatus(related.id, USER_ID, "unread");
		const afterUnread = await store.findRelatedArticles({ userId: USER_ID, url: URL });

		expect(afterRead).toEqual({ status: "ready", items: [] });
		assert(afterUnread.status === "ready", "the relation list is still computed");
		expect(afterUnread.items.map((item) => item.title)).toEqual(["Earlier read"]);
	});

	it("drops a relation the reader has deleted from their queue", async () => {
		const { articleStore, store, save } = build();
		await save({ userId: USER_ID, url: URL, title: "Target" });
		const related = await save({
			userId: USER_ID,
			url: RELATED_URL,
			title: "Earlier read",
		});
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [{ url: RELATED_URL, reason: "Same argument" }],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		await articleStore.deleteArticle(related.id, USER_ID);

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [],
		});
	});

	it("drops a relation to a url no article was ever saved for", async () => {
		const { store, save } = build();
		await save({ userId: USER_ID, url: URL, title: "Target" });
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [{ url: "https://example.com/never-saved", reason: "Same argument" }],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [],
		});
	});

	it("records a completed computation with no relations", async () => {
		const { store } = build();
		const outcome = await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [],
		});
		expect(outcome).toBe("stored");
	});

	it("records a skip", async () => {
		const { store } = build();
		const outcome = await store.markRelatedArticlesSkipped({
			userId: USER_ID,
			url: URL,
			at: AT,
		});

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "skipped",
		});
		expect(outcome).toBe("stored");
	});

	it("leaves a settled row untouched and reports the later answer as superseded", async () => {
		const { store } = build();
		await store.markRelatedArticlesSkipped({ userId: USER_ID, url: URL, at: AT });

		const outcome = await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [],
			inputTokens: 10,
			outputTokens: 2,
			at: new Date("2026-08-04T00:05:00.000Z"),
		});

		expect(outcome).toBe("superseded");
		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "skipped",
		});
	});

	it("keys on the normalized url so a tracking param cannot hide a computation", async () => {
		const { store } = build();
		await store.markRelatedArticlesSkipped({ userId: USER_ID, url: URL, at: AT });

		expect(
			await store.findRelatedArticles({ userId: USER_ID, url: `${URL}?utm_source=news` }),
		).toEqual({ status: "skipped" });
	});
});
