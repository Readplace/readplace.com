import assert from "node:assert/strict";
import {
	discoveryCandidateOf,
	matchesArticleDiscovery,
	rankDiscoveryTopics,
	resolveArticleDiscovery,
} from "./article-discovery";
import { articleDestinationUrl, articleDisplayMetadata } from "./article-site";
import { toArticleTopics } from "./article-topic";
import { MinutesSchema } from "./article.schema";
import type { SavedArticle } from "./article.types";
import { ReaderArticleHashId } from "./reader-article-hash-id";
import { UserIdSchema } from "../user/user.schema";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const savedAgo = (ms: number) => new Date(NOW.getTime() - ms);

function savedArticle(input: {
	url?: string;
	displayUrl?: string;
	title?: string;
	siteName?: string;
	wordCount?: number;
	minutes?: number;
	savedAt?: Date;
}): SavedArticle {
	const url = input.url ?? "https://example.com/article";
	const destinationUrl = articleDestinationUrl({ url, displayUrl: input.displayUrl });
	return {
		id: ReaderArticleHashId.from(url),
		userId: UserIdSchema.parse("user-1"),
		url,
		destinationUrl,
		metadata: {
			...articleDisplayMetadata({
				url,
				destinationUrl,
				title: input.title ?? "An article",
				siteName: input.siteName ?? "Example",
				excerpt: "",
			}),
			wordCount: input.wordCount ?? 1000,
		},
		estimatedReadTime: MinutesSchema.parse(input.minutes ?? 5),
		status: "unread",
		savedAt: input.savedAt ?? NOW,
	};
}

const query = (input: Partial<Parameters<typeof resolveArticleDiscovery>[0]>) =>
	resolveArticleDiscovery({ time: [], saved: [], topic: [], now: NOW, ...input });

const matches = (article: SavedArticle, topics: string[], discovery: ReturnType<typeof query>) =>
	matchesArticleDiscovery(discoveryCandidateOf(article, toArticleTopics(topics)), discovery);

describe("matchesArticleDiscovery: reading time", () => {
	it("puts each edge minute in the bucket that starts at it, so a 10 min read sits under 10–20 min", () => {
		const bucketsOf = (minutes: number) =>
			(["under-5", "5-10", "10-20", "20-plus"] as const).filter((bucket) =>
				matches(savedArticle({ minutes }), [], query({ time: [bucket] })),
			);

		assert.deepEqual(bucketsOf(4), ["under-5"]);
		assert.deepEqual(bucketsOf(5), ["5-10"]);
		assert.deepEqual(bucketsOf(9), ["5-10"]);
		assert.deepEqual(bucketsOf(10), ["10-20"]);
		assert.deepEqual(bucketsOf(19), ["10-20"]);
		assert.deepEqual(bucketsOf(20), ["20-plus"]);
	});

	it("leaves an article with no displayable read time out of every bucket, and in when no bucket is ticked", () => {
		const uncrawled = savedArticle({ wordCount: 0, minutes: 1 });

		assert.equal(matches(uncrawled, [], query({ time: ["under-5", "5-10", "10-20", "20-plus"] })), false);
		assert.equal(matches(uncrawled, [], query({ q: "article" })), true);
	});
});

describe("matchesArticleDiscovery: saved date", () => {
	it("keeps the rolling window's own edge inside it and the millisecond before it outside", () => {
		const windowsOf = (savedAt: Date) =>
			(["today", "week", "month", "older"] as const).filter((window) =>
				matches(savedArticle({ savedAt }), [], query({ saved: [window] })),
			);

		assert.deepEqual(windowsOf(savedAgo(DAY_MS)), ["today", "week", "month"]);
		assert.deepEqual(windowsOf(savedAgo(DAY_MS + 1)), ["week", "month"]);
		assert.deepEqual(windowsOf(savedAgo(7 * DAY_MS)), ["week", "month"]);
		assert.deepEqual(windowsOf(savedAgo(7 * DAY_MS + 1)), ["month"]);
		assert.deepEqual(windowsOf(savedAgo(30 * DAY_MS)), ["month"]);
		assert.deepEqual(windowsOf(savedAgo(30 * DAY_MS + 1)), ["older"]);
	});
});

describe("matchesArticleDiscovery: combining facets", () => {
	it("passes an article that hits any ticked option inside a group", () => {
		const either = query({ time: ["under-5", "20-plus"] });

		assert.equal(matches(savedArticle({ minutes: 3 }), [], either), true);
		assert.equal(matches(savedArticle({ minutes: 25 }), [], either), true);
		assert.equal(matches(savedArticle({ minutes: 12 }), [], either), false);
	});

	it("passes an article only when it hits every group that has a tick", () => {
		const shortAndRecent = query({ time: ["under-5"], saved: ["today"] });

		assert.equal(matches(savedArticle({ minutes: 3, savedAt: savedAgo(1000) }), [], shortAndRecent), true);
		assert.equal(matches(savedArticle({ minutes: 3, savedAt: savedAgo(2 * DAY_MS) }), [], shortAndRecent), false);
		assert.equal(matches(savedArticle({ minutes: 8, savedAt: savedAgo(1000) }), [], shortAndRecent), false);
	});
});

describe("matchesArticleDiscovery: search", () => {
	it("requires every term to appear somewhere in the article", () => {
		const article = savedArticle({ title: "Minimalism at home", siteName: "Calm Living" });

		assert.equal(matches(article, [], query({ q: "minimalism calm" })), true);
		assert.equal(matches(article, [], query({ q: "minimalism office" })), false);
	});

	it("ignores case and accents on both sides", () => {
		const article = savedArticle({ title: "Walking São Paulo" });

		assert.equal(matches(article, [], query({ q: "sao PAULO" })), true);
		assert.equal(matches(savedArticle({ title: "Sao Paulo by night" }), [], query({ q: "São" })), true);
	});

	it("finds an article by its site label", () => {
		assert.equal(matches(savedArticle({ siteName: "The Paris Review" }), [], query({ q: "paris" })), true);
	});

	it("finds an article by the host it links to", () => {
		const article = savedArticle({ url: "https://blog.example.org/post", title: "Untitled" });

		assert.equal(matches(article, [], query({ q: "blog.example" })), true);
	});

	it("finds an article by one of its topic labels", () => {
		assert.equal(matches(savedArticle({}), ["Personal finance"], query({ q: "finance" })), true);
		assert.equal(matches(savedArticle({}), [], query({ q: "finance" })), false);
	});

	it("never lets a term span two fields of the article", () => {
		const article = savedArticle({ title: "Deep", siteName: "Work" });

		assert.equal(matches(article, [], query({ q: "deepwork" })), false);
	});
});

describe("matchesArticleDiscovery: category", () => {
	it("passes an article that carries a ticked topic in any case", () => {
		const focus = query({ topic: toArticleTopics(["focus"]) });

		assert.equal(matches(savedArticle({}), ["Focus", "Habits"], focus), true);
		assert.equal(matches(savedArticle({}), ["Habits"], focus), false);
	});

	it("passes an article with no topics when Others is ticked, and OR-s it with a ticked topic", () => {
		const othersOnly = query({ topic: ["others"] });
		const focusOrOthers = query({ topic: [...toArticleTopics(["Focus"]), "others"] });

		assert.equal(matches(savedArticle({}), [], othersOnly), true);
		assert.equal(matches(savedArticle({}), ["Habits"], othersOnly), false);
		assert.equal(matches(savedArticle({}), ["Focus"], focusOrOthers), true);
		assert.equal(matches(savedArticle({}), [], focusOrOthers), true);
		assert.equal(matches(savedArticle({}), ["Habits"], focusOrOthers), false);
	});
});

describe("discoveryCandidateOf", () => {
	it("gives an article whose crawl has not landed no read time", () => {
		const candidate = discoveryCandidateOf(savedArticle({ wordCount: 0, minutes: 1 }), []);

		assert.equal(candidate.readTimeMinutes, undefined);
	});

	it("reads the host from where the article links to, not from the URL it was saved under", () => {
		const candidate = discoveryCandidateOf(
			savedArticle({ url: "https://news.google.com/read/abc", displayUrl: "https://www.example.com/story" }),
			[],
		);

		assert.equal(candidate.destinationHost, "www.example.com");
	});
});

describe("rankDiscoveryTopics", () => {
	it("lists the most frequent topic first and breaks a tie alphabetically", () => {
		const ranked = rankDiscoveryTopics([
			toArticleTopics(["Trends", "Fintech"]),
			toArticleTopics(["Fintech", "Lifestyle"]),
			toArticleTopics(["Focus"]),
		]);

		assert.deepEqual(ranked, ["Fintech", "Focus", "Lifestyle", "Trends"]);
	});

	it("counts two spellings of one topic together under the first spelling seen", () => {
		const ranked = rankDiscoveryTopics([
			toArticleTopics(["Focus"]),
			toArticleTopics(["focus"]),
			toArticleTopics(["Habits"]),
		]);

		assert.deepEqual(ranked, ["Focus", "Habits"]);
	});
});
