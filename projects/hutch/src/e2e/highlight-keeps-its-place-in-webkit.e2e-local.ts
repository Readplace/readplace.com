import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { devices, type Page } from "@playwright/test";
import { z } from "zod";
import { selectPassage } from "./highlight-a-passage.browser";
import { watchLowestScroll } from "./highlight-keeps-its-place-in-webkit.browser";
import { maxScrollY, recordScrollAfterSwap } from "./readlist-scroll-stability.browser";

test.use({ browserName: "webkit" });

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const SETTLE_MS = 45000;

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const CREATE_FORM = "[data-test-highlight-create-form]";
const ADD_NOTE_BUTTON = '[data-test-action="add-note"]';
const NOTE_DIALOG = "#note-highlight-dialog";
const NOTE_INPUT = "[data-test-highlight-note-input]";
const MARK = `${CONTENT} mark.article-highlight`;
const HIGHLIGHTS_CARD = "[data-test-highlights-card]";
const DELETE_TRIGGER = '[data-test-action="highlight-delete"]';
const DELETE_CONFIRM = '[data-test-action="highlight-delete-confirm"]';
const SCROLL_STAMP = "data-test-scroll-after-swap";
const LOWEST_STAMP = "data-test-lowest-scroll";

const FILLER =
	"<p>Every filler paragraph of this seeded article repeats one sentence about keeping a long read in view, so the passage worth marking sits at the very end of a long page.</p>";
const LAST_PASSAGE = "The last passage worth keeping closes the article.";
const ARTICLE = [
	...Array.from({ length: 60 }, () => FILLER),
	`<p>${LAST_PASSAGE} Nothing in the article comes after it.</p>`,
].join("");

const { defaultBrowserType: _iphone, ...IPHONE } = devices["iPhone 15 Pro"];
const { defaultBrowserType: _ipad, ...IPAD } = devices["iPad Pro 11"];
const { defaultBrowserType: _safari, ...DESKTOP_SAFARI } = devices["Desktop Safari"];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openReaderAtTheEnd(page: Page, input: { stamp: string; query: string }): Promise<void> {
	const email = `webkit-highlight-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/webkit-highlight-${input.stamp}`,
			title: "Keeping a Long Read in View",
			content: ARTICLE,
			contentFetchedAt: "2026-07-10T09:14:00.000Z",
			savedByUserId: userId,
			generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/queue/${articleId}/view${input.query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(READY_SLOT);
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}

async function selectTheLastPassage(page: Page): Promise<number> {
	await page.evaluate(selectPassage, { root: CONTENT, exact: LAST_PASSAGE });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.evaluate((stamp) => document.documentElement.removeAttribute(stamp), SCROLL_STAMP);
	await page.evaluate(watchLowestScroll);
	return page.evaluate(() => window.scrollY);
}

async function expectScrollHeld(page: Page, before: number): Promise<void> {
	await expect(page.locator("html")).toHaveAttribute(SCROLL_STAMP, String(before), { timeout: SETTLE_MS });
	await expect(page.locator("html")).toHaveAttribute(LOWEST_STAMP, String(before));
}

async function highlightTheLastPassage(page: Page): Promise<void> {
	const before = await selectTheLastPassage(page);
	await page.evaluate(recordScrollAfterSwap, CREATE_FORM);
	await page.locator(HIGHLIGHT_BUTTON).click();
	await expect(page.locator(MARK).filter({ hasText: LAST_PASSAGE })).toHaveCount(1, { timeout: SETTLE_MS });
	await expectScrollHeld(page, before);
}

async function deleteTheOnlyHighlight(page: Page): Promise<void> {
	await page.evaluate((card) => {
		const disclosure = document.querySelector(card);
		if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
	}, HIGHLIGHTS_CARD);
	await page.locator(DELETE_TRIGGER).scrollIntoViewIfNeeded();
	await page.locator(DELETE_TRIGGER).click();
	await expect(page.locator(`${DELETE_CONFIRM}`)).toBeVisible({ timeout: SETTLE_MS });
	await page.evaluate((stamp) => document.documentElement.removeAttribute(stamp), SCROLL_STAMP);
	await page.evaluate(recordScrollAfterSwap, DELETE_CONFIRM);
	const before = await page.evaluate(() => window.scrollY);
	await page.locator(DELETE_CONFIRM).click();
	await expect(page.locator(MARK)).toHaveCount(0, { timeout: SETTLE_MS });
	await expect(page.locator("html")).toHaveAttribute(SCROLL_STAMP, /\d+/, { timeout: SETTLE_MS });
	const after = Number(await page.locator("html").getAttribute(SCROLL_STAMP));
	const deepest = await page.evaluate(maxScrollY);
	expect(Math.abs(after - Math.min(before, deepest))).toBeLessThanOrEqual(1);
}

test.describe("Highlighting at the end of an article in WebKit on an iPhone app", () => {
	test.use({ ...IPHONE, timezoneId: "UTC" });

	test("creates and then deletes a highlight on the last passage without leaving the end of the article", async ({
		page,
	}, testInfo) => {
		await openReaderAtTheEnd(page, { stamp: `iphone-${testInfo.workerIndex}-${Date.now()}`, query: "?platform=ios" });

		await highlightTheLastPassage(page);
		await deleteTheOnlyHighlight(page);
	});

	test("saves a note on the last passage without leaving the end of the article", async ({ page }, testInfo) => {
		await openReaderAtTheEnd(page, { stamp: `note-${testInfo.workerIndex}-${Date.now()}`, query: "?platform=ios" });

		const before = await selectTheLastPassage(page);
		await page.evaluate(recordScrollAfterSwap, NOTE_DIALOG);
		await page.locator(ADD_NOTE_BUTTON).click();
		const dialog = page.locator(`${NOTE_DIALOG}:popover-open`);
		await expect(dialog).toHaveCount(1, { timeout: SETTLE_MS });
		await dialog.locator(NOTE_INPUT).fill("A note written at the end.");
		await dialog.locator('[data-test-action="highlight-note-save"]').click();
		await expect(page.locator(MARK).filter({ hasText: LAST_PASSAGE })).toHaveCount(1, { timeout: SETTLE_MS });
		await expectScrollHeld(page, before);
	});
});

test.describe("Highlighting at the end of an article in WebKit on an iPhone browser", () => {
	test.use({ ...IPHONE, timezoneId: "UTC" });

	test("creates a highlight on the last passage without leaving the end of the article", async ({ page }, testInfo) => {
		await openReaderAtTheEnd(page, { stamp: `mobile-web-${testInfo.workerIndex}-${Date.now()}`, query: "" });

		await highlightTheLastPassage(page);
	});
});

test.describe("Highlighting at the end of an article in WebKit on desktop Safari", () => {
	test.use({ ...DESKTOP_SAFARI, viewport: { width: 1280, height: 900 }, timezoneId: "UTC" });

	test("creates and then deletes a highlight on the last passage without leaving the end of the article", async ({
		page,
	}, testInfo) => {
		await openReaderAtTheEnd(page, { stamp: `desktop-${testInfo.workerIndex}-${Date.now()}`, query: "" });

		await highlightTheLastPassage(page);
		await deleteTheOnlyHighlight(page);
	});
});

test.describe("Highlighting at the end of an article in WebKit on an iPad", () => {
	test.use({ ...IPAD, timezoneId: "UTC" });

	test("creates a highlight on the last passage without leaving the end of the article", async ({ page }, testInfo) => {
		await openReaderAtTheEnd(page, { stamp: `ipad-${testInfo.workerIndex}-${Date.now()}`, query: "" });

		await highlightTheLastPassage(page);
	});
});
