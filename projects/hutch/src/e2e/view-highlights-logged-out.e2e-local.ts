import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { devices, type Page } from "@playwright/test";
import { selectPassage } from "./highlight-a-passage.browser";
import { pointInsideText, selectedText } from "./highlight-on-a-phone.browser";
import { backdateFormLoad } from "./import-logged-out.browser";
import { clickAndWaitForPageReload } from "./page-interactions";
import { controlsMissedByAHit, scrollTextAboveCta, toolbarAgainstViewCta } from "./view-highlights-logged-out.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const SETTLE_MS = 45000;
const SYSTEM_MENU_CLEARANCE_PX = 64;
const ROOM_BELOW_PX = 400;
const NO_ROOM_BELOW_PX = 24;
const { defaultBrowserType: _defaultBrowserType, ...PIXEL_7 } = devices["Pixel 7"];

const CONTENT = ".article-body__content";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const SHOWN_TOOLBAR = `${TOOLBAR}:not([hidden])`;
const VIEW_CTA = "[data-test-view-cta]";
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const MARK = `${CONTENT} mark.article-highlight`;
const CARD_ROW = "[data-test-view-highlight-row]";
const KEEP_POPUP = "#view-highlights-keep";
const RAIL_ROW = "[data-test-highlight-row]";
const SAVE_CTA = `${VIEW_CTA} [data-test-view-cta-action][href^="/save"]`;
const CARD_TITLE = "[data-test-article-title]";
const ELSEWHERE_ROW = "[data-test-view-highlight-elsewhere-row]";
const ROW_NOTE = "[data-view-highlight-note]";
const NOTE_INPUT = "[data-test-highlight-note-input]";
const PANEL_NOTE = '[data-test-action="highlight-panel-note"]';
const PANEL_NOTE_DELETE = '[data-test-action="highlight-panel-note-delete"]';
const PANEL_DELETE = '[data-test-action="highlight-panel-delete"]';
const EDITOR_SAVE = '[data-test-action="highlight-note-edit-save"]';
const NOTE_DELETE = '[data-test-action="highlight-note-delete"]';
const CONFIRM_DELETE = '[data-test-action="highlight-delete-confirm"]';
const ROW_DELETE_TRIGGER = '[data-test-action="view-highlight-delete-confirm"]';
const ROW_DELETE_FALLBACK = '[data-test-action="view-highlight-delete"]';
const PANEL_CONTROLS = "button";
const EDITOR_CONTROLS = "textarea, .highlight-note-form__buttons button";
const DESKTOP = { width: 1280, height: 900 };
const PHONE_320 = { width: 320, height: 568 };

const KEPT_PASSAGES = [
	"deterministic, path-uniqued article",
	"hard-coded production page",
	"every request returns the same body",
	"Reusing a single shared article path",
	"The summariser short-circuits",
];
const ONE_TOO_MANY = "Mozilla's Readability extractor";
const TAPPED_SENTENCE = "One broken run was enough to brick the next dozen.";
const SENTENCE_BY_THE_CTA = "Treat it as machine-only.";

async function openReadableView(page: Page, articleUrl: string): Promise<void> {
	const viewUrl = `${BASE_URL}/view?url=${encodeURIComponent(articleUrl)}`;
	await page.goto(viewUrl, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(READY_SLOT, { timeout: SETTLE_MS });
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-view");
	await expect(page.locator(TOOLBAR)).toHaveCount(1);
}

async function highlight(page: Page, exact: string): Promise<void> {
	await page.locator(CONTENT).getByText(exact, { exact: false }).scrollIntoViewIfNeeded();
	await page.evaluate(selectPassage, { root: CONTENT, exact });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator(HIGHLIGHT_BUTTON).click();
}

async function keptHighlightId(page: Page, exact: string): Promise<string> {
	await highlight(page, exact);
	const mark = page.locator(MARK).filter({ hasText: exact });
	await expect(mark).toHaveCount(1);
	const highlightId = await mark.getAttribute("data-highlight-id");
	assert(highlightId, "a kept passage's mark names its highlight");
	return highlightId;
}

function markOf(page: Page, highlightId: string) {
	return page.locator(`#highlight-${highlightId}`);
}

function panelOf(page: Page, highlightId: string) {
	return page.locator(`#manage-highlight-${highlightId}:popover-open`);
}

function editorOf(page: Page, highlightId: string) {
	return page.locator(`[id="note-highlight-${highlightId}"]:popover-open`);
}

function confirmOf(page: Page, highlightId: string) {
	return page.locator(`[id="delete-highlight-${highlightId}"]:popover-open`);
}

function previewOf(page: Page, highlightId: string) {
	return page.locator(`[id="preview-highlight-${highlightId}"]`);
}

function rowOf(page: Page, exact: string) {
	return page.locator(CARD_ROW).filter({ hasText: exact });
}

async function openActions(page: Page, highlightId: string) {
	await markOf(page, highlightId).evaluate((mark) => mark.scrollIntoView({ block: "center", behavior: "instant" }));
	await markOf(page, highlightId).click();
	const panel = panelOf(page, highlightId);
	await expect(panel).toHaveCount(1, { timeout: SETTLE_MS });
	await expect(panel.locator(PANEL_NOTE)).toBeFocused();
	return panel;
}

async function openEditor(page: Page, highlightId: string) {
	const panel = await openActions(page, highlightId);
	await panel.locator(PANEL_NOTE).click();
	const editor = editorOf(page, highlightId);
	await expect(editor).toHaveCount(1);
	await expect(panel).toHaveCount(0);
	await expect(editor.locator(NOTE_INPUT)).toBeFocused();
	return editor;
}

async function writeNoteFromText(page: Page, input: { highlightId: string; note: string }) {
	const editor = await openEditor(page, input.highlightId);
	await editor.locator(NOTE_INPUT).fill(input.note);
	await editor.locator(EDITOR_SAVE).click();
	await expect(editor).toHaveCount(0);
	await expect(markOf(page, input.highlightId)).toBeFocused();
}

async function tabTo(page: Page, highlightId: string) {
	await page.locator(CONTENT).evaluate((content) => {
		content.setAttribute("tabindex", "-1");
		content.focus();
	});
	const mark = markOf(page, highlightId);
	for (let presses = 0; presses < 40; presses++) {
		if (await mark.evaluate((element) => element === document.activeElement)) break;
		await page.keyboard.press("Tab");
	}
	await expect(mark).toBeFocused();
}

async function signUp(page: Page, email: string): Promise<void> {
	await page.waitForSelector("body.page-signup");
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('input[name="loadedAt"]').evaluate(backdateFormLoad);
	await clickAndWaitForPageReload(page, page.locator('[data-test-action="signup"]'));
}

test("a logged-out visitor keeps five highlights in the browser, then carries them into a new account", async ({
	page,
}, testInfo) => {
	const stamp = `${testInfo.workerIndex}-${Date.now()}`;
	await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-${stamp}`);

	await highlight(page, KEPT_PASSAGES[0]);
	await expect(page.locator(MARK).filter({ hasText: KEPT_PASSAGES[0] })).toHaveCount(1);
	await expect(page.locator(CARD_ROW)).toHaveCount(1);

	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(page.locator(MARK).filter({ hasText: KEPT_PASSAGES[0] })).toHaveCount(1);
	await expect(page.locator(CARD_ROW)).toHaveCount(1);

	for (const passage of KEPT_PASSAGES.slice(1)) {
		await highlight(page, passage);
		await expect(page.locator(MARK).filter({ hasText: passage })).toHaveCount(1);
	}
	await expect(page.locator(CARD_ROW)).toHaveCount(KEPT_PASSAGES.length);

	await highlight(page, ONE_TOO_MANY);
	await expect(page.locator(`${KEEP_POPUP}:popover-open`)).toHaveCount(1);
	await expect(page.locator(`${KEEP_POPUP} .confirm-popover__body`)).toHaveText(
		"This browser keeps up to 5 highlights. Create a free account to keep them and add as many as you like.",
	);
	await expect(page.locator(`${KEEP_POPUP} [data-test-view-highlights-too-long]`)).toBeHidden();
	await expect(page.locator(MARK).filter({ hasText: ONE_TOO_MANY })).toHaveCount(0);

	await clickAndWaitForPageReload(
		page,
		page.locator(`${KEEP_POPUP} [data-test-action="view-highlights-signup"]`),
	);
	await signUp(page, `view-highlights-${stamp}@example.com`);

	await page.waitForSelector("body.page-reader", { timeout: SETTLE_MS });
	await expect(page.locator(RAIL_ROW)).toHaveCount(KEPT_PASSAGES.length);
	for (const passage of KEPT_PASSAGES) {
		await expect(page.locator(RAIL_ROW).filter({ hasText: passage })).toHaveCount(1);
	}
});

test("a logged-out visitor who highlights and then taps Save carries the highlight into the new account", async ({
	page,
}, testInfo) => {
	const stamp = `save-${testInfo.workerIndex}-${Date.now()}`;
	await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-${stamp}`);
	await highlight(page, KEPT_PASSAGES[0]);
	await expect(page.locator(CARD_ROW)).toHaveCount(1);

	await clickAndWaitForPageReload(page, page.locator(SAVE_CTA));
	await signUp(page, `view-highlights-${stamp}@example.com`);

	await page.waitForSelector("body.page-readlist", { timeout: SETTLE_MS });
	await page.locator(CARD_TITLE).first().click();
	await page.waitForSelector("body.page-reader", { timeout: SETTLE_MS });
	await expect(page.locator(RAIL_ROW).filter({ hasText: KEPT_PASSAGES[0] })).toHaveCount(1);
});

test.describe("Highlighting on /view on a phone", () => {
	test.use({ ...PIXEL_7, timezoneId: "UTC" });

	async function tapBarAt(input: { page: Page; stamp: string; sentence: string; gapAboveCta: number }) {
		const { page, sentence } = input;
		await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-phone-${input.stamp}`);
		await page.evaluate(scrollTextAboveCta, { root: CONTENT, exact: sentence, cta: VIEW_CTA, gap: input.gapAboveCta });
		const point = await page.evaluate(pointInsideText, { root: CONTENT, exact: sentence });
		await page.touchscreen.tap(point.x, point.y);
		await expect.poll(() => page.evaluate(selectedText), { timeout: SETTLE_MS }).toBe(sentence);
		await expect(page.locator(SHOWN_TOOLBAR)).toHaveCount(1, { timeout: SETTLE_MS });
		await expect
			.poll(() => page.evaluate(toolbarAgainstViewCta, { toolbar: TOOLBAR, cta: VIEW_CTA }), { timeout: SETTLE_MS })
			.toEqual({ gapFromSelection: expect.closeTo(SYSTEM_MENU_CLEARANCE_PX, 0), overlapsCta: false });
	}

	test("a tapped sentence with room below brings the Highlight bar 64 px under it, clear of the Save bar", async ({
		page,
	}, testInfo) => {
		await tapBarAt({
			page,
			stamp: `below-${testInfo.workerIndex}-${Date.now()}`,
			sentence: TAPPED_SENTENCE,
			gapAboveCta: ROOM_BELOW_PX,
		});
	});

	test("a tapped sentence just above the Save bar brings the Highlight bar 64 px over it, clear of the Save bar", async ({
		page,
	}, testInfo) => {
		await tapBarAt({
			page,
			stamp: `above-${testInfo.workerIndex}-${Date.now()}`,
			sentence: SENTENCE_BY_THE_CTA,
			gapAboveCta: NO_ROOM_BELOW_PX,
		});
	});
});

test.describe("Managing a kept highlight where it sits in the text on /view", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("a click opens the actions, and a note is added, shown on hover, edited and deleted from the text with focus back on the passage", async ({
		page,
	}, testInfo) => {
		await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-note-${testInfo.workerIndex}-${Date.now()}`);
		const highlightId = await keptHighlightId(page, KEPT_PASSAGES[1]);
		await expect(previewOf(page, highlightId)).toHaveCount(0);

		const panel = await openActions(page, highlightId);
		await expect(panel.locator(PANEL_NOTE_DELETE)).toHaveCount(0);
		await expect(panel.locator(PANEL_DELETE)).toHaveCount(1);
		await page.keyboard.press("Escape");
		await expect(panel).toHaveCount(0);

		const editor = await openEditor(page, highlightId);
		await page.keyboard.press("Escape");
		await expect(editor).toHaveCount(0);

		await writeNoteFromText(page, { highlightId, note: "Why this page is pinned." });
		await expect(rowOf(page, KEPT_PASSAGES[1]).locator(ROW_NOTE)).toHaveText("Why this page is pinned.");

		await page.mouse.move(5, 5);
		await markOf(page, highlightId).hover();
		await expect(page.locator(`[id="preview-highlight-${highlightId}"]:popover-open`)).toHaveText(
			"Why this page is pinned.",
			{ timeout: SETTLE_MS },
		);

		await writeNoteFromText(page, { highlightId, note: "Edited where it sits." });
		await expect(rowOf(page, KEPT_PASSAGES[1]).locator(ROW_NOTE)).toHaveText("Edited where it sits.");

		await (await openActions(page, highlightId)).locator(PANEL_NOTE_DELETE).click();
		await expect(rowOf(page, KEPT_PASSAGES[1]).locator(ROW_NOTE)).toBeHidden();
		await expect(previewOf(page, highlightId)).toHaveCount(0);
		await expect(markOf(page, highlightId)).toBeFocused();

		await writeNoteFromText(page, { highlightId, note: "A note deleted from its editor." });
		const reopened = await openEditor(page, highlightId);
		await expect(reopened.locator(NOTE_INPUT)).toHaveValue("A note deleted from its editor.");
		await reopened.locator(NOTE_DELETE).click();
		await expect(reopened).toHaveCount(0);
		await expect(rowOf(page, KEPT_PASSAGES[1]).locator(ROW_NOTE)).toBeHidden();
		await expect(markOf(page, highlightId)).toBeFocused();

		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(markOf(page, highlightId)).toHaveCount(1);
		await expect(previewOf(page, highlightId)).toHaveCount(0);
	});

	test("Delete highlight from the text asks first, then moves focus to the next passage, and to the page once none is left", async ({
		page,
	}, testInfo) => {
		await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-delete-${testInfo.workerIndex}-${Date.now()}`);
		const first = await keptHighlightId(page, KEPT_PASSAGES[0]);
		const second = await keptHighlightId(page, KEPT_PASSAGES[1]);

		await (await openActions(page, first)).locator(PANEL_DELETE).click();
		const confirm = confirmOf(page, first);
		await expect(confirm).toHaveCount(1);
		await expect(confirm.locator(CONFIRM_DELETE)).toBeFocused();
		await confirm.locator(CONFIRM_DELETE).click();

		await expect(markOf(page, first)).toHaveCount(0);
		await expect(confirm).toHaveCount(0);
		await expect(page.locator(CARD_ROW)).toHaveCount(1);
		await expect(markOf(page, second)).toBeFocused();

		await (await openActions(page, second)).locator(PANEL_DELETE).click();
		await expect(confirmOf(page, second).locator(CONFIRM_DELETE)).toBeFocused();
		await confirmOf(page, second).locator(CONFIRM_DELETE).click();

		await expect(page.locator(MARK)).toHaveCount(0);
		await expect(page.locator(CARD_ROW)).toHaveCount(0);
		await expect(page.locator("body")).toBeFocused();
	});

	test("Tab reaches a kept highlight, and Enter or Space opens its actions with focus on the first", async ({
		page,
	}, testInfo) => {
		await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-keys-${testInfo.workerIndex}-${Date.now()}`);
		const highlightId = await keptHighlightId(page, KEPT_PASSAGES[2]);
		await tabTo(page, highlightId);

		await page.keyboard.press("Enter");
		await expect(panelOf(page, highlightId)).toHaveCount(1);
		await expect(panelOf(page, highlightId).locator(PANEL_NOTE)).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(panelOf(page, highlightId)).toHaveCount(0);
		await expect(markOf(page, highlightId)).toBeFocused();

		await page.keyboard.press("Space");
		await expect(panelOf(page, highlightId)).toHaveCount(1);
		await expect(panelOf(page, highlightId).locator(PANEL_NOTE)).toBeFocused();
	});

	test("the list deletes a note, and deletes a highlight through the same confirm, on this article and on other articles", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-list-a-${stamp}`);
		await keptHighlightId(page, KEPT_PASSAGES[3]);

		await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-list-b-${stamp}`);
		const here = await keptHighlightId(page, KEPT_PASSAGES[4]);
		await writeNoteFromText(page, { highlightId: here, note: "Kept from the list." });
		const row = rowOf(page, KEPT_PASSAGES[4]);
		await expect(row.locator(ROW_NOTE)).toHaveText("Kept from the list.");

		await row.locator(NOTE_DELETE).click();
		await expect(row.locator(ROW_NOTE)).toBeHidden();
		await expect(row.locator(NOTE_DELETE)).toBeHidden();
		await expect(previewOf(page, here)).toHaveCount(0);

		await expect(row.locator(ROW_DELETE_FALLBACK)).toBeHidden();
		await row.locator(ROW_DELETE_TRIGGER).click();
		await expect(confirmOf(page, here).locator(CONFIRM_DELETE)).toBeFocused();
		await confirmOf(page, here).locator(CONFIRM_DELETE).click();
		await expect(page.locator(CARD_ROW)).toHaveCount(0);
		await expect(markOf(page, here)).toHaveCount(0);

		const elsewhere = page.locator(ELSEWHERE_ROW).filter({ hasText: KEPT_PASSAGES[3] });
		await expect(elsewhere).toHaveCount(1);
		await expect(elsewhere.locator(ROW_DELETE_FALLBACK)).toBeHidden();
		await elsewhere.locator(ROW_DELETE_TRIGGER).click();
		const elsewhereConfirm = page.locator(`[data-test-confirm-popover="highlight-delete"]:popover-open`);
		await expect(elsewhereConfirm.locator(CONFIRM_DELETE)).toBeFocused();
		await elsewhereConfirm.locator(CONFIRM_DELETE).click();
		await expect(page.locator(ELSEWHERE_ROW)).toHaveCount(0);
	});

	for (const [width, viewport] of [
		["desktop", DESKTOP],
		["320px", PHONE_320],
	] as const) {
		test(`every control of the actions and of the note editor takes its own click (${width})`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize(viewport);
			await openReadableView(page, `${BASE_URL}/e2e/article/view-highlights-hit-${width}-${testInfo.workerIndex}-${Date.now()}`);
			const highlightId = await keptHighlightId(page, KEPT_PASSAGES[1]);
			await writeNoteFromText(page, { highlightId, note: "A note so every action shows." });

			await openActions(page, highlightId);
			await expect(panelOf(page, highlightId).locator(PANEL_CONTROLS)).toHaveCount(3);
			expect(
				await page.evaluate(controlsMissedByAHit, {
					editor: `#manage-highlight-${highlightId}:popover-open`,
					controls: PANEL_CONTROLS,
				}),
			).toEqual([]);
			await page.keyboard.press("Escape");

			const editor = await openEditor(page, highlightId);
			await expect(editor.locator(NOTE_DELETE)).toHaveCount(1);
			expect(
				await page.evaluate(controlsMissedByAHit, {
					editor: `[id="note-highlight-${highlightId}"]:popover-open`,
					controls: EDITOR_CONTROLS,
				}),
			).toEqual([]);
		});
	}
});
