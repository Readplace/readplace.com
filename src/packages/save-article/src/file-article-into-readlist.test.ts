import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { SavedArticle, SaveProvenance } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initFileArticleIntoReadlist } from "./file-article-into-readlist";

const USER = UserIdSchema.parse("user-a");
const WORK = ReadlistSlugSchema.parse("work");
const URL = "https://example.com/article";
const ARTICLE_ID = ReaderArticleHashId.from(URL);
const ONE_MINUTE = MinutesSchema.parse(1);
const PROVENANCE: SaveProvenance = { kind: "client", clientName: "Chrome" };

function articleWith(status: "read" | "unread"): SavedArticle {
	return {
		id: ARTICLE_ID,
		userId: USER,
		url: URL,
		metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1 },
		estimatedReadTime: ONE_MINUTE,
		status,
		savedAt: new Date("2026-08-19T10:00:00.000Z"),
	};
}

describe("initFileArticleIntoReadlist", () => {
	it("files the article into the readlist at a freshly allocated savedAt", async () => {
		const saved: Record<string, unknown>[] = [];
		const file = initFileArticleIntoReadlist({
			allocateSavedAt: async () => new Date("2026-09-01T00:00:00.000Z"),
			saveReadlistArticle: async (params) => {
				saved.push({ readlist: params.readlist, url: params.url, savedAt: params.savedAt });
				return {
					saved: articleWith("unread"),
					createdUserArticle: true,
					wroteUserArticle: true,
				};
			},
			updateArticleStatusAcrossReadlists: async () => {
				throw new Error("must not reset an unread filing");
			},
		});

		const result = await file({
			userId: USER,
			readlist: WORK,
			article: articleWith("unread"),
			provenance: PROVENANCE,
		});

		expect(saved).toEqual([
			{ readlist: "work", url: URL, savedAt: new Date("2026-09-01T00:00:00.000Z") },
		]);
		expect(result).toEqual({ createdUserArticle: true, wroteUserArticle: true });
	});

	it("resets a filing that landed already-read back to unread in the addressed readlist", async () => {
		const resets: Record<string, unknown>[] = [];
		const file = initFileArticleIntoReadlist({
			allocateSavedAt: async () => new Date("2026-09-01T00:00:00.000Z"),
			saveReadlistArticle: async () => ({
				saved: articleWith("read"),
				createdUserArticle: false,
				wroteUserArticle: true,
			}),
			updateArticleStatusAcrossReadlists: async (params) => {
				resets.push({ addressed: params.addressed, status: params.status });
				return articleWith("unread");
			},
		});

		await file({ userId: USER, readlist: WORK, article: articleWith("read"), provenance: PROVENANCE });

		expect(resets).toEqual([{ addressed: "work", status: "unread" }]);
	});

	it("leaves an existing row alone when the filing wrote nothing", async () => {
		const file = initFileArticleIntoReadlist({
			allocateSavedAt: async () => new Date("2026-09-01T00:00:00.000Z"),
			saveReadlistArticle: async () => ({
				saved: articleWith("read"),
				createdUserArticle: false,
				wroteUserArticle: false,
			}),
			updateArticleStatusAcrossReadlists: async () => {
				throw new Error("must not reset when nothing was written");
			},
		});

		const result = await file({
			userId: USER,
			readlist: WORK,
			article: articleWith("read"),
			provenance: PROVENANCE,
		});

		expect(result).toEqual({ createdUserArticle: false, wroteUserArticle: false });
	});
});
