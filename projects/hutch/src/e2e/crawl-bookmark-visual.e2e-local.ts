import assert from "node:assert/strict";
import { expect, test, type Page } from "@playwright/test";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// A fixed instant so the "Last crawled at" label never drifts with wall-clock
// time. toAbsoluteShortDateTime formats it in UTC (see local-time.format.ts),
// and the pinned timezoneId below makes the client-side re-localisation resolve
// to the same UTC value — so the rendered label is byte-stable across runs.
const CONTENT_FETCHED_AT = "2026-03-26T14:32:00.000Z";
const ARTICLE_URL = "https://example.com/crawl-bookmark-visual";
const CANONICAL_PATH = "example.com/crawl-bookmark-visual";

const FONTS_READY = "document.fonts.ready.then(() => undefined)";

async function seedCrawledArticle(page: Page): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: { url: ARTICLE_URL, title: "Crawl Bookmark Visual", contentFetchedAt: CONTENT_FETCHED_AT },
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
}

async function openReaderWithBookmark(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/view/${CANONICAL_PATH}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(".crawl-bookmark__tabs");
	await page.evaluate(FONTS_READY);
	// The label the seed pinned; waiting on it settles the client re-localisation
	// before the pixel capture so the text can't change mid-screenshot.
	await expect(page.locator(".crawl-bookmark__time")).toHaveText("26 Mar '26, 14:32");
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
});
