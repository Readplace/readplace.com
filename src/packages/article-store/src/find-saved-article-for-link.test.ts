import assert from "node:assert/strict";
import {
	articleDestinationUrl,
	articleDisplayMetadata,
	MinutesSchema,
	ReaderArticleHashId,
	type SavedArticle,
} from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initFindSavedArticleForLink } from "./find-saved-article-for-link";

const USER = UserIdSchema.parse("user-a");

function savedArticleAt(url: string): SavedArticle {
	const destinationUrl = articleDestinationUrl({ url, displayUrl: undefined });
	return {
		id: ReaderArticleHashId.from(url),
		userId: USER,
		url,
		destinationUrl,
		metadata: articleDisplayMetadata({
			url,
			destinationUrl,
			title: "T",
			siteName: "S",
			excerpt: "E",
			wordCount: 1,
			imageUrl: undefined,
			publishedOn: undefined,
		}),
		servedBody: { kind: "legacy" },
		estimatedReadTime: MinutesSchema.parse(1),
		status: "unread",
		savedAt: new Date("2026-10-25T00:00:00.000Z"),
	};
}

function lookup(input: { aliases?: Record<string, string>; saved: string[] }) {
	const resolved: string[] = [];
	const rows = new Map(input.saved.map((url) => [ReaderArticleHashId.from(url).value, savedArticleAt(url)]));
	const find = initFindSavedArticleForLink({
		resolveCanonicalIdentity: async (url) => {
			resolved.push(url);
			return input.aliases?.[url] ?? url;
		},
		findArticleById: async (id, userId) => (userId === USER ? (rows.get(id.value) ?? null) : null),
	});
	return { find, resolved };
}

describe("initFindSavedArticleForLink", () => {
	it("hands the resolver the URL prepared as a save prepares it", async () => {
		const { find, resolved } = lookup({ saved: [] });

		await find({
			userId: USER,
			url: "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451",
		});

		assert.deepEqual(resolved, ["https://www.amazon.com.au/dp/1492043451"]);
	});

	it("finds the canonical's row for a tracker wrapper whose alias points at it", async () => {
		const wrapper = "https://substack.com/redirect/abc-123";
		const canonical = "https://writer.example.com/p/essay";
		const { find } = lookup({ aliases: { [wrapper]: canonical }, saved: [canonical] });

		const found = await find({ userId: USER, url: wrapper });

		assert.equal(found.kind, "saved");
		assert.equal(found.resolvedUrl, canonical);
		assert(found.kind === "saved");
		assert.equal(found.article.url, canonical);
	});

	it("finds the earlier saved row for an adopted terminal URL", async () => {
		const terminal = "https://example.com/final";
		const earlier = "https://example.com/original";
		const { find } = lookup({ aliases: { [terminal]: earlier }, saved: [earlier] });

		const found = await find({ userId: USER, url: terminal });

		assert(found.kind === "saved");
		assert.equal(found.article.url, earlier);
	});

	it("finds a direct URL's own row", async () => {
		const { find } = lookup({ saved: ["https://example.com/post"] });

		const found = await find({ userId: USER, url: "https://example.com/post" });

		assert(found.kind === "saved");
		assert.equal(found.resolvedUrl, "https://example.com/post");
	});

	it("resolves two spellings of one Amazon product to the same row", async () => {
		const { find, resolved } = lookup({ saved: ["https://www.amazon.com.au/dp/1492043451"] });

		const long = await find({
			userId: USER,
			url: "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451",
		});
		const short = await find({ userId: USER, url: "https://www.amazon.com.au/dp/1492043451" });

		assert.equal(resolved[0], resolved[1]);
		assert(long.kind === "saved" && short.kind === "saved");
		assert.equal(long.article.url, short.article.url);
	});

	it("reports a resolved URL with no row in All as not saved", async () => {
		const { find } = lookup({ saved: [] });

		assert.deepEqual(await find({ userId: USER, url: "https://example.com/post" }), {
			kind: "not-saved",
			resolvedUrl: "https://example.com/post",
		});
	});

	it("refuses an unsaveable URL without naming it", async () => {
		const { find } = lookup({ saved: [] });

		await assert.rejects(find({ userId: USER, url: "https://localhost/private" }), (error: Error) => {
			assert.equal(error.message.includes("localhost"), false);
			return true;
		});
	});
});
