import assert from "node:assert/strict";
import type { Minutes, SavedArticle } from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initReaderPermalink, type ReaderPermalinkDeps } from "./reader-permalink";

const OWNER_ID = UserIdSchema.parse("owner-user");
const STRANGER_ID = UserIdSchema.parse("stranger-user");
const STRANGER_ID_PREFIX = "strang";
const ARTICLE_URL = "https://example.com/shared-article";
const ARTICLE_ID = ReaderArticleHashId.from(ARTICLE_URL);
const UNKNOWN_HASH = "0".repeat(32);

const DEFAULT_UTM = "utm_source=read&utm_medium=share&utm_campaign=read-permalink";

function savedArticleFor(userId = OWNER_ID): SavedArticle {
	return {
		id: ARTICLE_ID,
		userId,
		url: ARTICLE_URL,
		metadata: { title: "Post", siteName: "example.com", excerpt: "", wordCount: 100 },
		estimatedReadTime: 1 as Minutes,
		status: "unread",
		savedAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}

function createDeps(overrides: Partial<ReaderPermalinkDeps> = {}): ReaderPermalinkDeps {
	return {
		findArticleById: async () => null,
		findArticleUrlById: async () => null,
		...overrides,
	};
}

describe("resolveReaderPermalink", () => {
	it("redirects to /queue when the id is malformed (not a 32-char hex hash)", async () => {
		const resolve = initReaderPermalink(createDeps());

		const result = await resolve({ rawId: "not-a-hash", requesterId: OWNER_ID, query: {} });

		expect(result).toEqual({
			kind: "redirect",
			redirect: { statusCode: 303, location: "/queue" },
		});
	});

	it("returns the article for an authenticated owner so the route can render the reader", async () => {
		const owned = savedArticleFor(OWNER_ID);
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async (id, userId) =>
				id.value === ARTICLE_ID.value && userId === OWNER_ID ? owned : null,
		}));

		const result = await resolve({ rawId: ARTICLE_ID.value, requesterId: OWNER_ID, query: {} });

		expect(result).toEqual({ kind: "article", article: owned });
	});

	it("redirects a logged-in non-owner to the public /view permalink, stamping utm_content with the first 6 chars of their userId so /view treats the link as a permanent share", async () => {
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async () => null,
			findArticleUrlById: async (id) =>
				id.value === ARTICLE_ID.value ? ARTICLE_URL : null,
		}));

		const result = await resolve({ rawId: ARTICLE_ID.value, requesterId: STRANGER_ID, query: {} });

		expect(result).toEqual({
			kind: "redirect",
			redirect: {
				statusCode: 302,
				location: `/view/${encodeURIComponent(ARTICLE_URL)}?${DEFAULT_UTM}&utm_content=${STRANGER_ID_PREFIX}`,
			},
		});
	});

	it("redirects an anonymous visitor to the public /view permalink without consulting findArticleById, and without stamping utm_content so /view applies the standard 3-day public window", async () => {
		let ownerLookupCalls = 0;
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async () => {
				ownerLookupCalls++;
				return null;
			},
			findArticleUrlById: async () => ARTICLE_URL,
		}));

		const result = await resolve({ rawId: ARTICLE_ID.value, requesterId: undefined, query: {} });

		expect(result).toEqual({
			kind: "redirect",
			redirect: {
				statusCode: 302,
				location: `/view/${encodeURIComponent(ARTICLE_URL)}?${DEFAULT_UTM}`,
			},
		});
		expect(ownerLookupCalls).toBe(0);
		assert(result.kind === "redirect");
		const location = new URL(result.redirect.location, "https://example.test");
		expect(location.searchParams.has("utm_content")).toBe(false);
	});

	it("preserves incoming UTM params over the defaults", async () => {
		const resolve = initReaderPermalink(createDeps({
			findArticleUrlById: async () => ARTICLE_URL,
		}));

		const result = await resolve({
			rawId: ARTICLE_ID.value,
			requesterId: undefined,
			query: { utm_source: "newsletter", utm_campaign: "weekly" },
		});

		expect(result).toEqual({
			kind: "redirect",
			redirect: {
				statusCode: 302,
				location: `/view/${encodeURIComponent(ARTICLE_URL)}?utm_source=newsletter&utm_campaign=weekly`,
			},
		});
	});

	it("redirects to /queue when the hash is well-formed but no article matches", async () => {
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async () => null,
			findArticleUrlById: async () => null,
		}));

		const result = await resolve({ rawId: UNKNOWN_HASH, requesterId: OWNER_ID, query: {} });

		expect(result).toEqual({
			kind: "redirect",
			redirect: { statusCode: 303, location: "/queue" },
		});
	});

	it("percent-encodes special characters in the article URL when building the /view redirect", async () => {
		const trickyUrl = "https://example.com/path with spaces?a=b&c=d";
		const resolve = initReaderPermalink(createDeps({
			findArticleUrlById: async () => trickyUrl,
		}));

		const result = await resolve({ rawId: ARTICLE_ID.value, requesterId: undefined, query: {} });

		expect(result).toEqual({
			kind: "redirect",
			redirect: {
				statusCode: 302,
				location: `/view/${encodeURIComponent(trickyUrl)}?${DEFAULT_UTM}`,
			},
		});
	});

	it("preserves incoming UTM params from a logged-in requester but stamps utm_content with the requester's userId prefix", async () => {
		const resolve = initReaderPermalink(createDeps({
			findArticleUrlById: async () => ARTICLE_URL,
		}));

		const result = await resolve({
			rawId: ARTICLE_ID.value,
			requesterId: STRANGER_ID,
			query: { utm_source: "newsletter", utm_campaign: "weekly" },
		});

		assert(result.kind === "redirect");
		const location = new URL(result.redirect.location, "https://example.test");
		expect(location.searchParams.get("utm_source")).toBe("newsletter");
		expect(location.searchParams.get("utm_campaign")).toBe("weekly");
		expect(location.searchParams.get("utm_content")).toBe(STRANGER_ID_PREFIX);
	});

	it("overrides an incoming utm_content with the current sharer's userId prefix so a re-shared link traces back to the latest sharer, not the original", async () => {
		const resolve = initReaderPermalink(createDeps({
			findArticleUrlById: async () => ARTICLE_URL,
		}));

		const result = await resolve({
			rawId: ARTICLE_ID.value,
			requesterId: STRANGER_ID,
			query: {
				utm_source: "newsletter",
				utm_content: "abcdef",
			},
		});

		assert(result.kind === "redirect");
		const location = new URL(result.redirect.location, "https://example.test");
		expect(location.searchParams.get("utm_source")).toBe("newsletter");
		expect(location.searchParams.get("utm_content")).toBe(STRANGER_ID_PREFIX);
		expect(location.searchParams.getAll("utm_content")).toEqual([STRANGER_ID_PREFIX]);
	});
});
