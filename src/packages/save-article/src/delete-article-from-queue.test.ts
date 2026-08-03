import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	type DeleteArticleFromQueueDependencies,
	initDeleteArticleFromQueue,
} from "./delete-article-from-queue";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const canonicalUrl = "https://example.com/post";

function makeDeps(overrides: Partial<DeleteArticleFromQueueDependencies> = {}): {
	deps: DeleteArticleFromQueueDependencies;
	dequeued: Array<{ url: string; userId: string }>;
	deleteCalls: number;
} {
	const dequeued: Array<{ url: string; userId: string }> = [];
	let deleteCalls = 0;
	const deps: DeleteArticleFromQueueDependencies = {
		findArticleUrlById: async () => canonicalUrl,
		deleteArticle: async () => {
			deleteCalls += 1;
			return true;
		},
		publishLinkDequeued: async (params) => {
			dequeued.push(params);
		},
		...overrides,
	};
	return {
		deps,
		dequeued,
		get deleteCalls() {
			return deleteCalls;
		},
	};
}

describe("deleteArticleFromQueue", () => {
	it("announces the queue row that left with the URL that row was keyed by", async () => {
		const tracker = makeDeps();

		const deleted = await initDeleteArticleFromQueue(tracker.deps)({ articleId, userId });

		expect(deleted).toBe(true);
		expect(tracker.dequeued).toEqual([{ url: canonicalUrl, userId }]);
	});

	it("re-announces the departure when the row was already gone, so a retry after a failed publish still delivers the fact", async () => {
		const tracker = makeDeps({ deleteArticle: async () => false });

		const deleted = await initDeleteArticleFromQueue(tracker.deps)({ articleId, userId });

		expect(deleted).toBe(false);
		expect(tracker.dequeued).toEqual([{ url: canonicalUrl, userId }]);
	});

	it("deletes nothing for an id that names no article", async () => {
		const tracker = makeDeps({ findArticleUrlById: async () => null });

		const deleted = await initDeleteArticleFromQueue(tracker.deps)({ articleId, userId });

		expect(deleted).toBe(false);
		expect(tracker.deleteCalls).toBe(0);
		expect(tracker.dequeued).toEqual([]);
	});
});
