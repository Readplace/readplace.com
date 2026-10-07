import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { BrowserContext, Page, Request, Route } from "@playwright/test";
import { z } from "zod";
import { expect, test, waitForImagePixels } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { NEWER_VERSION_BANNER_TEXT, OFFLINE_BANNER_TEXT, SERVER_TIME_ZONE, formatLocalInstant } from "@packages/web-shell";
import {
	OFFLINE_CACHE_NAME,
	OFFLINE_CACHE_PREFIX,
	OFFLINE_SAVED_AT_HEADER,
	type OfflinePageKind,
	offlineCacheKey,
	offlinePageKind,
} from "../runtime/web/shared/offline-reader/offline-cache";
import { READLIST_PAGE_SIZE } from "../runtime/web/pages/readlist/readlist-page-size";
import {
	browserReportsOnline,
	crawlDrawerRows,
	nextFailedRequestIsBackground,
	offlineCacheHolds,
	offlineCacheNames,
	offlineCachesNamed,
	offlineCopySavedAt,
	offlineWorkerCount,
	pinBrowserOnline,
	recordBannerTexts,
	recordHistoryTraversals,
	workerControlsPage,
} from "./readlist-reader-offline.browser";
import { htmxIsLive } from "./readlist-reader-skeleton.browser";

const PORT = requireEnv("E2E_PORT");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IMAGE_ORIGIN = `http://localhost:${PORT}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const RECRAWLED_AT = "2026-07-11T09:14:00.000Z";
const BODY_TEXT = "Seeded article body for the offline reading test.";
const ARTICLE_IMAGE = "[data-article-body] img";
const READER_BODY = "body.page-reader [data-article-body]";
const CARD_TITLE = "main [data-test-article-title]";
const SORT_LINK = "main [data-test-sort]";
const IMPORT_SELECTED_COUNT = "[data-test-import-summary] .import__summary-count";
const DOWNLOAD_START = "[data-test-offline-download-start]";
const DOWNLOAD_PROGRESS = "[data-test-offline-download-progress]";
const DOWNLOAD_STATUS = "[data-test-offline-download-status]";
const DOWNLOAD_TIMEOUT_MS = 60_000;
const UPDATED_BODY_TEXT = "The article changed since the device kept its copy.";
const OFFLINE_ROW = '[data-test-crawl-bookmark-tab="offline"]';
const CANONICAL_ROW = '[data-test-crawl-bookmark-tab="canonical"]';
const NEWER_VERSION_BAR = "[data-test-newer-version-banner]";
const READER_TIME_ZONE = "Australia/Sydney";
const FIXTURE_IMAGE_PATH = "/e2e/fixtures/image/";
const EARLIER_LISTING_PATH = "/queue?order=asc";
const SLOWER_THAN_THE_OLD_FALLBACK_MS = 4_000;
const PAGE_OUTSIDE_THE_READLIST = "/account";

test.use({ serviceWorkers: "allow", timezoneId: READER_TIME_ZONE });

const CreatedUser = z.union([
	z.object({ ok: z.literal(true), userId: z.string() }),
	z.object({ ok: z.literal(false), reason: z.string() }),
]);

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	const created = CreatedUser.parse(await response.json());
	assert(created.ok, `the e2e user fixture must create ${email}`);
	return created.userId;
}

async function seedSettledArticle(
	page: Page,
	input: { url: string; userId: string; imageUrl: string; title: string; bodyText: string },
): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.url,
			title: input.title,
			content: `<p>${input.bodyText}</p><figure><img src="${input.imageUrl}" alt="Offline fixture"></figure>`,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: input.userId,
			generatedSummary: { summary: "A concise summary.", excerpt: "Lead line." },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the settled article");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function signedInReaderWithImage(
	page: Page,
	run: string,
): Promise<{ readerUrl: string; imageUrl: string; articleUrl: string }> {
	const email = `offline-${run}@example.com`;
	const imageUrl = `${IMAGE_ORIGIN}${FIXTURE_IMAGE_PATH}${run}.png`;
	const articleUrl = `https://example.com/offline-${run}`;
	const userId = await createOwner(page, email);
	await seedSettledArticle(page, {
		url: articleUrl,
		userId,
		imageUrl,
		title: "Offline Reading Post",
		bodyText: BODY_TEXT,
	});
	await loginAs(page, email);
	await page.waitForFunction(workerControlsPage);
	const href = await page.locator("[data-test-article-title]").first().getAttribute("href");
	assert(href, "the queue card must link into the reader");
	return { readerUrl: new URL(href, BASE_URL).href, imageUrl, articleUrl };
}

async function changeArticleBody(page: Page, input: { articleUrl: string; imageUrl: string }): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.articleUrl,
			title: "Offline Reading Post",
			content: `<p>${UPDATED_BODY_TEXT}</p><figure><img src="${input.imageUrl}" alt="Offline fixture"></figure>`,
			contentFetchedAt: RECRAWLED_AT,
			generatedSummary: { summary: "A concise summary.", excerpt: "Lead line." },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must rewrite the article's content");
}

async function storedCopySavedAt(page: Page, readerUrl: string): Promise<string> {
	const savedAt = await page.evaluate(offlineCopySavedAt, {
		cacheName: OFFLINE_CACHE_NAME,
		key: offlineCacheKey(new URL(readerUrl)),
		header: OFFLINE_SAVED_AT_HEADER,
	});
	assert(savedAt, "the device's copy of the article must record when it was saved");
	return savedAt;
}

async function expectDrawerRows(page: Page, keys: string[]): Promise<void> {
	await expect.poll(() => page.evaluate(crawlDrawerRows)).toEqual(keys);
}

async function expectOfflineRow(page: Page, input: { savedAt: string; timeZone: string }): Promise<void> {
	await expectDrawerRows(page, ["offline", "canonical"]);
	const time = page.locator(`${OFFLINE_ROW} time`);
	await expect(time).toHaveAttribute("datetime", input.savedAt);
	await expect(time).toHaveText(
		formatLocalInstant({ iso: input.savedAt, style: "short-datetime", timeZone: input.timeZone }),
	);
	await expect(page.locator(`${CANONICAL_ROW} time`)).toHaveText(
		formatLocalInstant({ iso: CONTENT_FETCHED_AT, style: "short-datetime", timeZone: input.timeZone }),
	);
	await expect(page.locator(`${OFFLINE_ROW} [data-test-crawl-bookmark-badge="offline"]`)).toHaveText("Offline");
}

function isStoredPageOrFixtureImage(url: URL): boolean {
	return offlinePageKind(url) !== undefined || url.pathname.startsWith(FIXTURE_IMAGE_PATH);
}

async function cutNetwork(context: BrowserContext): Promise<{ restore(): Promise<void> }> {
	const refuse = (route: Route) => route.abort("internetdisconnected");
	await context.setOffline(true);
	await context.route(isStoredPageOrFixtureImage, refuse);
	return {
		async restore() {
			await context.unroute(isStoredPageOrFixtureImage, refuse);
			await context.setOffline(false);
		},
	};
}

async function holdAnswers(context: BrowserContext, kind: OfflinePageKind): Promise<{ answer(): void }> {
	const network = new EventEmitter();
	const answered = once(network, "answer");
	await context.route(
		(url) => offlinePageKind(url) === kind,
		async (route) => {
			await answered;
			await route.continue();
		},
	);
	return {
		answer() {
			network.emit("answer");
		},
	};
}

async function openStoredCopyOffline(
	page: Page,
	input: { context: BrowserContext; readerUrl: string },
): Promise<{ restore(): Promise<void> }> {
	const savedAt = await storedCopySavedAt(page, input.readerUrl);
	const network = await cutNetwork(input.context);
	await page.goto(input.readerUrl, { waitUntil: "domcontentloaded" });
	await expect(page.locator(READER_BODY)).toContainText(BODY_TEXT);
	await expect(page.locator(".offline-banner")).toHaveText(OFFLINE_BANNER_TEXT);
	await expectOfflineRow(page, { savedAt, timeZone: SERVER_TIME_ZONE });
	return network;
}

async function visitStoredListing(page: Page, path: string): Promise<string> {
	await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
	const keys = [offlineCacheKey(new URL(page.url()))];
	await expect.poll(() => page.evaluate(offlineCacheHolds, { cacheName: OFFLINE_CACHE_NAME, keys })).toEqual([true]);
	return page.url();
}

async function readOnline(page: Page, input: { readerUrl: string; imageUrl: string }): Promise<void> {
	await page.goto(input.readerUrl, { waitUntil: "domcontentloaded" });
	await expect(page.locator("body.page-reader [data-article-body]")).toContainText(BODY_TEXT);
	await waitForImagePixels(page, ARTICLE_IMAGE);
	const keys = [offlineCacheKey(new URL(input.readerUrl)), input.imageUrl];
	await expect
		.poll(() => page.evaluate(offlineCacheHolds, { cacheName: OFFLINE_CACHE_NAME, keys }))
		.toEqual([true, true]);
}

interface DownloadableArticle {
	imageUrl: string;
	bodyText: string;
}

async function signedInWithUnreadArticles(
	page: Page,
	input: { run: string; count: number },
): Promise<DownloadableArticle[]> {
	const email = `offline-${input.run}@example.com`;
	const userId = await createOwner(page, email);
	const articles: DownloadableArticle[] = [];
	for (let index = 0; index < input.count; index++) {
		const url = `https://example.com/offline-${input.run}-${index}`;
		const imageUrl = `${IMAGE_ORIGIN}${FIXTURE_IMAGE_PATH}${input.run}-${index}.png`;
		const bodyText = `Offline download body ${index}.`;
		await seedSettledArticle(page, { url, userId, imageUrl, title: `Offline Download Post ${index}`, bodyText });
		articles.push({ imageUrl, bodyText });
	}
	await loginAs(page, email);
	return articles;
}

async function downloadUnread(page: Page, total: number): Promise<void> {
	await page.locator(DOWNLOAD_START).click();
	await expect(page.locator(DOWNLOAD_STATUS)).toHaveText(`${total} available offline`, {
		timeout: DOWNLOAD_TIMEOUT_MS,
	});
	await expect(page.locator(DOWNLOAD_PROGRESS)).toHaveJSProperty("value", total);
	await expect(page.locator(DOWNLOAD_PROGRESS)).toHaveJSProperty("max", total);
}

async function openFirstCard(page: Page, article: DownloadableArticle): Promise<void> {
	await page.locator(CARD_TITLE).first().click();
	await expect(page.locator(READER_BODY)).toContainText(article.bodyText);
	await expect(page.locator(ARTICLE_IMAGE)).toHaveAttribute("src", article.imageUrl);
	await waitForImagePixels(page, ARTICLE_IMAGE);
}

test.describe("Offline reading", () => {
	test("reopens an article read online once from the device's copy, image and all, under the offline banner", async ({
		page,
		context,
	}, testInfo) => {
		const article = await signedInReaderWithImage(page, `read-through-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);

		const network = await cutNetwork(context);
		await page.goto(article.readerUrl, { waitUntil: "domcontentloaded" });

		await expect(page.locator("body.page-reader [data-article-body]")).toContainText(BODY_TEXT);
		await waitForImagePixels(page, ARTICLE_IMAGE);
		const banner = page.locator(".offline-banner");
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "false");

		await network.restore();
		await page.reload({ waitUntil: "domcontentloaded" });

		await expect(page.locator("body.page-reader [data-article-body]")).toContainText(BODY_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "true");
	});

	test("shows the offline banner over the device's copy even while the browser still believes it is online", async ({
		page,
		context,
	}, testInfo) => {
		await context.addInitScript(pinBrowserOnline);
		const article = await signedInReaderWithImage(page, `flaky-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);

		await cutNetwork(context);
		await page.goto(article.readerUrl, { waitUntil: "domcontentloaded" });

		await expect(page.locator("body.page-reader [data-article-body]")).toContainText(BODY_TEXT);
		expect(await page.evaluate(browserReportsOnline)).toBe(true);
		const banner = page.locator(".offline-banner");
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "false");
	});

	test("forgets every offline copy and the worker itself when the reader signs out", async ({ page }, testInfo) => {
		const article = await signedInReaderWithImage(page, `sign-out-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);
		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });

		await page.locator(".nav__user-summary").click();
		await page.locator('[data-test-nav-item="logout"]').click();
		await page.waitForSelector("body.page-home");

		await expect.poll(() => page.evaluate(offlineCacheNames)).toEqual([]);
		await expect.poll(() => page.evaluate(offlineWorkerCount)).toBe(0);
	});

	test("downloads every unread article across the listing's pages, as prefetches, and opens each one offline from the list", async ({
		page,
		context,
	}, testInfo) => {
		const total = READLIST_PAGE_SIZE + 1;
		const articles = await signedInWithUnreadArticles(page, {
			run: `download-${testInfo.workerIndex}-${Date.now()}`,
			count: total,
		});
		const newest = articles[total - 1];
		const oldest = articles[0];
		await page.waitForFunction(workerControlsPage);
		const listingUrl = page.url();
		const readerRequests: Request[] = [];
		page.on("request", (request) => {
			if (offlinePageKind(new URL(request.url())) === "reader") readerRequests.push(request);
		});

		await downloadUnread(page, total);

		expect(readerRequests.map((request) => request.headers().purpose)).toEqual(
			Array.from({ length: total }, () => "prefetch"),
		);

		const network = await cutNetwork(context);
		await page.goto(listingUrl, { waitUntil: "domcontentloaded" });
		await expect(page.locator(CARD_TITLE)).toHaveCount(READLIST_PAGE_SIZE);
		await openFirstCard(page, newest);
		const banner = page.locator(".offline-banner");
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "false");

		await page.goto(listingUrl, { waitUntil: "domcontentloaded" });
		await page.locator("main [data-test-pagination-next]").click();
		await expect(page.locator(CARD_TITLE)).toHaveCount(1);
		await openFirstCard(page, oldest);

		await network.restore();
		await page.goto(listingUrl, { waitUntil: "domcontentloaded" });
		await expect(page.locator("[data-test-listing-count-number]")).toHaveText(String(total));
	});

	test("offers to continue a download a reload cut short, and continues from the articles it already holds", async ({
		page,
		context,
	}, testInfo) => {
		const total = 3;
		await signedInWithUnreadArticles(page, { run: `resume-${testInfo.workerIndex}-${Date.now()}`, count: total });
		await page.waitForFunction(workerControlsPage);
		const listingUrl = page.url();
		const held = await page.locator(CARD_TITLE).first().getAttribute("href");
		assert.ok(held, "the newest card must link to its reader");
		const heldPath = new URL(held, BASE_URL).pathname;
		const heldArticle = (url: URL) => url.pathname === heldPath;
		await context.route(heldArticle, () => {});

		await page.locator(DOWNLOAD_START).click();
		await expect(page.locator(DOWNLOAD_STATUS)).toHaveText(`Downloading ${total - 1} of ${total}`, {
			timeout: DOWNLOAD_TIMEOUT_MS,
		});
		await context.unroute(heldArticle);
		await page.goto(listingUrl, { waitUntil: "domcontentloaded" });

		await expect(page.locator(DOWNLOAD_STATUS)).toHaveText(`${total - 1} of ${total} downloaded. Press to continue.`);
		await expect(page.locator(DOWNLOAD_PROGRESS)).toHaveJSProperty("value", total - 1);
		const readerRequests: string[] = [];
		page.on("request", (request) => {
			if (offlinePageKind(new URL(request.url())) === "reader") readerRequests.push(new URL(request.url()).pathname);
		});

		await downloadUnread(page, total);

		expect(readerRequests).toEqual([heldPath]);
		await expect(page.locator("[data-offline-tag]")).toHaveCount(total);
	});

	test("forgets the downloaded articles when the reader signs out", async ({ page }, testInfo) => {
		const [article] = await signedInWithUnreadArticles(page, {
			run: `download-sign-out-${testInfo.workerIndex}-${Date.now()}`,
			count: 1,
		});
		const href = await page.locator(CARD_TITLE).first().getAttribute("href");
		assert(href, "the queue card must link into the reader");

		await downloadUnread(page, 1);

		const keys = [offlineCacheKey(new URL(href, BASE_URL)), article.imageUrl];
		expect(await page.evaluate(offlineCacheHolds, { cacheName: OFFLINE_CACHE_NAME, keys })).toEqual([true, true]);
		await page.locator(".nav__user-summary").click();
		await page.locator('[data-test-nav-item="logout"]').click();
		await page.waitForSelector("body.page-home");

		await expect.poll(() => page.evaluate(offlineCachesNamed, OFFLINE_CACHE_PREFIX)).toEqual([]);
	});

	test("waits for a slow network to bring the article instead of showing the device's copy", async ({
		page,
		context,
	}, testInfo) => {
		const article = await signedInReaderWithImage(page, `slow-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);
		await changeArticleBody(page, article);
		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await page.waitForFunction(workerControlsPage);
		const network = await holdAnswers(context, "reader");

		await page.locator(CARD_TITLE).first().click();
		await page.waitForTimeout(SLOWER_THAN_THE_OLD_FALLBACK_MS);

		await expect(page.locator("[data-test-reader-skeleton]")).toHaveCount(1);
		await expect(page.locator(".offline-banner")).toHaveAttribute("aria-hidden", "true");

		network.answer();

		await expect(page.locator(READER_BODY)).toContainText(UPDATED_BODY_TEXT);
		await expectDrawerRows(page, ["canonical"]);
		await expect(page.locator(".offline-banner")).toHaveAttribute("aria-hidden", "true");
	});

	test("shows the next reader on a shared browser nothing the previous reader stored, once they sign in", async ({
		page,
		context,
	}, testInfo) => {
		const run = `shared-${testInfo.workerIndex}-${Date.now()}`;
		const article = await signedInReaderWithImage(page, `${run}-first`);
		await readOnline(page, article);
		const nextReader = `offline-${run}-next@example.com`;
		await context.clearCookies();
		await createOwner(page, nextReader);

		await page.goto(`${BASE_URL}/login?return=${encodeURIComponent(PAGE_OUTSIDE_THE_READLIST)}`, {
			waitUntil: "domcontentloaded",
		});
		await page.locator("#email").fill(nextReader);
		await page.locator("#password").fill(PASSWORD);
		await page.locator('[data-test-form="login"] button[type="submit"]').click();
		await page.waitForURL(`${BASE_URL}${PAGE_OUTSIDE_THE_READLIST}`);

		const keys = [offlineCacheKey(new URL(article.readerUrl)), article.imageUrl];
		await expect
			.poll(() => page.evaluate(offlineCacheHolds, { cacheName: OFFLINE_CACHE_NAME, keys }))
			.toEqual([false, false]);
		await cutNetwork(context);
		await expect(page.goto(article.readerUrl, { waitUntil: "domcontentloaded" })).rejects.toThrow(/net::ERR_/);
		await expect(page.locator("[data-article-body]")).toHaveCount(0);
	});

	test("forgets every offline copy once the readlist sends a reader whose session is gone to sign in", async ({
		page,
		context,
	}, testInfo) => {
		const article = await signedInReaderWithImage(page, `session-gone-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);
		await context.clearCookies();

		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("#email");

		const keys = [offlineCacheKey(new URL(article.readerUrl)), article.imageUrl];
		await expect
			.poll(() => page.evaluate(offlineCacheHolds, { cacheName: OFFLINE_CACHE_NAME, keys }))
			.toEqual([false, false]);
		await cutNetwork(context);
		await expect(page.goto(article.readerUrl, { waitUntil: "domcontentloaded" })).rejects.toThrow(/net::ERR_/);
		await expect(page.locator("[data-article-body]")).toHaveCount(0);
	});

	test("has nothing to show offline for an article that was never opened", async ({ page, context }, testInfo) => {
		const article = await signedInReaderWithImage(page, `never-opened-${testInfo.workerIndex}-${Date.now()}`);

		await cutNetwork(context);

		await expect(page.goto(article.readerUrl, { waitUntil: "domcontentloaded" })).rejects.toThrow(/net::ERR_/);
		await expect(page.locator("[data-article-body]")).toHaveCount(0);
	});

	test("keeps the list on screen at the list's address under the offline banner when a card opens an article never stored, and one Back leaves the list", async ({
		page,
		context,
	}, testInfo) => {
		await context.addInitScript(pinBrowserOnline);
		await signedInReaderWithImage(page, `failed-tap-${testInfo.workerIndex}-${Date.now()}`);
		const earlierListingUrl = await visitStoredListing(page, EARLIER_LISTING_PATH);
		const listingUrl = await visitStoredListing(page, "/queue");
		await page.evaluate(recordHistoryTraversals);

		await cutNetwork(context);
		await page.locator(CARD_TITLE).first().click();

		await expect(page.locator("html")).toHaveAttribute("data-test-history-traversals", "1");
		const banner = page.locator(".offline-banner");
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "false");
		await expect(page).toHaveURL(listingUrl);
		await expect(page.locator(`body.page-readlist ${CARD_TITLE}`)).toHaveCount(1);
		await expect(page.locator("[data-article-body]")).toHaveCount(0);

		await page.goBack();

		await expect(page).toHaveURL(earlierListingUrl);
		await expect(page.locator(`body.page-readlist ${CARD_TITLE}`)).toHaveCount(1);
		await expect(page.locator("[data-article-body]")).toHaveCount(0);
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
	});

	test("keeps the list on screen at the list's address under the offline banner when a card opens an article never stored on a list the device kept, whose scripts no longer load, and Back leaves the list", async ({
		page,
		context,
	}, testInfo) => {
		await signedInReaderWithImage(page, `stale-list-tap-${testInfo.workerIndex}-${Date.now()}`);
		const earlierListingUrl = await visitStoredListing(page, EARLIER_LISTING_PATH);
		const listingUrl = await visitStoredListing(page, "/queue");
		await cutNetwork(context);
		await page.reload({ waitUntil: "domcontentloaded" });
		const banner = page.locator(".offline-banner");
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		expect(await page.evaluate(htmxIsLive)).toBe(false);
		const failed = page.evaluate(nextFailedRequestIsBackground);

		await page.locator(CARD_TITLE).first().click();

		expect(await failed).toBe(false);
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "false");
		await expect(page).toHaveURL(listingUrl);
		await expect(page.locator(`body.page-readlist ${CARD_TITLE}`)).toHaveCount(1);
		await expect(page.locator("[data-article-body]")).toHaveCount(0);

		await page.goBack();

		await expect(page).toHaveURL(earlierListingUrl);
		await expect(page.locator(`body.page-readlist ${CARD_TITLE}`)).toHaveCount(1);
		await expect(page.locator("[data-article-body]")).toHaveCount(0);
	});

	test("shows the device's copy in the crawl drawer, saved time and Offline badge, under the offline banner", async ({
		page,
		context,
	}, testInfo) => {
		const article = await signedInReaderWithImage(page, `drawer-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);
		const savedAt = await storedCopySavedAt(page, article.readerUrl);

		await cutNetwork(context);
		await page.goto(article.readerUrl, { waitUntil: "domcontentloaded" });

		await expect(page.locator(READER_BODY)).toContainText(BODY_TEXT);
		const banner = page.locator(".offline-banner");
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "false");
		await expectOfflineRow(page, { savedAt, timeZone: SERVER_TIME_ZONE });
	});

	test("asks the worker for the article again when the connection returns over the device's copy, and offers the newer one", async ({
		page,
		context,
	}, testInfo) => {
		const article = await signedInReaderWithImage(page, `reconnect-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);
		await changeArticleBody(page, article);
		const network = await openStoredCopyOffline(page, { context, readerUrl: article.readerUrl });

		await network.restore();

		const bar = page.locator(NEWER_VERSION_BAR);
		await expect(bar).toHaveAttribute("aria-hidden", "false");
		await expect(bar.locator("[data-test-newer-version-message]")).toHaveText(NEWER_VERSION_BANNER_TEXT);
		await expect(page.locator(".offline-banner")).toHaveAttribute("aria-hidden", "true");
		await expectDrawerRows(page, ["offline", "canonical"]);
		await expect(page.locator(READER_BODY)).toContainText(BODY_TEXT);
	});

	test("asks the worker for the article again when the connection returns over the device's copy, and lets the copy go when nothing changed", async ({
		page,
		context,
	}, testInfo) => {
		const article = await signedInReaderWithImage(page, `reconnect-same-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);
		const network = await openStoredCopyOffline(page, { context, readerUrl: article.readerUrl });

		await network.restore();

		await expect(page.locator(".offline-banner")).toHaveText("Back online");
		await expectDrawerRows(page, ["canonical"]);
		await expect(page.locator(NEWER_VERSION_BAR)).toHaveAttribute("aria-hidden", "true");
	});

	test("keeps the offline banner down when only a background request fails without a connection", async ({
		page,
		context,
	}, testInfo) => {
		await context.addInitScript(pinBrowserOnline);
		const article = await signedInReaderWithImage(page, `background-${testInfo.workerIndex}-${Date.now()}`);
		await readOnline(page, article);
		const failed = page.evaluate(nextFailedRequestIsBackground);

		await context.setOffline(true);

		expect(await failed).toBe(true);
		await expect(page.locator(".offline-banner")).toHaveAttribute("aria-hidden", "true");
	});

	test("clears the offline banner with 'Back online' once the reader's next request reaches the server, on a page the worker does not serve", async ({
		page,
		context,
	}) => {
		const toggle = (url: URL) => url.pathname.endsWith("/toggle");
		const refuse = (route: Route) => route.abort("internetdisconnected");
		await page.goto(`${BASE_URL}/import?mode=upload`, { waitUntil: "domcontentloaded" });
		await page.locator("[data-test-import-file-input]").setInputFiles({
			name: "links.txt",
			mimeType: "text/plain",
			buffer: Buffer.from(["https://example.com/offline-banner-a", "https://example.com/offline-banner-b"].join("\n"), "utf-8"),
		});
		await page.waitForSelector("[data-test-import-list]");
		await context.route(toggle, refuse);
		await page.locator('[data-test-import-checkbox="1"]').click();
		const banner = page.locator(".offline-banner");
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "false");
		await context.unroute(toggle, refuse);

		await page.locator('[data-test-import-checkbox="1"]').click();

		await expect(page.locator(IMPORT_SELECTED_COUNT)).toHaveText("1");
		await expect(banner).toHaveText("Back online");
	});

	test("keeps the offline banner up, with no 'Back online' flash, when a card on the list the device kept opens a downloaded article", async ({
		page,
		context,
	}, testInfo) => {
		await context.addInitScript(pinBrowserOnline);
		const [article] = await signedInWithUnreadArticles(page, {
			run: `kept-list-tap-${testInfo.workerIndex}-${Date.now()}`,
			count: 1,
		});
		await page.waitForFunction(workerControlsPage);
		await downloadUnread(page, 1);
		await visitStoredListing(page, EARLIER_LISTING_PATH);
		await visitStoredListing(page, "/queue");
		await cutNetwork(context);
		await page.locator(SORT_LINK).click();
		const banner = page.locator(".offline-banner");
		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		await expect(banner).toHaveAttribute("aria-hidden", "false");
		await page.evaluate(recordBannerTexts);

		await openFirstCard(page, article);

		await expect(banner).toHaveText(OFFLINE_BANNER_TEXT);
		expect(await page.locator("html").getAttribute("data-test-banner-texts")).toBe(OFFLINE_BANNER_TEXT);
	});
});
