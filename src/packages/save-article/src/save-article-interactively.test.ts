import { ReaderArticleHashIdSchema, SaveableUrlSchema } from "@packages/domain/article";
import { MinutesSchema } from "@packages/domain/article";
import type { SaveProvenance, SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initSaveArticleInteractively } from "./save-article-interactively";
import type { SaveArticleFromUrl } from "./save-article-from-url";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const submittedUrl = SaveableUrlSchema.parse("https://redirect.test/short");
const canonicalUrl = "https://example.com/post";
const provenance: SaveProvenance = { kind: "web" };

const saved: SavedArticle = {
	id: articleId,
	userId,
	url: canonicalUrl,
	metadata: { title: "Post", siteName: "Example", excerpt: "", wordCount: 0 },
	estimatedReadTime: MinutesSchema.parse(0),
	status: "unread",
	savedAt: new Date("2026-08-04T00:00:00.000Z"),
};

function build(saveArticleFromUrl: SaveArticleFromUrl) {
	const published: Array<{ url: string; userId: string }> = [];
	const saveArticleInteractively = initSaveArticleInteractively({
		saveArticleFromUrl,
		publishComputeRelatedArticles: async (params) => {
			published.push({ url: params.url, userId: params.userId });
		},
	});
	return { published, saveArticleInteractively };
}

describe("initSaveArticleInteractively", () => {
	it("asks for related articles against the canonical url the save resolved to", async () => {
		const { published, saveArticleInteractively } = build(async () => ({
			saved,
			canonicalUrl,
			createdUserArticle: true,
			wroteUserArticle: true,
		}));

		await saveArticleInteractively({
			userId,
			url: submittedUrl,
			freshness: { action: "skip" },
			provenance,
			savedAt: new Date("2026-08-04T00:00:00.000Z"),
		});

		expect(published).toEqual([{ url: canonicalUrl, userId }]);
	});

	it("returns the wrapped save result unchanged", async () => {
		const { saveArticleInteractively } = build(async () => ({
			saved,
			canonicalUrl,
			createdUserArticle: true,
			wroteUserArticle: true,
		}));

		const result = await saveArticleInteractively({
			userId,
			url: submittedUrl,
			freshness: { action: "skip" },
			provenance,
			savedAt: new Date("2026-08-04T00:00:00.000Z"),
		});

		expect(result).toEqual({ saved, canonicalUrl, createdUserArticle: true, wroteUserArticle: true });
	});

	it("does not ask again when the save landed on a queue entry the reader already had", async () => {
		const { published, saveArticleInteractively } = build(async () => ({
			saved,
			canonicalUrl,
			createdUserArticle: false,
			wroteUserArticle: true,
		}));

		await saveArticleInteractively({
			userId,
			url: submittedUrl,
			freshness: { action: "skip" },
			provenance,
			savedAt: new Date("2026-08-04T00:00:00.000Z"),
		});

		expect(published).toEqual([]);
	});

	it("does not ask for related articles when the save itself fails", async () => {
		const { published, saveArticleInteractively } = build(async () => {
			throw new Error("save failed");
		});

		await expect(
			saveArticleInteractively({
				userId,
				url: submittedUrl,
				freshness: { action: "skip" },
				provenance,
				savedAt: new Date("2026-08-04T00:00:00.000Z"),
			}),
		).rejects.toThrow("save failed");
		expect(published).toEqual([]);
	});
});
