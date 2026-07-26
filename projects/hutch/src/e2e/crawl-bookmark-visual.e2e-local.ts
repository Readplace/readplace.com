import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test, waitForBrandFonts } from "./hermetic-cdn";
import { captureCheckpoint, measuredBox, type VisualCheckpoint } from "./visual-checkpoint";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// Fixed instants so the version labels never drift with wall-clock time.
// toAbsoluteShortDateTime formats them in UTC (see local-time.format.ts), and
// the pinned timezoneId below makes the client-side re-localisation resolve to
// the same UTC value — so the rendered labels are byte-stable across runs.
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const NEWEST_VERSION = "2026-07-10T09:14Z";
const MULTI_VERSION_ARTICLE = {
	url: "https://example.com/crawl-bookmark-visual",
	crawlVersions: [NEWEST_VERSION, "2026-06-28T22:01Z", "2026-03-26T14:32Z"],
};
const SINGLE_VERSION_ARTICLE = {
	url: "https://example.com/crawl-bookmark-single",
	crawlVersions: [NEWEST_VERSION],
};

interface SeededArticle {
	url: string;
	crawlVersions: string[];
}

async function seedCrawledArticle(page: Page, article: SeededArticle): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: article.url,
			title: "Crawl Bookmark Visual",
			contentFetchedAt: CONTENT_FETCHED_AT,
			crawlVersions: article.crawlVersions,
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
}

function canonicalPathOf(article: SeededArticle): string {
	const { host, pathname } = new URL(article.url);
	return `${host}${pathname}`;
}

async function openReader(page: Page, article: SeededArticle): Promise<void> {
	await page.goto(`${BASE_URL}/view/${canonicalPathOf(article)}`, { waitUntil: "domcontentloaded" });
}

async function bookmarkSettled(page: Page): Promise<void> {
	await page.waitForSelector(".crawl-bookmark__tabs");
	await expect(page.locator(".crawl-bookmark__time").first()).toHaveText("10 Jul '26, 09:14");
}

async function capsuleEdgesAligned(page: Page): Promise<void> {
	const handle = await measuredBox(page, ".crawl-bookmark__handle");
	const tabs = await measuredBox(page, ".crawl-bookmark__tabs");
	assert.equal(tabs.y, handle.y, "info card top must align with the handle top");
	assert.equal(
		tabs.y + tabs.height,
		handle.y + handle.height,
		"info card bottom must align with the handle bottom",
	);
}

const CRAWL_BOOKMARK_LIGHT: VisualCheckpoint = {
	name: "crawl-bookmark-light",
	settled: bookmarkSettled,
	geometry: capsuleEdgesAligned,
	target: ".crawl-bookmark",
	capture: "element",
	pinnedText: [],
};

const CRAWL_BOOKMARK_DARK: VisualCheckpoint = {
	name: "crawl-bookmark-dark",
	settled: bookmarkSettled,
	geometry: capsuleEdgesAligned,
	target: ".crawl-bookmark",
	capture: "element",
	pinnedText: [],
};

async function openReaderWithBookmark(page: Page, article: SeededArticle): Promise<void> {
	await openReader(page, article);
	await bookmarkSettled(page);
	await waitForBrandFonts(page, ["Inter"]);
}

test.describe("Crawl bookmark visual regression", () => {
	// Pin the browser timezone so the client-side re-localisation of the crawl
	// instant is deterministic and matches the server's UTC formatting.
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("the bookmark renders as one seamless rounded-left capsule (light)", async ({ page }) => {
		await seedCrawledArticle(page, MULTI_VERSION_ARTICLE);
		await page.emulateMedia({ colorScheme: "light" });
		await openReader(page, MULTI_VERSION_ARTICLE);
		await captureCheckpoint(page, CRAWL_BOOKMARK_LIGHT);
	});

	test("the bookmark renders as one seamless rounded-left capsule (dark)", async ({ page }) => {
		await seedCrawledArticle(page, MULTI_VERSION_ARTICLE);
		await page.emulateMedia({ colorScheme: "dark" });
		await openReader(page, MULTI_VERSION_ARTICLE);
		await captureCheckpoint(page, CRAWL_BOOKMARK_DARK);
	});

	test("the info card's edges align with the handle's edges", async ({ page }) => {
		await seedCrawledArticle(page, MULTI_VERSION_ARTICLE);
		await openReaderWithBookmark(page, MULTI_VERSION_ARTICLE);
		await capsuleEdgesAligned(page);
	});

	test("a single-version capsule keeps the collapsed height and centers its row", async ({ page }) => {
		await seedCrawledArticle(page, SINGLE_VERSION_ARTICLE);
		await openReaderWithBookmark(page, SINGLE_VERSION_ARTICLE);
		const handle = await page.locator(".crawl-bookmark__handle").boundingBox();
		const tabs = await page.locator(".crawl-bookmark__tabs").boundingBox();
		const row = await page.locator(".crawl-bookmark__tab").boundingBox();
		assert.ok(handle && tabs && row, "handle, tab list, and its single row must have measurable boxes");
		assert.equal(tabs.height, 54, "the open capsule never shrinks below the 54px collapsed height");
		assert.equal(handle.height, 54, "the handle holds the same 54px height while open");
		const gapAbove = row.y - tabs.y;
		const gapBelow = tabs.y + tabs.height - (row.y + row.height);
		assert.ok(gapAbove > 1 && gapBelow > 1, "the short row leaves breathing room above and below");
		assert.ok(
			Math.abs(gapAbove - gapBelow) <= 1,
			"the single row sits vertically centered in the capsule",
		);
	});

	// A multi-version capsule grows when open to seat its dated tabs, and the
	// handle stretches with it (verified by the alignment test above). When the
	// disclosure closes (mobile / narrow viewports) the handle must still collapse
	// to a stable, clickable grip at the capsule's 54px min-height — never the thin
	// sliver PR #936 caused by dropping the handle's fixed height. Compared
	// numerically (not via a screenshot) so it needs no per-platform PNG baseline.
	test("the collapsed handle keeps its fixed grip height while the open capsule grows to fit versions", async ({ page }) => {
		await seedCrawledArticle(page, MULTI_VERSION_ARTICLE);
		await openReaderWithBookmark(page, MULTI_VERSION_ARTICLE);
		const handle = page.locator(".crawl-bookmark__handle");
		const openHeight = (await handle.boundingBox())?.height;
		await page.locator(".crawl-bookmark").evaluate((el) => el.removeAttribute("open"));
		const collapsedHeight = (await handle.boundingBox())?.height;
		assert.ok(openHeight && collapsedHeight, "handle must have a measurable height in both states");
		assert.ok(openHeight > collapsedHeight, "the open capsule grows taller than the collapsed grip");
		assert.equal(collapsedHeight, 54, "collapsed handle stays at the 54px min-height grip, not a sliver");
	});
});

test.describe("Crawl bookmark without client JavaScript", () => {
	test.use({
		timezoneId: "UTC",
		viewport: { width: 375, height: 800 },
		javaScriptEnabled: false,
	});

	test("the hidden tab list still leaves a full-height grip", async ({ page }) => {
		await seedCrawledArticle(page, SINGLE_VERSION_ARTICLE);
		await page.goto(`${BASE_URL}/view/${canonicalPathOf(SINGLE_VERSION_ARTICLE)}`, {
			waitUntil: "domcontentloaded",
		});
		await expect(page.locator(".crawl-bookmark__tabs")).toBeHidden();
		const handle = await page.locator(".crawl-bookmark__handle").boundingBox();
		assert.ok(handle, "handle must have a measurable box");
		assert.equal(handle.height, 54, "script-less narrow handle keeps the 54px grip, not a sliver");
	});
});
