import { ReaderArticleHashIdSchema, SaveAttemptIdSchema, SaveableUrlSchema, articleDestinationUrl, articleDisplayMetadata } from "@packages/domain/article";
import { MinutesSchema } from "@packages/domain/article";
import type { SaveProvenance, SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initSaveArticleAtReadlistTop } from "./save-article-at-readlist-top";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const exampleUrl = SaveableUrlSchema.parse("https://example.com/post");
const destination = articleDestinationUrl({ url: exampleUrl, displayUrl: undefined });
const provenance: SaveProvenance = { kind: "web" };
const saveAttemptId = SaveAttemptIdSchema.parse("save-attempt");
const freshness = { action: "skip" as const, identity: { status: "resolved" as const, url: exampleUrl, originalUrl: exampleUrl } };
const allocatedInstant = new Date("2026-08-04T00:00:00.123Z");

const saved: SavedArticle = {
	id: articleId,
	userId,
	url: exampleUrl,
	destinationUrl: destination,
	metadata: { ...articleDisplayMetadata({ url: exampleUrl, destinationUrl: destination, title: "Post", siteName: "Example", excerpt: "" }), wordCount: 0 },
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
				return { saved, canonicalUrl: exampleUrl, createdUserArticle: true, wroteUserArticle: true, resurfacedFromRead: false };
			},
		});

		const result = await saveArticleAtReadlistTop({
			userId,
			url: exampleUrl,
			freshness,
			provenance, saveAttemptId,
		});

		expect(calls).toEqual([`allocate:${userId}`, "save"]);
		expect(receivedSaves).toEqual([
			{
				userId,
				url: exampleUrl,
				freshness,
				provenance, saveAttemptId,
				savedAt: allocatedInstant,
			},
		]);
		expect(result).toEqual({ saved, canonicalUrl: exampleUrl, createdUserArticle: true, wroteUserArticle: true, resurfacedFromRead: false });
	});

	it("never reaches the save when the position allocation fails", async () => {
		const receivedSaves: unknown[] = [];
		const saveArticleAtReadlistTop = initSaveArticleAtReadlistTop({
			allocateSavedAt: async () => {
				throw new Error("cursor write throttled");
			},
			saveArticleFromUrl: async (params) => {
				receivedSaves.push(params);
				return { saved, canonicalUrl: exampleUrl, createdUserArticle: true, wroteUserArticle: true, resurfacedFromRead: false };
			},
		});

		await expect(
			saveArticleAtReadlistTop({ userId, url: exampleUrl, freshness, provenance, saveAttemptId }),
		).rejects.toThrow("cursor write throttled");
		expect(receivedSaves).toEqual([]);
	});
});
