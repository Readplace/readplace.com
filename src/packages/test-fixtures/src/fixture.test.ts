import { ANONYMOUS_VIEWER, SaveAttemptIdSchema, calculateReadTime } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	createFakeSummaryProvider,
	createDefaultTestAppFixture,
	createNoopRefreshArticleIfStale,
	createInMemoryPublishUpdateFetchTimestamp,
	createNoopLogError,
	stubCrawlArticle,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishSaveAnonymousLink,
	createFakePublishRecrawlLinkInitiated,
	TEST_APP_ORIGIN,
} from "./fixture";
import { initInMemoryArticleStore } from "./providers/article-store/in-memory-article-store";
import { initInMemoryArticleCrawl } from "./providers/article-crawl/in-memory-article-crawl";
import type { ParseArticle } from "@packages/article-parser";

describe("createFakeSummaryProvider", () => {
	it("forces a failed summary back to pending and exposes the stored state", async () => {
		const { summaryStateOf, forceMarkSummaryPending, markSummaryFailed } = createFakeSummaryProvider({ findItemOwner: async () => undefined });
		const url = "https://example.com/article";
		markSummaryFailed({ url, reason: "boom" });

		forceMarkSummaryPending(url);

		expect(summaryStateOf(url)).toEqual({ status: "pending" });
	});

	it("returns the pending state on every read when readyAfterReads is unset (deterministic for unit tests)", async () => {
		const { findGeneratedSummary, markSummaryPending } = createFakeSummaryProvider({ findItemOwner: async () => undefined });
		const url = "https://example.com/article";

		await markSummaryPending({ url });
		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({ status: "pending" });
		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({ status: "pending" });
		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({ status: "pending" });
	});

	it("transitions a pending summary to ready once readyAfterReads reads have happened", async () => {
		const { findGeneratedSummary, markSummaryPending } = createFakeSummaryProvider({ findItemOwner: async () => undefined, readyAfterReads: 3 });
		const url = "https://example.com/article";

		await markSummaryPending({ url });
		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({ status: "pending" });
		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({ status: "pending" });
		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({
			status: "ready",
			summary: `Fake summary for ${url}.`,
		});
	});

	it("leaves an already-ready summary untouched when markSummaryPending is called again", async () => {
		const { findGeneratedSummary, markSummaryPending } = createFakeSummaryProvider({ findItemOwner: async () => undefined, readyAfterReads: 1 });
		const url = "https://example.com/article";

		await markSummaryPending({ url });
		await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER });
		await markSummaryPending({ url });

		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({
			status: "ready",
			summary: `Fake summary for ${url}.`,
		});
	});

	it("returns undefined for a URL that has never been marked pending", async () => {
		const { findGeneratedSummary } = createFakeSummaryProvider({ findItemOwner: async () => undefined, readyAfterReads: 1 });

		expect(await findGeneratedSummary({ url: "https://example.com/never-saved", viewer: ANONYMOUS_VIEWER })).toBeUndefined();
	});

	it("markSummaryReady writes the supplied summary and excerpt", async () => {
		const { findGeneratedSummary, markSummaryReady } = createFakeSummaryProvider({ findItemOwner: async () => undefined });
		const url = "https://example.com/article";

		markSummaryReady({ url, summary: "Manual summary", excerpt: "Lead." });

		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({
			status: "ready",
			summary: "Manual summary",
			excerpt: "Lead.",
		});
	});

	it("markSummaryFailed settles the summary as failed with the supplied reason", async () => {
		const { findGeneratedSummary, markSummaryFailed } = createFakeSummaryProvider({ findItemOwner: async () => undefined });
		const url = "https://example.com/article";

		markSummaryFailed({ url, reason: "deepseek timeout" });

		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({
			status: "failed",
			reason: "deepseek timeout",
		});
	});

	it("markSummarySkipped settles the summary as skipped with the supplied reason", async () => {
		const { findGeneratedSummary, markSummarySkipped } = createFakeSummaryProvider({ findItemOwner: async () => undefined });
		const url = "https://example.com/article";

		markSummarySkipped({ url, reason: "content-too-short" });

		expect(await findGeneratedSummary({ url: url, viewer: ANONYMOUS_VIEWER })).toEqual({
			status: "skipped",
			reason: "content-too-short",
		});
	});
});

describe("createDefaultTestAppFixture", () => {
	it("returns a fully populated fixture with in-memory providers", () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);

		expect(typeof fixture.auth.createUser).toBe("function");
		expect(typeof fixture.articleStore.findArticleByUrl).toBe("function");
		expect(typeof fixture.articleCrawl.findArticleCrawlStatus).toBe("function");
		expect(typeof fixture.parser.parseArticle).toBe("function");
		expect(typeof fixture.events.publishLinkSaved).toBe("function");
		expect(typeof fixture.pendingHtml.putPendingHtml).toBe("function");
		expect(typeof fixture.summary.findGeneratedSummary).toBe("function");
		expect(typeof fixture.freshness.refreshArticleIfStale).toBe("function");
		expect(typeof fixture.oauth.oauthModel.getClient).toBe("function");
		expect(typeof fixture.email.sendEmail).toBe("function");
		expect(typeof fixture.emailVerification.createVerificationToken).toBe("function");
		expect(typeof fixture.passwordReset.createPasswordResetToken).toBe("function");
		expect(typeof fixture.browserHandoff.mintBrowserHandoffCode).toBe("function");
		expect(fixture.google).toBeUndefined();
		expect(fixture.admin.recrawlServiceToken).toMatch(/.+/);
		expect(fixture.shared.appOrigin).toBe(TEST_APP_ORIGIN);
		expect(fixture.shared.now()).toBeInstanceOf(Date);
		expect(typeof fixture.hostedCheckout.createCheckoutSession).toBe("function");
		expect(typeof fixture.pendingSignup.storePendingSignup).toBe("function");
		expect(fixture.botDefense.events).toEqual([]);
	});

	it("captures bot-defense events through every log level into the same array", () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const sample = {
			stream: "bot-defense",
			event: "signup_rejected",
			reason: "honeypot",
			timestamp: "2026-01-01T00:00:00Z",
		} as const;

		fixture.botDefense.logger.info(sample);
		fixture.botDefense.logger.warn(sample);
		fixture.botDefense.logger.error(sample);
		fixture.botDefense.logger.debug(sample);

		expect(fixture.botDefense.events).toHaveLength(4);
	});

	it("shared.httpErrorMessageMapping returns a friendly message for known error codes", () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);

		expect(fixture.shared.httpErrorMessageMapping({ error_code: "save_failed" }))
			.toBe("Couldn't save this article. Try again.");
		expect(fixture.shared.httpErrorMessageMapping({})).toBeUndefined();
		expect(fixture.shared.httpErrorMessageMapping({ error_code: "unknown_thing" }))
			.toBeUndefined();
	});

	it("auth uses a fast hash: createUser and verifyCredentials round-trip correctly", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);

		const created = await fixture.auth.createUser({ email: "fast-hash@example.com", password: "pass123" });
		expect(created.ok).toBe(true);

		const ok = await fixture.auth.verifyCredentials({ email: "fast-hash@example.com", password: "pass123" });
		expect(ok.ok).toBe(true);

		const bad = await fixture.auth.verifyCredentials({ email: "fast-hash@example.com", password: "wrong" });
		expect(bad.ok).toBe(false);
	});

	it("shared.logError is a no-op that doesn't throw", () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);

		expect(() => fixture.shared.logError("ignored")).not.toThrow();
		expect(() => fixture.shared.logError("ignored", new Error("x"))).not.toThrow();
	});

	it("a saved private item reads as a pending crawl, and its recorded failure as a processing-failed crawl", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const url = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
		const ownerUserId = UserIdSchema.parse("owner-user");

		expect(await fixture.articleStore.savePrivateItem({ url, ownerUserId, media: { kind: "book", fileName: "dune.epub" }, savedAt: new Date("2026-11-05T10:00:00.000Z") })).toBe("saved");
		expect(await fixture.articleCrawl.findArticleCrawlStatus(url)).toEqual({ status: "pending", startedAt: expect.any(String) });

		expect(await fixture.articleStore.recordPrivateItemFailure({ url, notice: "This book could not be opened." })).toBe("recorded");
		expect(await fixture.articleCrawl.findArticleCrawlStatus(url)).toEqual(
			expect.objectContaining({ status: "failed", reason: JSON.stringify({ kind: "processing-failed", notice: "This book could not be opened." }) }),
		);
	});

	it("leaves the crawl untouched when the private item write does not land", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const url = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
		const ownerUserId = UserIdSchema.parse("owner-user");
		const save = { url, ownerUserId, media: { kind: "book" as const, fileName: "dune.epub" }, savedAt: new Date("2026-11-05T10:00:00.000Z") };
		await fixture.articleStore.savePrivateItem(save);
		await fixture.articleCrawl.markCrawlStage({ url, stage: "crawl-fetching" });

		expect(await fixture.articleStore.savePrivateItem(save)).toBe("already-saved");
		expect(await fixture.articleCrawl.findArticleCrawlStatus(url)).toEqual({ status: "pending", startedAt: expect.any(String), stage: "crawl-fetching" });

		expect(await fixture.articleStore.recordPrivateItemFailure({ url: "https://uploads.readplace.invalid/ffffffffffffffffffffffffffffffff", notice: "gone" })).toBe("not-found");
		expect(await fixture.articleCrawl.findArticleCrawlStatus("https://uploads.readplace.invalid/ffffffffffffffffffffffffffffffff")).toBeUndefined();
	});
});

describe("createNoopRefreshArticleIfStale", () => {
	it("returns { action: 'new' } regardless of input", async () => {
		const refresh = createNoopRefreshArticleIfStale();
		expect(await refresh({ url: "https://example.com/x" })).toEqual({ action: "new" });
	});
});

describe("createInMemoryPublishUpdateFetchTimestamp", () => {
	it("produces a publishUpdateFetchTimestamp that resolves without throwing", async () => {
		const publish = createInMemoryPublishUpdateFetchTimestamp();
		await expect(
			publish({
				url: "https://example.com/x",
				contentFetchedAt: "2026-01-01T00:00:00Z",
			}),
		).resolves.toBeUndefined();
	});
});

describe("createNoopLogError", () => {
	it("returns a function that swallows errors silently", () => {
		const log = createNoopLogError();
		expect(() => log("ignored")).not.toThrow();
		expect(() => log("ignored", new Error("x"))).not.toThrow();
	});
});

describe("stubCrawlArticle", () => {
	it("returns synthetic HTML with the URL's hostname", async () => {
		const result = await stubCrawlArticle({
			url: "https://example.com/article",
		});

		expect(result.status).toBe("fetched");
		if (result.status === "fetched") {
			expect(result.html).toContain("example.com");
		}
	});
});

describe("createFakeApplyParseResult", () => {
	const seedGlobalArticle = async (
		articleStore: ReturnType<typeof initInMemoryArticleStore>,
		url: string,
	) => {
		await articleStore.saveArticleGlobally({
			url,
			metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0),
			savedAt: new Date(),
		});
	};

	it("writes parsed metadata + content and marks crawl ready when parseArticle succeeds", async () => {
		const articleStore = initInMemoryArticleStore();
		const articleCrawl = initInMemoryArticleCrawl({ now: () => new Date() });
		const parseArticle: ParseArticle = async () => ({
			ok: true,
			article: {
				title: "Title",
				siteName: "Site",
				excerpt: "Lead",
				wordCount: 500,
				content: "<p>body</p>",
			},
		});

		const apply = createFakeApplyParseResult({ articleStore, articleCrawl, parseArticle });
		const url = "https://example.com/x";

		await seedGlobalArticle(articleStore, url);
		await articleCrawl.markCrawlPending({ url, measured: false, meteredLegs: "run" });
		await apply(url);

		const status = await articleCrawl.findArticleCrawlStatus(url);
		expect(status?.status).toBe("ready");
	});

	it("marks crawl failed when parseArticle returns ok:false", async () => {
		const articleStore = initInMemoryArticleStore();
		const articleCrawl = initInMemoryArticleCrawl({ now: () => new Date() });
		const parseArticle: ParseArticle = async () => ({ ok: false, reason: "no-content" });

		const apply = createFakeApplyParseResult({ articleStore, articleCrawl, parseArticle });
		const url = "https://example.com/x";

		await articleCrawl.markCrawlPending({ url, measured: false, meteredLegs: "run" });
		await apply(url);

		const status = await articleCrawl.findArticleCrawlStatus(url);
		expect(status?.status).toBe("failed");
	});

	it("propagates an imageUrl from the parsed article when present", async () => {
		const articleStore = initInMemoryArticleStore();
		const articleCrawl = initInMemoryArticleCrawl({ now: () => new Date() });
		const parseArticle: ParseArticle = async () => ({
			ok: true,
			article: {
				title: "Title",
				siteName: "Site",
				excerpt: "Lead",
				wordCount: 500,
				content: "<p>body</p>",
				imageUrl: "https://example.com/image.jpg",
			},
		});

		const apply = createFakeApplyParseResult({ articleStore, articleCrawl, parseArticle });
		const url = "https://example.com/x";

		await seedGlobalArticle(articleStore, url);
		await articleCrawl.markCrawlPending({ url, measured: false, meteredLegs: "run" });
		await apply(url);

		const status = await articleCrawl.findArticleCrawlStatus(url);
		expect(status?.status).toBe("ready");
	});

	it("writes the parsed article's publish date onto the global row", async () => {
		const articleStore = initInMemoryArticleStore();
		const articleCrawl = initInMemoryArticleCrawl({ now: () => new Date() });
		const parseArticle: ParseArticle = async () => ({
			ok: true,
			article: {
				title: "Title",
				siteName: "Site",
				excerpt: "Lead",
				wordCount: 500,
				content: "<p>body</p>",
				publishedOn: "2025-10-08",
			},
		});

		const apply = createFakeApplyParseResult({ articleStore, articleCrawl, parseArticle });
		const url = "https://example.com/x";

		await seedGlobalArticle(articleStore, url);
		await apply(url);

		const article = await articleStore.findArticleByUrl(url);
		expect(article?.metadata.publishedOn).toBe("2025-10-08");
	});
});

describe("createFakePublishLinkSaved", () => {
	it("invokes applyParseResult after logging", async () => {
		const calls: string[] = [];
		const apply = async (url: string) => {
			calls.push(url);
		};
		const publish = createFakePublishLinkSaved(apply);

		await publish({ url: "https://example.com/x", userId: UserIdSchema.parse("user-1"), saveAttemptId: SaveAttemptIdSchema.parse("attempt-1") });

		expect(calls).toEqual(["https://example.com/x"]);
	});
});

describe("createFakePublishSaveAnonymousLink", () => {
	it("invokes applyParseResult after logging", async () => {
		const calls: string[] = [];
		const apply = async (url: string) => {
			calls.push(url);
		};
		const publish = createFakePublishSaveAnonymousLink(apply);

		await publish({ url: "https://example.com/x", saveAttemptId: SaveAttemptIdSchema.parse("attempt-1") });

		expect(calls).toEqual(["https://example.com/x"]);
	});
});

describe("createFakePublishRecrawlLinkInitiated", () => {
	it("invokes applyParseResult after logging", async () => {
		const calls: string[] = [];
		const apply = async (url: string) => {
			calls.push(url);
		};
		const publish = createFakePublishRecrawlLinkInitiated(apply);

		await publish({ url: "https://example.com/x", saveAttemptId: SaveAttemptIdSchema.parse("attempt-1") });

		expect(calls).toEqual(["https://example.com/x"]);
	});
});
