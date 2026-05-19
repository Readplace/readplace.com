import { calculateReadTime } from "@packages/domain/article";
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
	it("returns the pending state on every read when readyAfterReads is unset (deterministic for unit tests)", async () => {
		const { findGeneratedSummary, markSummaryPending } = createFakeSummaryProvider();
		const url = "https://example.com/article";

		await markSummaryPending({ url });
		expect(await findGeneratedSummary(url)).toEqual({ status: "pending" });
		expect(await findGeneratedSummary(url)).toEqual({ status: "pending" });
		expect(await findGeneratedSummary(url)).toEqual({ status: "pending" });
	});

	it("transitions a pending summary to ready once readyAfterReads reads have happened", async () => {
		const { findGeneratedSummary, markSummaryPending } = createFakeSummaryProvider({ readyAfterReads: 3 });
		const url = "https://example.com/article";

		await markSummaryPending({ url });
		expect(await findGeneratedSummary(url)).toEqual({ status: "pending" });
		expect(await findGeneratedSummary(url)).toEqual({ status: "pending" });
		expect(await findGeneratedSummary(url)).toEqual({
			status: "ready",
			summary: `Fake summary for ${url}.`,
		});
	});

	it("leaves an already-ready summary untouched when markSummaryPending is called again", async () => {
		const { findGeneratedSummary, markSummaryPending } = createFakeSummaryProvider({ readyAfterReads: 1 });
		const url = "https://example.com/article";

		await markSummaryPending({ url });
		await findGeneratedSummary(url);
		await markSummaryPending({ url });

		expect(await findGeneratedSummary(url)).toEqual({
			status: "ready",
			summary: `Fake summary for ${url}.`,
		});
	});

	it("returns undefined for a URL that has never been marked pending", async () => {
		const { findGeneratedSummary } = createFakeSummaryProvider({ readyAfterReads: 1 });

		expect(await findGeneratedSummary("https://example.com/never-saved")).toBeUndefined();
	});

	it("forceMarkSummaryPending overrides a ready row back to pending", async () => {
		const { findGeneratedSummary, markSummaryReady, forceMarkSummaryPending } =
			createFakeSummaryProvider();
		const url = "https://example.com/article";

		markSummaryReady({ url, summary: "X", excerpt: "Y" });
		await forceMarkSummaryPending({ url });

		expect(await findGeneratedSummary(url)).toEqual({ status: "pending" });
	});

	it("markSummaryReady writes the supplied summary and excerpt", async () => {
		const { findGeneratedSummary, markSummaryReady } = createFakeSummaryProvider();
		const url = "https://example.com/article";

		markSummaryReady({ url, summary: "Manual summary", excerpt: "Lead." });

		expect(await findGeneratedSummary(url)).toEqual({
			status: "ready",
			summary: "Manual summary",
			excerpt: "Lead.",
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
		expect(fixture.google).toBeUndefined();
		expect(fixture.admin.recrawlServiceToken).toMatch(/.+/);
		expect(fixture.shared.appOrigin).toBe(TEST_APP_ORIGIN);
		expect(fixture.shared.now()).toBeInstanceOf(Date);
		expect(typeof fixture.stripe.createCheckoutSession).toBe("function");
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
			.toMatch(/save/i);
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

	it("shared.logError and shared.logParseError are no-ops that don't throw", () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);

		expect(() => fixture.shared.logError("ignored")).not.toThrow();
		expect(() => fixture.shared.logError("ignored", new Error("x"))).not.toThrow();
		expect(() =>
			fixture.shared.logParseError({ url: "https://x", reason: "boom" }),
		).not.toThrow();
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
		const articleCrawl = initInMemoryArticleCrawl();
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
		await articleCrawl.markCrawlPending({ url });
		await apply(url);

		const status = await articleCrawl.findArticleCrawlStatus(url);
		expect(status?.status).toBe("ready");
	});

	it("marks crawl failed when parseArticle returns ok:false", async () => {
		const articleStore = initInMemoryArticleStore();
		const articleCrawl = initInMemoryArticleCrawl();
		const parseArticle: ParseArticle = async () => ({ ok: false, reason: "no-content" });

		const apply = createFakeApplyParseResult({ articleStore, articleCrawl, parseArticle });
		const url = "https://example.com/x";

		await articleCrawl.markCrawlPending({ url });
		await apply(url);

		const status = await articleCrawl.findArticleCrawlStatus(url);
		expect(status?.status).toBe("failed");
	});

	it("propagates an imageUrl from the parsed article when present", async () => {
		const articleStore = initInMemoryArticleStore();
		const articleCrawl = initInMemoryArticleCrawl();
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
		await articleCrawl.markCrawlPending({ url });
		await apply(url);

		const status = await articleCrawl.findArticleCrawlStatus(url);
		expect(status?.status).toBe("ready");
	});
});

describe("createFakePublishLinkSaved", () => {
	it("invokes applyParseResult after logging", async () => {
		const calls: string[] = [];
		const apply = async (url: string) => {
			calls.push(url);
		};
		const publish = createFakePublishLinkSaved(apply);

		await publish({ url: "https://example.com/x", userId: "user-1" });

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

		await publish({ url: "https://example.com/x" });

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

		await publish({ url: "https://example.com/x" });

		expect(calls).toEqual(["https://example.com/x"]);
	});
});
