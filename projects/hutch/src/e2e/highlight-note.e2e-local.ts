import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { selectPassage } from "./highlight-a-passage.browser";
import { previewClearOfMarks } from "./highlight-on-a-phone.browser";
import { recordScrollAfterSwap } from "./readlist-scroll-stability.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const SETTLE_MS = 45000;

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const ADD_NOTE_BUTTON = '[data-test-action="add-note"]';
const NOTE_DIALOG = "#note-highlight-dialog";
const OPEN_NOTE_DIALOG = `${NOTE_DIALOG}:popover-open`;
const NOTE_INPUT = "[data-test-highlight-note-input]";
const MARK = `${CONTENT} mark.article-highlight`;
const RAIL_ROW = "[data-test-highlight-row]";
const RAIL_NOTE = "[data-test-highlight-note]";
const SCROLL_STAMP = "data-test-scroll-after-swap";

const FILLER =
	"<p>Every filler paragraph of this seeded article repeats one sentence about keeping a long read in view, so the passage worth a note sits well below the fold of the first screen.</p>";
const PASSAGE =
	"The passage worth a note says why the reader stopped on this sentence.";
const ARTICLE = [
	...Array.from({ length: 12 }, () => FILLER),
	`<p>${PASSAGE} It sits in a paragraph of its own.</p>`,
	...Array.from({ length: 6 }, () => FILLER),
].join("");

const FIRST_NOTE = "The first line of the note.\nThe second line of the note.";
const EDITED_NOTE = "The note, edited from the rail.";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openHighlightableReader(
	page: Page,
	stamp: string,
): Promise<void> {
	const email = `highlight-note-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(
		created.status(),
		201,
		"the e2e user fixture must answer the create request",
	);
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(
		`${BASE_URL}/e2e/seed-crawled-article`,
		{
			data: {
				url: `https://example.com/highlight-note-${stamp}`,
				title: "Keeping a Thought Beside the Passage",
				content: ARTICLE,
				contentFetchedAt: CONTENT_FETCHED_AT,
				savedByUserId: userId,
				generatedSummary: {
					summary: "A fixed summary.",
					excerpt: "A fixed excerpt.",
				},
			},
		},
	);
	assert.equal(
		seeded.status(),
		201,
		"the seed endpoint must create the crawled article",
	);
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

async function rowNoteDialog(page: Page, highlightId: string) {
	const row = page.locator(`[data-test-highlight-row="${highlightId}"]`);
	await row.locator('[data-test-action="highlight-note"]').click();
	const dialog = page.locator(
		`[id="note-highlight-${highlightId}"]:popover-open`,
	);
	await expect(dialog).toHaveCount(1, { timeout: SETTLE_MS });
	return dialog;
}

test.describe("Adding a note to a highlight", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("adds a two-line note from the bar without moving the page, then edits and clears it from the rail", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`flow-${testInfo.workerIndex}-${Date.now()}`,
		);

		await page
			.locator(CONTENT)
			.getByText(PASSAGE, { exact: false })
			.evaluate((paragraph) =>
				paragraph.scrollIntoView({ block: "center", behavior: "instant" }),
			);
		await page.evaluate(selectPassage, { root: CONTENT, exact: PASSAGE });
		await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
		await page.evaluate(recordScrollAfterSwap, NOTE_DIALOG);
		const before = await page.evaluate(() => window.scrollY);

		await page.locator(ADD_NOTE_BUTTON).click();
		const createDialog = page.locator(OPEN_NOTE_DIALOG);
		await expect(createDialog).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(createDialog.locator(NOTE_INPUT)).toBeFocused();
		await expect(page.locator(TOOLBAR)).toBeHidden();

		await createDialog.locator(NOTE_INPUT).fill(FIRST_NOTE);
		await createDialog
			.locator('[data-test-action="highlight-note-save"]')
			.click();

		await expect(page.locator(MARK).filter({ hasText: PASSAGE })).toHaveCount(
			1,
			{ timeout: SETTLE_MS },
		);
		const row = page.locator(RAIL_ROW);
		await expect(row).toHaveCount(1);
		await expect(row.locator(RAIL_NOTE)).toHaveJSProperty(
			"textContent",
			FIRST_NOTE,
		);
		await expect(page.locator("html")).toHaveAttribute(
			SCROLL_STAMP,
			String(before),
			{ timeout: SETTLE_MS },
		);
		await expect(page.locator(OPEN_NOTE_DIALOG)).toHaveCount(0);

		const highlightId = await row.getAttribute("data-test-highlight-row");
		assert(highlightId, "the rail row names its highlight");

		const editDialog = await rowNoteDialog(page, highlightId);
		const editInput = editDialog.locator(NOTE_INPUT);
		await expect(editInput).toBeFocused();
		await expect(editInput).toHaveValue(FIRST_NOTE);
		await editInput.fill(EDITED_NOTE);
		await editDialog
			.locator('[data-test-action="highlight-note-edit-save"]')
			.click();
		await expect(page.locator(RAIL_ROW).locator(RAIL_NOTE)).toHaveJSProperty(
			"textContent",
			EDITED_NOTE,
			{ timeout: SETTLE_MS },
		);

		const clearDialog = await rowNoteDialog(page, highlightId);
		await clearDialog.locator(NOTE_INPUT).fill("");
		await clearDialog
			.locator('[data-test-action="highlight-note-edit-save"]')
			.click();
		const clearedRow = page.locator(
			`[data-test-highlight-row="${highlightId}"]`,
		);
		await expect(clearedRow.locator(RAIL_NOTE)).toHaveCount(0, {
			timeout: SETTLE_MS,
		});
		await expect(clearedRow).toHaveCount(1);
		await expect(page.locator(MARK).filter({ hasText: PASSAGE })).toHaveCount(
			1,
		);
	});
});

const PREVIEW = "[data-test-highlight-preview]";
const SHOWN_PREVIEW = `${PREVIEW}:popover-open`;
const LONG_NOTE = Array.from({ length: 40 }, (_, line) => `Line ${line + 1} of a long note.`).join("\n");

async function addNotedHighlight(page: Page, note: string): Promise<string> {
	await page
		.locator(CONTENT)
		.getByText(PASSAGE, { exact: false })
		.evaluate((paragraph) => paragraph.scrollIntoView({ block: "center", behavior: "instant" }));
	await page.evaluate(selectPassage, { root: CONTENT, exact: PASSAGE });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator(ADD_NOTE_BUTTON).click();
	const dialog = page.locator(OPEN_NOTE_DIALOG);
	await expect(dialog).toHaveCount(1, { timeout: SETTLE_MS });
	await dialog.locator(NOTE_INPUT).fill(note);
	await dialog.locator('[data-test-action="highlight-note-save"]').click();
	await expect(page.locator(PREVIEW)).toHaveCount(1, { timeout: SETTLE_MS });
	await expect(page.locator(OPEN_NOTE_DIALOG)).toHaveCount(0);
	const highlightId = await page.locator(RAIL_ROW).getAttribute("data-test-highlight-row");
	assert(highlightId, "the rail row names its highlight");
	await page
		.locator(`#highlight-${highlightId}`)
		.evaluate((mark) => mark.scrollIntoView({ block: "center", behavior: "instant" }));
	return highlightId;
}

async function previewMissesPassage(page: Page, highlightId: string): Promise<boolean> {
	return page.evaluate(previewClearOfMarks, { preview: SHOWN_PREVIEW, marks: `mark[data-highlight-id="${highlightId}"]` });
}

test.describe("Reading a note beside its highlight", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("a hover shows the note clear of the passage, and leaving or Escape hides it", async ({ page }, testInfo) => {
		await openHighlightableReader(page, `hover-${testInfo.workerIndex}-${Date.now()}`);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);

		await mark.hover();
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(page.locator(SHOWN_PREVIEW)).toHaveJSProperty("textContent", FIRST_NOTE);
		expect(await previewMissesPassage(page, highlightId)).toBe(true);

		await page.locator(SHOWN_PREVIEW).hover();
		await page.mouse.move(5, 5);
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0, { timeout: SETTLE_MS });

		await mark.hover();
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(1, { timeout: SETTLE_MS });
		const focusedBefore = await page.evaluate(() => document.activeElement?.tagName);
		await page.keyboard.press("Escape");
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);
		expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(focusedBefore);
	});

	test("on a passage too tall to clear, the preview stays inside the viewport", async ({ page }, testInfo) => {
		await openHighlightableReader(page, `tall-${testInfo.workerIndex}-${Date.now()}`);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		await page.setViewportSize({ width: DESKTOP.width, height: 120 });
		await page
			.locator(`#highlight-${highlightId}`)
			.evaluate((mark) => mark.scrollIntoView({ block: "center", behavior: "instant" }));

		await page.locator(`#highlight-${highlightId}`).hover();

		await expect(page.locator(SHOWN_PREVIEW)).toBeInViewport({ ratio: 1, timeout: SETTLE_MS });
	});

	test("Tab reaches the highlight, shows its note with a ring, and Enter and Space pin it in place", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(page, `keys-${testInfo.workerIndex}-${Date.now()}`);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);
		await page.locator(CONTENT).evaluate((content) => {
			content.setAttribute("tabindex", "-1");
			content.focus();
		});

		for (let presses = 0; presses < 40; presses++) {
			if (await mark.evaluate((element) => element === document.activeElement)) break;
			await page.keyboard.press("Tab");
		}

		await expect(mark).toBeFocused();
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(mark).toHaveAttribute("aria-describedby", `preview-highlight-${highlightId}`);
		await expect(mark).toHaveCSS("outline-width", "2px");
		await expect(mark).toHaveCSS("outline-style", "solid");

		const before = await page.evaluate(() => window.scrollY);
		await page.keyboard.press("Enter");
		await expect(page.locator(`${SHOWN_PREVIEW}.highlight-preview--pinned`)).toHaveCount(1);
		await page.keyboard.press("Space");
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
	});

	test("a click pins the note without scrolling, and Space still pages down after it", async ({ page }, testInfo) => {
		await openHighlightableReader(page, `click-${testInfo.workerIndex}-${Date.now()}`);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const before = await page.evaluate(() => window.scrollY);

		await page.locator(`#highlight-${highlightId}`).click();

		await expect(page.locator(`${SHOWN_PREVIEW}.highlight-preview--pinned`)).toHaveCount(1, { timeout: SETTLE_MS });
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
		await page.mouse.move(5, 5);
		await page.keyboard.press("Space");
		await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: SETTLE_MS }).toBeGreaterThan(before);
	});

	test("a long note shows eight lines on hover and the whole note, scrolling, once pinned", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(page, `long-${testInfo.workerIndex}-${Date.now()}`);
		const highlightId = await addNotedHighlight(page, LONG_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);
		const note = page.locator(`${SHOWN_PREVIEW} .highlight-preview__note`);

		await mark.hover();
		await expect(note).toHaveCount(1, { timeout: SETTLE_MS });
		const clamped = await note.evaluate((element) => {
			const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
			return Math.round(element.clientHeight / lineHeight);
		});
		expect(clamped).toBe(8);

		await mark.click();
		const pinned = page.locator(`${SHOWN_PREVIEW}.highlight-preview--pinned`);
		await expect(pinned).toHaveCount(1);
		expect(await pinned.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
		await expect(note).toHaveJSProperty("textContent", LONG_NOTE);
	});

	test("a mouse Jump brings the mark into view and focus without its preview, and a note save leaves none open", async ({ page }, testInfo) => {
		await openHighlightableReader(page, `jump-${testInfo.workerIndex}-${Date.now()}`);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);

		await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
		await expect(mark).not.toBeInViewport();
		await page.locator('[data-test-action="highlight-jump"]').click();
		await expect(mark).toBeInViewport({ timeout: SETTLE_MS });
		await expect(mark).toBeFocused();
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);

		const editDialog = await rowNoteDialog(page, highlightId);
		await editDialog.locator(NOTE_INPUT).fill(EDITED_NOTE);
		await editDialog.locator('[data-test-action="highlight-note-edit-save"]').click();
		await expect(page.locator(PREVIEW)).toHaveJSProperty("textContent", EDITED_NOTE, { timeout: SETTLE_MS });
		await expect(page.locator("body")).toBeFocused();
		await page.mouse.move(5, 5);
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);
	});
});
