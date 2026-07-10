import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test, waitForBrandFonts } from "./hermetic-cdn";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// Fixed instants so the version labels never drift with wall-clock time.
// toAbsoluteShortDateTime formats them in UTC (see local-time.format.ts), and
// the pinned timezoneId below makes the client-side re-localisation resolve to
// the same UTC value — so the rendered labels are byte-stable across runs.
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const CRAWL_VERSIONS = ["2026-07-10T09:14Z", "2026-06-28T22:01Z", "2026-03-26T14:32Z"];
const ARTICLE_URL = "https://example.com/crawl-bookmark-visual";
const CANONICAL_PATH = "example.com/crawl-bookmark-visual";

async function seedCrawledArticle(page: Page): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: ARTICLE_URL,
			title: "Crawl Bookmark Visual",
			contentFetchedAt: CONTENT_FETCHED_AT,
			crawlVersions: CRAWL_VERSIONS,
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
}

async function openReaderWithBookmark(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/view/${CANONICAL_PATH}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(".crawl-bookmark__tabs");
	await waitForBrandFonts(page, ["Inter"]);
	// The newest version's label; waiting on it settles the client re-localisation
	// before the pixel capture so the text can't change mid-screenshot. `.first()`
	// disambiguates the several version rows for strict-mode locators.
	await expect(page.locator(".crawl-bookmark__time").first()).toHaveText("10 Jul '26, 09:14");
}

test.describe("Crawl bookmark visual regression", () => {
	// Pin the browser timezone so the client-side re-localisation of the crawl
	// instant is deterministic and matches the server's UTC formatting.
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("the bookmark renders as one seamless rounded-left capsule (light)", async ({ page }) => {
		await seedCrawledArticle(page);
		await page.emulateMedia({ colorScheme: "light" });
		await openReaderWithBookmark(page);
		await expect(page.locator(".crawl-bookmark")).toHaveScreenshot("crawl-bookmark-light.png");
	});

	test("the bookmark renders as one seamless rounded-left capsule (dark)", async ({ page }) => {
		await seedCrawledArticle(page);
		await page.emulateMedia({ colorScheme: "dark" });
		await openReaderWithBookmark(page);
		await expect(page.locator(".crawl-bookmark")).toHaveScreenshot("crawl-bookmark-dark.png");
	});

	test("the info card's edges align with the handle's edges", async ({ page }) => {
		await seedCrawledArticle(page);
		await openReaderWithBookmark(page);
		const handle = await page.locator(".crawl-bookmark__handle").boundingBox();
		const tabs = await page.locator(".crawl-bookmark__tabs").boundingBox();
		assert.ok(handle && tabs, "handle and info card must have measurable boxes");
		assert.equal(tabs.y, handle.y, "info card top must align with the handle top");
		assert.equal(
			tabs.y + tabs.height,
			handle.y + handle.height,
			"info card bottom must align with the handle bottom",
		);
	});

	// A multi-version capsule grows when open to seat its dated tabs, and the
	// handle stretches with it (verified by the alignment test above). When the
	// disclosure closes (mobile / narrow viewports) the handle must still collapse
	// to a stable, clickable grip at the capsule's 54px min-height — never the thin
	// sliver PR #936 caused by dropping the handle's fixed height. Compared
	// numerically (not via a screenshot) so it needs no per-platform PNG baseline.
	test("the collapsed handle keeps its fixed grip height while the open capsule grows to fit versions", async ({ page }) => {
		await seedCrawledArticle(page);
		await openReaderWithBookmark(page);
		const handle = page.locator(".crawl-bookmark__handle");
		const openHeight = (await handle.boundingBox())?.height;
		await page.locator(".crawl-bookmark").evaluate((el) => el.removeAttribute("open"));
		const collapsedHeight = (await handle.boundingBox())?.height;
		assert.ok(openHeight && collapsedHeight, "handle must have a measurable height in both states");
		assert.ok(openHeight > collapsedHeight, "the open capsule grows taller than the collapsed grip");
		assert.equal(collapsedHeight, 54, "collapsed handle stays at the 54px min-height grip, not a sliver");
	});
});
