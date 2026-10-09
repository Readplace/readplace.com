import { DEFAULT_READLIST, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type {
	CountReadlistArticles,
	CountReadlistArticlesQuery,
} from "@packages/provider-contracts/article-store";
import { initFindNonEmptyReadlists } from "./readlist-holdings";

const READER = UserIdSchema.parse("reader-user");
const IDEAS = { slug: ReadlistSlugSchema.parse("a1b2c3d4"), label: "Ideas & Inspiration" };
const FINANCE = { slug: ReadlistSlugSchema.parse("e5f6a7b8"), label: "Finance" };

function recordingCount(holding: ReadonlySet<ReadlistSlug>) {
	const calls: CountReadlistArticlesQuery[] = [];
	const countReadlistArticles: CountReadlistArticles = async (query) => {
		calls.push(query);
		return holding.has(query.readlist) ? 1 : 0;
	};
	return { calls, countReadlistArticles };
}

describe("initFindNonEmptyReadlists", () => {
	it("asks nothing when the reader has fewer than two readlists of their own", async () => {
		const count = recordingCount(new Set([IDEAS.slug]));
		const findNonEmptyReadlists = initFindNonEmptyReadlists({ countReadlistArticles: count.countReadlistArticles });

		const nonEmpty = await findNonEmptyReadlists({ userId: READER, readlists: [DEFAULT_READLIST, IDEAS] });

		expect(nonEmpty).toEqual([]);
		expect(count.calls).toEqual([]);
	});

	it("names the readlists of their own that hold an article, in rail order, and never counts All", async () => {
		const count = recordingCount(new Set([IDEAS.slug]));
		const findNonEmptyReadlists = initFindNonEmptyReadlists({ countReadlistArticles: count.countReadlistArticles });

		const nonEmpty = await findNonEmptyReadlists({
			userId: READER,
			readlists: [DEFAULT_READLIST, IDEAS, FINANCE],
		});

		expect(nonEmpty).toEqual([IDEAS.slug]);
		expect(count.calls).toEqual([
			{ userId: READER, readlist: IDEAS.slug, countLimit: 1 },
			{ userId: READER, readlist: FINANCE.slug, countLimit: 1 },
		]);
	});
});
