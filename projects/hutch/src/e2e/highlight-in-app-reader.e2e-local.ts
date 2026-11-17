import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { devices, type Page } from "@playwright/test";
import { z } from "zod";
import { APP_BACK_LINK } from "../runtime/web/shared/native-app-links";
import { noteGlyphStyle } from "./highlight-note-glyph.browser";
import { pointInsideText, selectedText } from "./highlight-on-a-phone.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SETTLE_MS = 45000;
const { defaultBrowserType: _defaultBrowserType, ...PIXEL_7 } = devices["Pixel 7"];

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const SHOWN_TOOLBAR = "[data-test-highlight-toolbar]:not([hidden])";
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const MARK = `${CONTENT} mark[data-highlight-id]`;
const NOTE_END = `${CONTENT} mark.article-highlight--note-end`;
const BACK_LINK = "main [data-test-back-link]";

const OPENING_SENTENCE = "The app opens the article in its own reader.";
const TAPPED_SENTENCE = "One tap on this sentence should select all of it.";
const ARTICLE = [
	`<p>${OPENING_SENTENCE} ${TAPPED_SENTENCE}</p>`,
	"<p>A second paragraph keeps the article longer than one sentence.</p>",
].join("");

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openAppReader(page: Page, stamp: string): Promise<void> {
	const email = `highlight-in-app-reader-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/highlight-in-app-reader-${stamp}`,
			title: "Highlighting Inside The App",
			content: ARTICLE,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			generatedSummary: {
				summary: "A fixed summary.",
				excerpt: "A fixed excerpt.",
			},
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/queue/${articleId}/view?platform=android`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector(READY_SLOT);
}

test.describe("Highlighting a passage inside the Android app's reader", () => {
	test.use({ ...PIXEL_7, timezoneId: "UTC" });

	test("a tapped sentence is marked and the swapped reader keeps the app's close link", async ({
		page,
	}, testInfo) => {
		await openAppReader(page, `${testInfo.workerIndex}-${Date.now()}`);
		await expect(page.locator(BACK_LINK)).toHaveAttribute("href", APP_BACK_LINK.topHref);

		const point = await page.evaluate(pointInsideText, { root: CONTENT, exact: TAPPED_SENTENCE });
		await page.touchscreen.tap(point.x, point.y);
		await expect.poll(() => page.evaluate(selectedText), { timeout: SETTLE_MS }).toBe(TAPPED_SENTENCE);
		await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, { timeout: SETTLE_MS });

		await page.locator(HIGHLIGHT_BUTTON).tap();
		await expect(page.locator(MARK)).toHaveText(TAPPED_SENTENCE, { timeout: SETTLE_MS });

		await expect(page.locator(BACK_LINK)).toHaveAttribute("href", APP_BACK_LINK.topHref);
		expect(new URL(page.url()).searchParams.get("platform")).toBe("android");
	});

	test("a tapped sentence saved with a note shows the note glyph after it", async ({ page }, testInfo) => {
		await openAppReader(page, `noted-${testInfo.workerIndex}-${Date.now()}`);

		const point = await page.evaluate(pointInsideText, { root: CONTENT, exact: TAPPED_SENTENCE });
		await page.touchscreen.tap(point.x, point.y);
		await expect.poll(() => page.evaluate(selectedText), { timeout: SETTLE_MS }).toBe(TAPPED_SENTENCE);
		await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, { timeout: SETTLE_MS });

		await page.locator('[data-test-action="add-note"]').tap();
		await page.locator("[data-test-highlight-note-input]").fill("Worth coming back to.");
		await page.locator('[data-test-action="highlight-note-save"]').tap();

		await expect(page.locator(NOTE_END)).toHaveText(TAPPED_SENTENCE, { timeout: SETTLE_MS });
		const glyph = await page.evaluate(noteGlyphStyle, { mark: NOTE_END });
		expect(glyph.maskImage.startsWith('url("data:image/svg+xml')).toBe(true);
	});
});
