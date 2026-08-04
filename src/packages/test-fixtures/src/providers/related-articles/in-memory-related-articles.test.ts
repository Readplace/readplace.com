import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryRelatedArticles } from "./in-memory-related-articles";

const USER_ID = UserIdSchema.parse("user_abc");
const OTHER_USER_ID = UserIdSchema.parse("user_xyz");
const URL = "https://example.com/post";
const RELATED_ID = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");

describe("initInMemoryRelatedArticles", () => {
	it("reports pending until something is written", async () => {
		const store = initInMemoryRelatedArticles();

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "pending",
		});
	});

	it("keeps each reader's relations to themselves", async () => {
		const store = initInMemoryRelatedArticles();
		await store.seedRelatedArticles({
			userId: USER_ID,
			url: URL,
			items: [
				{ id: RELATED_ID, title: "Earlier read", siteName: "Example", reason: "Same argument" },
			],
		});

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [
				{ id: RELATED_ID, title: "Earlier read", siteName: "Example", reason: "Same argument" },
			],
		});
		expect(await store.findRelatedArticles({ userId: OTHER_USER_ID, url: URL })).toEqual({
			status: "pending",
		});
	});

	it("records a completed computation with no relations", async () => {
		const store = initInMemoryRelatedArticles();
		await store.markRelatedArticlesReady({
			userId: USER_ID,
			url: URL,
			relatedArticles: [],
			inputTokens: 10,
			outputTokens: 2,
			at: new Date("2026-08-04T00:00:00.000Z"),
		});

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [],
		});
	});

	it("records a skip", async () => {
		const store = initInMemoryRelatedArticles();
		await store.markRelatedArticlesSkipped({
			userId: USER_ID,
			url: URL,
			at: new Date("2026-08-04T00:00:00.000Z"),
		});

		expect(await store.findRelatedArticles({ userId: USER_ID, url: URL })).toEqual({
			status: "skipped",
		});
	});

	it("keys on the normalized url so a tracking param cannot hide a computation", async () => {
		const store = initInMemoryRelatedArticles();
		await store.markRelatedArticlesSkipped({
			userId: USER_ID,
			url: URL,
			at: new Date("2026-08-04T00:00:00.000Z"),
		});

		expect(
			await store.findRelatedArticles({ userId: USER_ID, url: `${URL}?utm_source=news` }),
		).toEqual({ status: "skipped" });
	});
});
