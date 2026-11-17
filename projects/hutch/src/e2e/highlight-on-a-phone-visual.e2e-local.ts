import assert from "node:assert/strict";
import { captureCheckpoint, expect, measuredBox, test, type VisualCheckpoint, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { devices, type Page } from "@playwright/test";
import { z } from "zod";
import { noteGlyphGeometry } from "./highlight-note-glyph.browser";
import { pointInsideText, selectedText, toolbarNearSelection } from "./highlight-on-a-phone.browser";
import { neutraliseVolatileChrome } from "./page-measurements.browser";
import { MACOS_CHROME_USER_AGENT } from "./user-agents";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SETTLE_MS = 45000;
const { defaultBrowserType: _defaultBrowserType, ...PIXEL_7 } = devices["Pixel 7"];

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const SHOWN_TOOLBAR = `${TOOLBAR}:not([hidden])`;
const NOTE_END = `${CONTENT} mark.article-highlight--note-end`;
const NOTE_DIALOG = "#note-highlight-dialog";
const TAPPED_SENTENCE = "A single tap on this sentence selects it whole.";
const ARTICLE = [
	`<p>The reader holds the phone in one hand. ${TAPPED_SENTENCE} The phone's own menu stays beside the selection.</p>`,
	"<p>The second paragraph carries on below, so the article runs past the bottom of the screen and the capture shows the bar over the text it covers.</p>",
	"<p>The third paragraph adds another few lines of plain prose with nothing in it that changes from one run to the next.</p>",
	"<p>The fourth paragraph keeps the column filled, one short sentence after another, until the page is taller than the phone.</p>",
	"<p>The fifth paragraph is here for the same reason, and so is the sixth one that follows it.</p>",
	"<p>The sixth paragraph closes the article with a last line that sits well below the fold.</p>",
].join("");
const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	"[data-test-reader-related]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openTappedSentence(page: Page, stamp: string): Promise<void> {
	const email = `highlight-phone-visual-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/highlight-phone-visual-${stamp}`,
			title: "A Tapped Sentence",
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
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector(READY_SLOT);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: [],
	});
	await waitForBrandFonts(page, ["Inter"]);
	const point = await page.evaluate(pointInsideText, {
		root: CONTENT,
		exact: TAPPED_SENTENCE,
	});
	await page.touchscreen.tap(point.x, point.y);
	await expect.poll(() => page.evaluate(selectedText), { timeout: SETTLE_MS }).toBe(TAPPED_SENTENCE);
	await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, {
		timeout: SETTLE_MS,
	});
}

async function toolbarSettled(page: Page): Promise<void> {
	await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: [],
	});
	await waitForBrandFonts(page, ["Inter"]);
}

async function toolbarPastSystemMenu(page: Page): Promise<void> {
	const { gapBelowSelection } = await page.evaluate(toolbarNearSelection, {
		toolbar: TOOLBAR,
	});
	assert.ok(Math.abs(gapBelowSelection - 64) <= 1, "the bar sits the system menu's height below the tapped sentence");
	const content = await measuredBox(page, CONTENT);
	const toolbar = await measuredBox(page, TOOLBAR);
	assert.ok(toolbar.y + toolbar.height <= content.y + content.height, "the bar sits over the article text");
}

function checkpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: toolbarSettled,
		geometry: toolbarPastSystemMenu,
		target: "body",
		capture: "page-from-top",
		pinnedText: [],
	};
}

const TOOLBAR_PAST_MENU_LIGHT = checkpoint("highlight-phone-toolbar-light");
const TOOLBAR_PAST_MENU_DARK = checkpoint("highlight-phone-toolbar-dark");

async function noteTappedSentence(page: Page): Promise<void> {
	await page.locator('[data-test-action="add-note"]').tap();
	await page.locator("[data-test-highlight-note-input]").fill("Worth coming back to.");
	await page.locator('[data-test-action="highlight-note-save"]').tap();
	await expect(page.locator(NOTE_END)).toHaveText(TAPPED_SENTENCE, { timeout: SETTLE_MS });
}

async function notedSentenceSettled(page: Page): Promise<void> {
	await expect(page.locator(NOTE_END)).toHaveCount(1);
	await expect(page.locator(TOOLBAR)).toBeHidden();
	await expect(page.locator(`${NOTE_DIALOG}[open]`)).toHaveCount(0);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: [],
	});
	await waitForBrandFonts(page, ["Inter"]);
}

async function noteGlyphOnLastWordLine(page: Page): Promise<void> {
	const glyph = await page.evaluate(noteGlyphGeometry, { mark: NOTE_END });
	assert.ok(Math.abs(glyph.segmentTop - glyph.lastCharacterTop) <= 1, "the glyph sits on the last word's line");
	assert.ok(
		Math.abs(glyph.segmentRight - glyph.lastCharacterRight - 1.5 * glyph.fontSize) <= 1,
		"the glyph's box follows the last character by 1.5em",
	);
}

function notedCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: notedSentenceSettled,
		geometry: noteGlyphOnLastWordLine,
		target: CONTENT,
		capture: "element",
		pinnedText: [],
	};
}

const NOTED_SENTENCE_LIGHT = notedCheckpoint("highlight-phone-noted-light");
const NOTED_SENTENCE_DARK = notedCheckpoint("highlight-phone-noted-dark");

test.describe("The highlight bar on a phone", () => {
	test.use({
		...PIXEL_7,
		timezoneId: "UTC",
		userAgent: MACOS_CHROME_USER_AGENT,
	});

	test("sits past the system menu below the sentence (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openTappedSentence(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, TOOLBAR_PAST_MENU_LIGHT);
	});

	test("sits past the system menu below the sentence (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openTappedSentence(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, TOOLBAR_PAST_MENU_DARK);
	});

	test("shows a note glyph after a noted sentence (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openTappedSentence(page, `noted-light-${testInfo.workerIndex}-${Date.now()}`);
		await noteTappedSentence(page);
		await captureCheckpoint(page, NOTED_SENTENCE_LIGHT);
	});

	test("shows a note glyph after a noted sentence (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openTappedSentence(page, `noted-dark-${testInfo.workerIndex}-${Date.now()}`);
		await noteTappedSentence(page);
		await captureCheckpoint(page, NOTED_SENTENCE_DARK);
	});

	test("keeps the note glyph on its last word's line at every phone width", async ({ page }, testInfo) => {
		await openTappedSentence(page, `noted-sweep-${testInfo.workerIndex}-${Date.now()}`);
		await noteTappedSentence(page);
		const viewport = page.viewportSize();
		assert(viewport, "the phone project sets a viewport");
		for (let width = 320; width <= 420; width += 10) {
			await page.setViewportSize({ width, height: viewport.height });
			await noteGlyphOnLastWordLine(page);
		}
	});
});
