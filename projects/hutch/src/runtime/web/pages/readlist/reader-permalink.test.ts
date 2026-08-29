import assert from "node:assert/strict";
import type { Minutes, SavedArticle } from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initReaderPermalink, type ReaderPermalinkDeps } from "./reader-permalink";

const OWNER_ID = UserIdSchema.parse("owner-user");
const STRANGER_ID = UserIdSchema.parse("stranger-user");
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
		findArticleByUrl: async () => null,
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

	it("returns not-found for a tombstoned URL whose id still resolves, so the route can 404 directly instead of bouncing through /view", async () => {
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async () => null,
			findArticleUrlById: async (id) =>
				id.value === ARTICLE_ID.value ? ARTICLE_URL : null,
			findArticleByUrl: async (url) =>
				url === ARTICLE_URL
					? {
						id: ARTICLE_ID,
						url: ARTICLE_URL,
						metadata: { title: "example.com", siteName: "example.com", excerpt: "", wordCount: 0 },
						estimatedReadTime: 0 as Minutes,
						savedAt: new Date("2026-01-01T00:00:00.000Z"),
						purgedAt: new Date("2026-07-16T10:00:00.000Z"),
					}
					: null,
		}));

		const result = await resolve({ rawId: ARTICLE_ID.value, requesterId: STRANGER_ID, query: {} });

		expect(result).toEqual({ kind: "not-found" });
	});

	it("redirects a logged-in non-owner to the public /view permalink", async () => {
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
				location: `/view/example.com/shared-article?${DEFAULT_UTM}`,
			},
		});
	});

	it("redirects an anonymous visitor to the public /view permalink without consulting findArticleById", async () => {
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
				location: `/view/example.com/shared-article?${DEFAULT_UTM}`,
			},
		});
		expect(ownerLookupCalls).toBe(0);
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
				location: `/view/example.com/shared-article?utm_source=newsletter&utm_campaign=weekly`,
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

	it("keeps slashes unencoded in the /view redirect and encodes only the article URL's ?", async () => {
		const trickyUrl = "https://example.com/path with spaces?a=b&c=d";
		const resolve = initReaderPermalink(createDeps({
			findArticleUrlById: async () => trickyUrl,
		}));

		const result = await resolve({ rawId: ARTICLE_ID.value, requesterId: undefined, query: {} });

		expect(result).toEqual({
			kind: "redirect",
			redirect: {
				statusCode: 302,
				location: `/view/example.com/path%20with%20spaces%3Fa=b&c=d?${DEFAULT_UTM}`,
			},
		});
	});

	it("preserves incoming UTM params from a logged-in requester", async () => {
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
		expect(location.searchParams.get("utm_content")).toBe(null);
	});

	it("redirects a logged-out visitor arriving via the reader-ready email marker to /login, returning to the marked private reader after login", async () => {
		const resolve = initReaderPermalink(createDeps({
			findArticleUrlById: async () => ARTICLE_URL,
		}));

		const result = await resolve({
			rawId: ARTICLE_ID.value,
			requesterId: undefined,
			query: { from: "reader-ready-email" },
		});

		expect(result).toEqual({
			kind: "redirect",
			redirect: {
				statusCode: 303,
				location: `/login?return=${encodeURIComponent(`/queue/${ARTICLE_ID.value}/view?from=reader-ready-email`)}`,
			},
		});
	});

	it("renders the reader directly for a logged-in owner when no email marker is present", async () => {
		const owned = savedArticleFor(OWNER_ID);
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async (id, userId) =>
				id.value === ARTICLE_ID.value && userId === OWNER_ID ? owned : null,
		}));

		const result = await resolve({
			rawId: ARTICLE_ID.value,
			requesterId: OWNER_ID,
			query: {},
		});

		expect(result).toEqual({ kind: "article", article: owned });
	});

	it("strips the reader-ready email marker for a logged-in owner by redirecting to the clean shareable permalink", async () => {
		const owned = savedArticleFor(OWNER_ID);
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async (id, userId) =>
				id.value === ARTICLE_ID.value && userId === OWNER_ID ? owned : null,
		}));

		const result = await resolve({
			rawId: ARTICLE_ID.value,
			requesterId: OWNER_ID,
			query: { from: "reader-ready-email" },
		});

		expect(result).toEqual({
			kind: "redirect",
			redirect: { statusCode: 303, location: `/queue/${ARTICLE_ID.value}/view` },
		});
	});

	it("strips only the email marker for a logged-in owner, carrying scalar params (platform=ios, utm_*) onto the clean permalink while dropping array-valued params", async () => {
		const owned = savedArticleFor(OWNER_ID);
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async (id, userId) =>
				id.value === ARTICLE_ID.value && userId === OWNER_ID ? owned : null,
		}));

		const result = await resolve({
			rawId: ARTICLE_ID.value,
			requesterId: OWNER_ID,
			query: {
				from: "reader-ready-email",
				platform: "ios",
				utm_source: "newsletter",
				tags: ["a", "b"],
			},
		});

		assert(result.kind === "redirect");
		expect(result.redirect.statusCode).toBe(303);
		const location = new URL(result.redirect.location, "https://example.test");
		expect(location.pathname).toBe(`/queue/${ARTICLE_ID.value}/view`);
		expect(location.searchParams.get("platform")).toBe("ios");
		expect(location.searchParams.get("utm_source")).toBe("newsletter");
		expect(location.searchParams.has("tags")).toBe(false);
		expect(location.searchParams.has("from")).toBe(false);
	});

	it("ignores the reader-ready email marker for a logged-in non-owner and keeps the public /view share redirect", async () => {
		const resolve = initReaderPermalink(createDeps({
			findArticleById: async () => null,
			findArticleUrlById: async (id) => (id.value === ARTICLE_ID.value ? ARTICLE_URL : null),
		}));

		const result = await resolve({
			rawId: ARTICLE_ID.value,
			requesterId: STRANGER_ID,
			query: { from: "reader-ready-email" },
		});

		expect(result).toEqual({
			kind: "redirect",
			redirect: {
				statusCode: 302,
				location: `/view/example.com/shared-article?${DEFAULT_UTM}`,
			},
		});
	});

	it("passes an incoming utm_content through untouched", async () => {
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
		expect(location.searchParams.getAll("utm_content")).toEqual(["abcdef"]);
	});
});
