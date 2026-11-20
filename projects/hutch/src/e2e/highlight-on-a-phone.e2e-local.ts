import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { devices, type Page } from "@playwright/test";
import { z } from "zod";
import {
	pointInsideText,
	previewClearOfMarks,
	scrollWindowBy,
	scrollWindowToTop,
	selectAcrossParagraphs,
	selectedText,
	selectionIsCollapsed,
	toolbarNearSelection,
	windowScrollY,
} from "./highlight-on-a-phone.browser";
import { selectPassage } from "./highlight-a-passage.browser";
import { documentScrollHeight, measureNoteEditor } from "./note-editor-placement.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SETTLE_MS = 45000;
const SYSTEM_MENU_CLEARANCE_PX = 64;
const SCROLL_PX = 40;
const { defaultBrowserType: _defaultBrowserType, ...PIXEL_7 } = devices["Pixel 7"];

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const SHOWN_TOOLBAR = `${TOOLBAR}:not([hidden])`;
const HIDDEN_TOOLBAR = `${TOOLBAR}[hidden]`;
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const MARK = `${CONTENT} mark[data-highlight-id]`;
const RAIL_ROW = "[data-test-highlight-row]";
const ADD_NOTE_BUTTON = '[data-test-action="add-note"]';
const OPEN_NOTE_DIALOG = "#note-highlight-dialog:popover-open";
const NOTE_INPUT = "[data-test-highlight-note-input]";
const SHOWN_PANEL = "[data-highlight-popover]:popover-open";
const TAPPED_NOTE = "Why this sentence matters.";
const FRAGMENT = "later-notes";
const FRAGMENT_LINK = `${CONTENT} a[href="#${FRAGMENT}"]`;

const OPENING_SENTENCE = "A phone reader opens the article on the train.";
const TAPPED_SENTENCE = "One tap on this sentence should select all of it.";
const FIRST_OF_PAIR = "The first of two adjacent paragraphs starts a thought.";
const SECOND_OF_PAIR = "The second of the pair finishes the same thought.";
const FILLER_SENTENCE =
	"Every filler paragraph repeats one sentence so the highlights rail sits well below the first screen of the phone.";
const LONG_SENTENCE =
	"A long passage on a phone keeps going for far more lines than one screen can hold, so the note editor has to sit as a sheet at the bottom while the reader scrolls the rest of the passage into view above it. ";
const LONG_PASSAGE = `The long passage starts here. ${LONG_SENTENCE.repeat(9).trim()}`;
const ARTICLE = [
	`<p>${OPENING_SENTENCE} ${TAPPED_SENTENCE}</p>`,
	`<p>Before reading on, <a href="#${FRAGMENT}">jump to the later notes</a> and come back.</p>`,
	`<p>${FIRST_OF_PAIR}</p>`,
	`<p>${SECOND_OF_PAIR}</p>`,
	...Array.from({ length: 14 }, () => `<p>${FILLER_SENTENCE}</p>`),
	`<p id="${FRAGMENT}">The later notes close the article.</p>`,
	`<p>${LONG_PASSAGE}</p>`,
].join("");

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openHighlightableReader(page: Page, stamp: string): Promise<void> {
	const email = `highlight-on-a-phone-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/highlight-on-a-phone-${stamp}`,
			title: "Highlighting With One Tap",
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
}

async function tapText(page: Page, exact: string): Promise<void> {
	const point = await page.evaluate(pointInsideText, { root: CONTENT, exact });
	await page.touchscreen.tap(point.x, point.y);
}

async function gapBelowSelection(page: Page): Promise<number> {
	const { gapBelowSelection } = await page.evaluate(toolbarNearSelection, {
		toolbar: TOOLBAR,
	});
	return gapBelowSelection;
}

test.describe("Highlighting a passage on a phone", () => {
	test.use({ ...PIXEL_7, timezoneId: "UTC" });

	test("a tap selects the sentence, the bar stays just past the system menu below the selection through a scroll, and Highlight marks it", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(page, `tap-${testInfo.workerIndex}-${Date.now()}`);

		await tapText(page, TAPPED_SENTENCE);
		await expect.poll(() => page.evaluate(selectedText), { timeout: SETTLE_MS }).toBe(TAPPED_SENTENCE);
		await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});
		await expect.poll(() => gapBelowSelection(page), { timeout: SETTLE_MS }).toBeCloseTo(SYSTEM_MENU_CLEARANCE_PX, 0);

		await page.evaluate(scrollWindowBy, { y: SCROLL_PX });
		await expect.poll(() => page.evaluate(windowScrollY)).toBe(SCROLL_PX);
		await expect.poll(() => gapBelowSelection(page), { timeout: SETTLE_MS }).toBeCloseTo(SYSTEM_MENU_CLEARANCE_PX, 0);

		await page.locator(HIGHLIGHT_BUTTON).tap();
		await expect(page.locator(MARK)).toHaveText(TAPPED_SENTENCE, {
			timeout: SETTLE_MS,
		});
		await expect(page.locator(RAIL_ROW)).toHaveCount(1);
		await expect(page.locator(RAIL_ROW)).toHaveAttribute("data-test-highlight-state", "anchored");
	});

	test("a link tap follows the link, a drawn selection shows the bar, a mark tap opens its actions inside the gutters without moving the page, and a tap elsewhere hides the bar", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(page, `taps-${testInfo.workerIndex}-${Date.now()}`);

		await page.locator(FRAGMENT_LINK).tap();
		await expect.poll(() => new URL(page.url()).hash, { timeout: SETTLE_MS }).toBe(`#${FRAGMENT}`);
		expect(await page.evaluate(selectionIsCollapsed)).toBe(true);

		await page.evaluate(scrollWindowToTop);
		await expect.poll(() => page.evaluate(windowScrollY)).toBe(0);
		await page.evaluate(selectAcrossParagraphs, {
			root: CONTENT,
			first: FIRST_OF_PAIR,
			second: SECOND_OF_PAIR,
		});
		await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});
		expect(await page.evaluate(selectedText)).toContain(SECOND_OF_PAIR);

		await tapText(page, OPENING_SENTENCE);
		await expect(page.locator(HIDDEN_TOOLBAR)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});

		await tapText(page, TAPPED_SENTENCE);
		await expect.poll(() => page.evaluate(selectedText), { timeout: SETTLE_MS }).toBe(TAPPED_SENTENCE);
		await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});
		await page.locator(HIGHLIGHT_BUTTON).tap();
		await expect(page.locator(MARK)).toHaveText(TAPPED_SENTENCE, {
			timeout: SETTLE_MS,
		});

		await page.evaluate(scrollWindowToTop);
		await expect.poll(() => page.evaluate(windowScrollY)).toBe(0);
		await expect(page.locator(RAIL_ROW)).not.toBeInViewport();
		const opened = page.waitForRequest((request) => {
			const url = new URL(request.url());
			return url.pathname.endsWith("/highlights/opened") && url.searchParams.get("origin") === "mark";
		});
		await tapText(page, TAPPED_SENTENCE);
		await opened;
		expect(await page.evaluate(windowScrollY)).toBe(0);
		await expect(page.locator(RAIL_ROW)).not.toBeInViewport();
		await expect(page.locator(HIDDEN_TOOLBAR)).toHaveCount(1);
		const panel = page.locator(SHOWN_PANEL);
		await expect(panel).toHaveCount(1, { timeout: SETTLE_MS });
		const box = await panel.boundingBox();
		assert(box, "the open panel has a box");
		const viewportWidth = await page.evaluate(() => window.innerWidth);
		expect(box.x).toBeGreaterThanOrEqual(16);
		expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		const rowHeights = await panel.locator(".menu__item").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
		expect(rowHeights.length).toBeGreaterThan(0);
		for (const height of rowHeights) expect(height).toBeGreaterThanOrEqual(44);
	});

	test("a tap on a noted highlight shows its note and actions in place, and a tap elsewhere only dismisses them", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(page, `note-${testInfo.workerIndex}-${Date.now()}`);
		await tapText(page, TAPPED_SENTENCE);
		await expect.poll(() => page.evaluate(selectedText), { timeout: SETTLE_MS }).toBe(TAPPED_SENTENCE);
		await page.locator(ADD_NOTE_BUTTON).tap();
		const dialog = page.locator(OPEN_NOTE_DIALOG);
		await expect(dialog).toHaveCount(1, { timeout: SETTLE_MS });
		expect((await page.evaluate(measureNoteEditor, { panel: OPEN_NOTE_DIALOG, passage: null })).miss).toBe(true);
		await dialog.locator(NOTE_INPUT).fill(TAPPED_NOTE);
		await dialog.locator('[data-test-action="highlight-note-save"]').tap();
		await expect(page.locator(MARK)).toHaveText(TAPPED_SENTENCE, { timeout: SETTLE_MS });
		const highlightId = await page.locator(MARK).getAttribute("data-highlight-id");
		assert(highlightId, "the mark names its highlight");

		await page.evaluate(scrollWindowToTop);
		await expect.poll(() => page.evaluate(windowScrollY)).toBe(0);
		await tapText(page, TAPPED_SENTENCE);

		await expect(page.locator(`${SHOWN_PANEL} .highlight-popover__note`)).toHaveJSProperty("textContent", TAPPED_NOTE, {
			timeout: SETTLE_MS,
		});
		expect(await page.evaluate(windowScrollY)).toBe(0);
		await expect(page.locator(RAIL_ROW)).not.toBeInViewport();
		expect(
			await page.evaluate(previewClearOfMarks, {
				preview: SHOWN_PANEL,
				marks: `mark[data-highlight-id="${highlightId}"]`,
			}),
		).toBe(true);

		await tapText(page, FIRST_OF_PAIR);
		await expect(page.locator(SHOWN_PANEL)).toHaveCount(0, { timeout: SETTLE_MS });
		expect(await page.evaluate(selectionIsCollapsed)).toBe(true);
	});

	test("on a 400px-tall screen the editor stays on screen, clear of the passage and its first line", async ({ page }, testInfo) => {
		await openHighlightableReader(page, `short-${testInfo.workerIndex}-${Date.now()}`);
		await page.setViewportSize({ width: PIXEL_7.viewport.width, height: 400 });
		await page.locator(CONTENT).getByText(TAPPED_SENTENCE).evaluate((paragraph) => {
			paragraph.scrollIntoView({ block: "start", behavior: "instant" });
		});
		await page.evaluate(selectPassage, { root: CONTENT, exact: TAPPED_SENTENCE });
		await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, { timeout: SETTLE_MS });
		await page.locator(ADD_NOTE_BUTTON).tap();
		await expect(page.locator(OPEN_NOTE_DIALOG)).toHaveCount(1, { timeout: SETTLE_MS });

		const measured = await page.evaluate(measureNoteEditor, { panel: OPEN_NOTE_DIALOG, passage: null });
		expect(measured.panel.top).toBeGreaterThanOrEqual(measured.visibleTop);
		expect(measured.panel.bottom).toBeLessThanOrEqual(measured.visibleBottom);
		expect(measured.firstLine.top).toBeGreaterThanOrEqual(measured.visibleTop);
		expect(measured.firstLine.bottom).toBeLessThanOrEqual(measured.visibleBottom);
		expect(measured.miss).toBe(true);
	});

	test("a passage taller than the screen shows its first line above the sheet, and the page grows so its last line can scroll above it", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(page, `long-${testInfo.workerIndex}-${Date.now()}`);
		await page.locator(CONTENT).getByText(LONG_PASSAGE).evaluate((paragraph) => {
			paragraph.scrollIntoView({ block: "start", behavior: "instant" });
		});
		const heightBefore = await page.evaluate(documentScrollHeight);
		await page.evaluate(selectPassage, { root: CONTENT, exact: LONG_PASSAGE });
		await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, { timeout: SETTLE_MS });
		await page.locator(ADD_NOTE_BUTTON).tap();
		await expect(page.locator(OPEN_NOTE_DIALOG)).toHaveCount(1, { timeout: SETTLE_MS });

		const opened = await page.evaluate(measureNoteEditor, { panel: OPEN_NOTE_DIALOG, passage: null });
		expect(opened.passage.bottom - opened.passage.top).toBeGreaterThan(opened.visibleBottom - opened.visibleTop);
		expect(Math.abs(opened.panel.bottom - (opened.visibleBottom - 16))).toBeLessThanOrEqual(1);
		expect(opened.firstLine.top).toBeGreaterThanOrEqual(opened.visibleTop);
		expect(opened.firstLine.bottom).toBeLessThanOrEqual(opened.panel.top);
		const sheetHeight = opened.panel.bottom - opened.panel.top;
		expect(Math.abs((await page.evaluate(documentScrollHeight)) - heightBefore - (sheetHeight + 16))).toBeLessThanOrEqual(2);

		await page.evaluate(scrollWindowBy, { y: opened.lastLine.bottom - opened.panel.top + 8 });
		await expect
			.poll(async () => {
				const scrolled = await page.evaluate(measureNoteEditor, { panel: OPEN_NOTE_DIALOG, passage: null });
				return scrolled.lastLine.bottom <= scrolled.panel.top;
			})
			.toBe(true);
	});
});
