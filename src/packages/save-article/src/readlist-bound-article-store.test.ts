import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	bindArticleStoreToReadlist,
	initPublishLinkDequeuedUnlessSavedElsewhere,
} from "./readlist-bound-article-store";

const USER = "user-a" as UserId;
const WORK = ReadlistSlugSchema.parse("work");
const URL = "https://example.com/article";
const ARTICLE_ID = ReaderArticleHashId.from(URL);
const ONE_MINUTE = MinutesSchema.parse(1);

const savedArticle: SavedArticle = {
	id: ARTICLE_ID,
	userId: USER,
	url: URL,
	metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1 },
	estimatedReadTime: ONE_MINUTE,
	status: "unread",
	savedAt: new Date("2026-08-19T10:00:00.000Z"),
};

describe("bindArticleStoreToReadlist", () => {
	it("routes every read and write the delete flow makes into the bound readlist", async () => {
		const calls: Record<string, unknown>[] = [];
		const bound = bindArticleStoreToReadlist(
			{
				deleteReadlistArticle: async (params) => {
					calls.push({ op: "delete", readlist: params.readlist });
					return true;
				},
				findReadlistArticleById: async (params) => {
					calls.push({ op: "find", readlist: params.readlist });
					return savedArticle;
				},
			},
			WORK,
		);

		await bound.deleteArticle(ARTICLE_ID, USER);
		await bound.findArticleById(ARTICLE_ID, USER);

		expect(calls).toEqual([
			{ op: "delete", readlist: "work" },
			{ op: "find", readlist: "work" },
		]);
	});
});

describe("initPublishLinkDequeuedUnlessSavedElsewhere", () => {
	it("announces the link is gone once the reader holds it in no readlist at all", async () => {
		const published: { url: string; userId: UserId }[] = [];
		const publish = initPublishLinkDequeuedUnlessSavedElsewhere({
			listUserSavesForUrl: async () => [],
			publishLinkDequeued: async (params) => {
				published.push(params);
			},
		});

		await publish({ url: URL, userId: USER });

		expect(published).toEqual([{ url: URL, userId: USER }]);
	});

	it("stays silent while the reader still holds the link in another readlist", async () => {
		const published: { url: string; userId: UserId }[] = [];
		const publish = initPublishLinkDequeuedUnlessSavedElsewhere({
			listUserSavesForUrl: async () => [{}],
			publishLinkDequeued: async (params) => {
				published.push(params);
			},
		});

		await publish({ url: URL, userId: USER });

		expect(published).toEqual([]);
	});
});
