import { ReaderArticleHashIdSchema, SaveableUrlSchema } from "@packages/domain/article";
import { MinutesSchema } from "@packages/domain/article";
import type { SaveProvenance, SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initSaveArticleAtReadlistTop } from "./save-article-at-readlist-top";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const exampleUrl = SaveableUrlSchema.parse("https://example.com/post");
const provenance: SaveProvenance = { kind: "web" };
const allocatedInstant = new Date("2026-08-04T00:00:00.123Z");

const saved: SavedArticle = {
	id: articleId,
	userId,
	url: exampleUrl,
	metadata: { title: "Post", siteName: "Example", excerpt: "", wordCount: 0 },
	estimatedReadTime: MinutesSchema.parse(0),
	status: "unread",
	savedAt: allocatedInstant,
};

describe("initSaveArticleAtReadlistTop", () => {
	it("allocates one readlist position for the caller's user and stamps the save with it", async () => {
		const calls: string[] = [];
		const receivedSaves: unknown[] = [];
		const saveArticleAtReadlistTop = initSaveArticleAtReadlistTop({
			allocateSavedAt: async ({ userId: allocateFor }) => {
				calls.push(`allocate:${allocateFor}`);
				return allocatedInstant;
			},
			saveArticleFromUrl: async (params) => {
				calls.push("save");
				receivedSaves.push(params);
				return { saved, canonicalUrl: exampleUrl, createdUserArticle: true, wroteUserArticle: true };
			},
		});

		const result = await saveArticleAtReadlistTop({
			userId,
			url: exampleUrl,
			freshness: { action: "skip" },
			provenance,
		});

		expect(calls).toEqual([`allocate:${userId}`, "save"]);
		expect(receivedSaves).toEqual([
			{
				userId,
				url: exampleUrl,
				freshness: { action: "skip" },
				provenance,
				savedAt: allocatedInstant,
			},
		]);
		expect(result).toEqual({ saved, canonicalUrl: exampleUrl, createdUserArticle: true, wroteUserArticle: true });
	});

	it("never reaches the save when the position allocation fails", async () => {
		const receivedSaves: unknown[] = [];
		const saveArticleAtReadlistTop = initSaveArticleAtReadlistTop({
			allocateSavedAt: async () => {
				throw new Error("cursor write throttled");
			},
			saveArticleFromUrl: async (params) => {
				receivedSaves.push(params);
				return { saved, canonicalUrl: exampleUrl, createdUserArticle: true, wroteUserArticle: true };
			},
		});

		await expect(
			saveArticleAtReadlistTop({ userId, url: exampleUrl, freshness: { action: "skip" }, provenance }),
		).rejects.toThrow("cursor write throttled");
		expect(receivedSaves).toEqual([]);
	});
});
