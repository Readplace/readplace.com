import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initAddArticleToReadlist } from "./add-article-to-readlist";

const USER = UserIdSchema.parse("user-a");
const WORK = ReadlistSlugSchema.parse("work");
const URL = "https://example.com/article";
const SAVED_AT = new Date("2026-09-01T00:00:00.000Z");

describe("initAddArticleToReadlist", () => {
	it("assigns from the source readlist to the target at a freshly allocated savedAt", async () => {
		const calls: Record<string, unknown>[] = [];
		const add = initAddArticleToReadlist({
			allocateSavedAt: async () => SAVED_AT,
			assignSavedArticleToReadlist: async (params) => {
				calls.push({
					readlist: params.readlist,
					from: params.from,
					url: params.url,
					savedAt: params.savedAt,
				});
				return { assigned: true };
			},
		});

		const result = await add({ userId: USER, readlist: WORK, from: DEFAULT_READLIST_SLUG, url: URL });

		expect(result).toEqual({ assigned: true });
		expect(calls).toEqual([
			{ readlist: "work", from: DEFAULT_READLIST_SLUG, url: URL, savedAt: SAVED_AT },
		]);
	});

	it("passes through a store report that nothing was assigned", async () => {
		const add = initAddArticleToReadlist({
			allocateSavedAt: async () => SAVED_AT,
			assignSavedArticleToReadlist: async () => ({ assigned: false }),
		});
		expect(await add({ userId: USER, readlist: WORK, from: WORK, url: URL })).toEqual({
			assigned: false,
		});
	});
});
