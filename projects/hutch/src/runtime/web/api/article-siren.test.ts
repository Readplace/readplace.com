import type {
	ArticleStatus,
	Minutes,
	SavedArticle,
} from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { toArticleSubEntity, toArticleEntity } from "./article-siren";

const ARTICLE_URL = "https://example.com/article";
const ARTICLE_ID = ReaderArticleHashId.from(ARTICLE_URL).value;

function makeArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: ReaderArticleHashId.from(ARTICLE_URL),
		userId: "test-user-id" as UserId,
		url: ARTICLE_URL,
		metadata: {
			title: "Test Article",
			siteName: "Example",
			excerpt: "First paragraph...",
			wordCount: 1200,
			imageUrl: "https://example.com/image.jpg",
		},
		content: "<p>Full article content</p>",
		estimatedReadTime: 5 as Minutes,
		status: "unread" as ArticleStatus,
		savedAt: new Date("2026-03-04T10:00:00.000Z"),
		readAt: undefined,
		...overrides,
	};
}

describe("toArticleSubEntity", () => {
	it("maps sub-entity with exact properties (no content) and structure", () => {
		const article = makeArticle({ content: "<p>Full text</p>" });
		const subEntity = toArticleSubEntity(article);

		expect(subEntity).toEqual({
			class: ["article"],
			rel: ["item"],
			properties: {
				id: ARTICLE_ID,
				url: ARTICLE_URL,
				title: "Test Article",
				siteName: "Example",
				excerpt: "First paragraph...",
				imageUrl: "https://example.com/image.jpg",
				estimatedReadTimeMinutes: 5,
				readTime: { value: "5", label: "~5 min read" },
				status: "unread",
				savedAt: "2026-03-04T10:00:00.000Z",
				readAt: null,
				isRead: false,
				needsBrowserCapture: false,
			},
			links: [
				{ rel: ["read"], title: "Read", href: `/queue/${ARTICLE_ID}/view` },
			],
			actions: [
				{
					name: "update-status",
					title: "Mark as read",
					href: `/queue/${ARTICLE_ID}/status`,
					method: "POST",
					type: "application/x-www-form-urlencoded",
					fields: [{ name: "status", type: "text", value: "read" }],
				},
			],
		});
	});

	it("withholds both read-time keys while the crawl has not landed — a stub's minutes are synthetic", () => {
		const subEntity = toArticleSubEntity(
			makeArticle({
				metadata: {
					title: "Test Article",
					siteName: "Example",
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: 1 as Minutes,
			}),
		);

		expect([
			subEntity.properties?.estimatedReadTimeMinutes,
			subEntity.properties?.readTime,
		]).toEqual([null, null]);
	});

	it("emits the read time as both the legacy minutes and the server-authored label once words are counted", () => {
		const subEntity = toArticleSubEntity(
			makeArticle({
				metadata: {
					title: "Test Article",
					siteName: "Example",
					excerpt: "",
					wordCount: 500,
				},
				estimatedReadTime: 3 as Minutes,
			}),
		);

		expect([
			subEntity.properties?.estimatedReadTimeMinutes,
			subEntity.properties?.readTime,
		]).toEqual([3, { value: "3", label: "~3 min read" }]);
	});

	it("does not advertise a delete action — deletion is website-only", () => {
		const subEntity = toArticleSubEntity(makeArticle());
		const deleteAction = subEntity.actions?.find((a) => a.name === "delete");
		expect(deleteAction).toBeUndefined();
	});

	it("emits isRead as an explicit boolean reflecting the read status", () => {
		expect(toArticleSubEntity(makeArticle({ status: "unread" })).properties?.isRead).toBe(false);
		expect(
			toArticleSubEntity(
				makeArticle({ status: "read", readAt: new Date("2026-03-04T12:00:00.000Z") }),
			).properties?.isRead,
		).toBe(true);
	});

	it("toggles an unread item to a server-driven Mark as read with the target value", () => {
		const subEntity = toArticleSubEntity(makeArticle({ status: "unread" }));
		const updateStatus = subEntity.actions?.find((a) => a.name === "update-status");
		expect(updateStatus).toEqual({
			name: "update-status",
			title: "Mark as read",
			href: `/queue/${ARTICLE_ID}/status`,
			method: "POST",
			type: "application/x-www-form-urlencoded",
			fields: [{ name: "status", type: "text", value: "read" }],
		});
	});

	it("toggles a read item to a server-driven Mark as unread with the target value", () => {
		const subEntity = toArticleSubEntity(
			makeArticle({ status: "read", readAt: new Date("2026-03-04T12:00:00.000Z") }),
		);
		const updateStatus = subEntity.actions?.find((a) => a.name === "update-status");
		expect(updateStatus).toEqual({
			name: "update-status",
			title: "Mark as unread",
			href: `/queue/${ARTICLE_ID}/status`,
			method: "POST",
			type: "application/x-www-form-urlencoded",
			fields: [{ name: "status", type: "text", value: "unread" }],
		});
	});

	it("includes read link when article has no content", () => {
		const article = makeArticle({ content: undefined });
		const subEntity = toArticleSubEntity(article);

		expect(subEntity.links).toEqual([
			{ rel: ["read"], title: "Read", href: `/queue/${ARTICLE_ID}/view` },
		]);
	});

	it("titles the read link so looping clients use a server-authored label", () => {
		const subEntity = toArticleSubEntity(makeArticle());
		const readLink = subEntity.links?.find((l) => l.rel.includes("read"));
		expect(readLink).toEqual({
			rel: ["read"],
			title: "Read",
			href: `/queue/${ARTICLE_ID}/view`,
		});
	});

	it("advertises the redirect destination as the url for a merged article", () => {
		const subEntity = toArticleSubEntity(
			makeArticle({ url: "https://example.com/article.html", displayUrl: "https://example.com/article" }),
		);
		expect(subEntity.properties?.url).toBe("https://example.com/article");
	});

	it("asks for a browser capture when the crawl failed because an origin edge refused our servers", () => {
		const subEntity = toArticleSubEntity(makeArticle(), {
			status: "failed",
			reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
		});

		expect(subEntity.properties?.needsBrowserCapture).toBe(true);
	});

	it("asks for a browser capture on a rate-limited row too — the user's own connection is not the one the origin throttled", () => {
		const subEntity = toArticleSubEntity(makeArticle(), {
			status: "failed",
			reason: JSON.stringify({ kind: "blocked", cause: "rate-limited" }),
		});

		expect(subEntity.properties?.needsBrowserCapture).toBe(true);
	});

	it("asks for no browser capture when robots.txt is the blocker — the site asked us not to crawl it, and a capture would route around that", () => {
		const subEntity = toArticleSubEntity(makeArticle(), {
			status: "failed",
			reason: JSON.stringify({ kind: "blocked", cause: "robots" }),
		});

		expect(subEntity.properties?.needsBrowserCapture).toBe(false);
	});

	it("asks for no browser capture in any other crawl state — the flag invites a user action, so only an edge block may raise it", () => {
		const cases: Array<[string, ArticleCrawl | undefined]> = [
			["no crawl row loaded", undefined],
			["crawl ready", { status: "ready" }],
			["crawl pending", { status: "pending" }],
			[
				"failed on our own parser, which a second fetch would not fix",
				{ status: "failed", reason: JSON.stringify({ kind: "parse-error", detail: "Readability null" }) },
			],
			[
				"failed on robots.txt, which the user's browser does not exempt us from",
				{ status: "failed", reason: JSON.stringify({ kind: "blocked", cause: "robots" }) },
			],
			[
				"failed with a legacy bare-string reason",
				{ status: "failed", reason: "crawl-failed" },
			],
			[
				"failed with the retired cloudflare cause",
				{ status: "failed", reason: JSON.stringify({ kind: "blocked", cause: "cloudflare" }) },
			],
			[
				"unsupported",
				{ status: "unsupported", reason: JSON.stringify({ kind: "paywall" }) },
			],
		];

		for (const [label, crawl] of cases) {
			const subEntity = toArticleSubEntity(makeArticle(), crawl);
			expect([label, subEntity.properties?.needsBrowserCapture]).toEqual([label, false]);
		}
	});

	it("maps readAt when present", () => {
		const article = makeArticle({
			status: "read",
			readAt: new Date("2026-03-04T12:00:00.000Z"),
		});
		const subEntity = toArticleSubEntity(article);

		expect(subEntity.properties?.readAt).toBe("2026-03-04T12:00:00.000Z");
	});
});

describe("toArticleEntity", () => {
	it("returns same structure as sub-entity without rel", () => {
		const article = makeArticle();
		const entity = toArticleEntity(article);
		const subEntity = toArticleSubEntity(article);

		expect(entity).not.toHaveProperty("rel");
		expect(entity.class).toEqual(subEntity.class);
		expect(entity.properties).toEqual(subEntity.properties);
		expect(entity.links).toEqual(subEntity.links);
		expect(entity.actions).toEqual(subEntity.actions);
	});
});
