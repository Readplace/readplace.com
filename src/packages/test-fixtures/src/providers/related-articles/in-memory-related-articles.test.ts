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
			provenance: { kind: "web" },
			savedAt: new Date(),
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
					status: "unread",
					savedAt: related.savedAt,
				},
			],
		});
	});

	it("keeps a relation the reader marks read, dated by when they read it, and drops that date again on unread", async () => {
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

		assert(afterRead.status === "ready", "the relation list is still computed");
		const readItem = afterRead.items[0];
		assert(readItem, "a relation the reader has read is still a relation");
		expect({ status: readItem.status, dated: readItem.readAt instanceof Date }).toEqual({
			status: "read",
			dated: true,
		});
		assert(afterUnread.status === "ready", "the relation list is still computed");
		expect(afterUnread.items.map((item) => ({ title: item.title, status: item.status, readAt: item.readAt }))).toEqual([
			{ title: "Earlier read", status: "unread", readAt: undefined },
		]);
	});

	it("drops a relation the reader has deleted from their readlist", async () => {
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

	it("drops a relation to a webmail page", async () => {
		const { store, save } = build();
		await save({ userId: USER_ID, url: URL, title: "Target" });
		await save({ userId: USER_ID, url: "https://mail.google.com/mail/u/2/", title: "Inbox (12)" });
		const kept = await save({ userId: USER_ID, url: RELATED_URL, title: "Earlier read" });
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [
				{ url: "https://mail.google.com/mail/u/2/", reason: "Inbox" },
				{ url: RELATED_URL, reason: "Same argument" },
			],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		const result = await store.findRelatedArticles({ userId: USER_ID, url: URL });

		assert(result.status === "ready", "a written relation reports ready");
		expect(result.items.map((item) => item.id)).toEqual([kept.id]);
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

	it("hides every copy of the saved article, by title or by destination, and lists a repeated pick once at its first copy", async () => {
		const { store, save } = build();
		await save({ userId: USER_ID, url: URL, title: "Widgets 4.0 Is Out" });
		await save({ userId: USER_ID, url: "https://nodeweekly.com/link/2002/web", title: " widgets 4.0  is out" });
		await save({ userId: USER_ID, url: "https://www.example.com/post/#intro", title: "Announcing the widgets release" });
		await save({ userId: USER_ID, url: "https://javascriptweekly.com/link/1001/web", title: "Publishing packages safely" });
		await save({ userId: USER_ID, url: "https://example.com/publishing-packages", title: "Publishing Packages Safely" });
		await save({ userId: USER_ID, url: RELATED_URL, title: "Widgets 4.1 release notes" });
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [
				{ url: "https://nodeweekly.com/link/2002/web", reason: "The same release" },
				{ url: "https://www.example.com/post/#intro", reason: "The same post again" },
				{ url: "https://javascriptweekly.com/link/1001/web", reason: "First copy" },
				{ url: "https://example.com/publishing-packages", reason: "Second copy" },
				{ url: RELATED_URL, reason: "Next version" },
			],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		const result = await store.findRelatedArticles({ userId: USER_ID, url: URL });

		assert(result.status === "ready", "the relation list is computed");
		expect(result.items.map((item) => item.reason)).toEqual(["First copy", "Next version"]);
	});

	it("lists a repeated pick once even when the saved article itself was never stored", async () => {
		const { store, save } = build();
		await save({ userId: USER_ID, url: "https://javascriptweekly.com/link/1001/web", title: "Publishing packages safely" });
		await save({ userId: USER_ID, url: "https://example.com/publishing-packages", title: "Publishing Packages Safely" });
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [
				{ url: "https://javascriptweekly.com/link/1001/web", reason: "First copy" },
				{ url: "https://example.com/publishing-packages", reason: "Second copy" },
			],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});

		const result = await store.findRelatedArticles({ userId: USER_ID, url: URL });

		assert(result.status === "ready", "the relation list is computed");
		expect(result.items.map((item) => item.reason)).toEqual(["First copy"]);
	});

	it("lets a pick the reader deleted leave its later copy in place", async () => {
		const { articleStore, store, save } = build();
		await save({ userId: USER_ID, url: URL, title: "Target" });
		const deleted = await save({ userId: USER_ID, url: "https://javascriptweekly.com/link/1001/web", title: "Publishing packages safely" });
		await save({ userId: USER_ID, url: "https://example.com/publishing-packages", title: "Publishing packages safely" });
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [
				{ url: "https://javascriptweekly.com/link/1001/web", reason: "Deleted copy" },
				{ url: "https://example.com/publishing-packages", reason: "Live copy" },
			],
			inputTokens: 10,
			outputTokens: 2,
			at: AT,
		});
		await articleStore.deleteArticle(deleted.id, USER_ID);

		const result = await store.findRelatedArticles({ userId: USER_ID, url: URL });

		assert(result.status === "ready", "the relation list is computed");
		expect(result.items.map((item) => item.reason)).toEqual(["Live copy"]);
	});
});
