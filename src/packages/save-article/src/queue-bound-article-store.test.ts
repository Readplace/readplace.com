import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { QueueSlugSchema } from "@packages/domain/queue";
import type { UserId } from "@packages/domain/user";
import {
	bindArticleStoreToQueue,
	initPublishLinkDequeuedUnlessSavedElsewhere,
} from "./queue-bound-article-store";

const USER = "user-a" as UserId;
const WORK = QueueSlugSchema.parse("work");
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

describe("bindArticleStoreToQueue", () => {
	it("routes every read and write the status and delete flows make into the bound queue", async () => {
		const calls: Record<string, unknown>[] = [];
		const bound = bindArticleStoreToQueue(
			{
				updateQueueArticleStatus: async (params) => {
					calls.push({ op: "status", queue: params.queue, status: params.status });
					return savedArticle;
				},
				deleteQueueArticle: async (params) => {
					calls.push({ op: "delete", queue: params.queue });
					return true;
				},
				findQueueArticleById: async (params) => {
					calls.push({ op: "find", queue: params.queue });
					return savedArticle;
				},
			},
			WORK,
		);

		await bound.updateArticleStatus(ARTICLE_ID, USER, "read");
		await bound.deleteArticle(ARTICLE_ID, USER);
		await bound.findArticleById(ARTICLE_ID, USER);

		expect(calls).toEqual([
			{ op: "status", queue: "work", status: "read" },
			{ op: "delete", queue: "work" },
			{ op: "find", queue: "work" },
		]);
	});
});

describe("initPublishLinkDequeuedUnlessSavedElsewhere", () => {
	it("announces the link is gone once the reader holds it in no queue at all", async () => {
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

	it("stays silent while the reader still holds the link in another queue", async () => {
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
