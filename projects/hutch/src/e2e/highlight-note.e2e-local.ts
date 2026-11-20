import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { selectPassage } from "./highlight-a-passage.browser";
import {
	previewClearOfMarks,
	selectAcrossParagraphs,
} from "./highlight-on-a-phone.browser";
import {
	backdropOf,
	centreBetweenParagraphs,
	draftTintRegistered,
	dragClearOfEditor,
	measureNoteEditor,
	type NoteEditorMeasure,
} from "./note-editor-placement.browser";
import { pageOverflowsSideways } from "./page-measurements.browser";
import { recordScrollAfterSwap } from "./readlist-scroll-stability.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const PIXEL_7_VIEWPORT = { width: 412, height: 915 };
const PHONE_320 = { width: 320, height: 568 };
const SETTLE_MS = 45000;

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const ADD_NOTE_BUTTON = '[data-test-action="add-note"]';
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const DELETE_NOTE = '[data-test-action="highlight-note-delete"]';
const NOTE_DIALOG = "#note-highlight-dialog";
const OPEN_NOTE_DIALOG = `${NOTE_DIALOG}:popover-open`;
const NOTE_INPUT = "[data-test-highlight-note-input]";
const MARK = `${CONTENT} mark.article-highlight`;
const RAIL_ROW = "[data-test-highlight-row]";
const RAIL_NOTE = "[data-test-highlight-note]";
const SCROLL_STAMP = "data-test-scroll-after-swap";
const HTMX_IN_MOTION = ".htmx-request, .htmx-swapping, .htmx-settling";

const FILLER =
	"<p>Every filler paragraph of this seeded article repeats one sentence about keeping a long read in view, so the passage worth a note sits well below the fold of the first screen.</p>";
const PASSAGE =
	"The passage worth a note says why the reader stopped on this sentence.";
const BARE_PASSAGE =
	"A second passage is highlighted and keeps no note at all.";
const TALL_SENTENCE =
	"A tall passage runs on for several lines so that a note editor can fit neither above it nor below it on one screen, and the reader still sees every word of it while writing. ";
const TALL_ONE = `The first tall paragraph begins here. ${TALL_SENTENCE.repeat(7).trim()}`;
const TALL_TWO = `The second tall paragraph begins here. ${TALL_SENTENCE.repeat(7).trim()}`;
const ARTICLE = [
	...Array.from({ length: 12 }, () => FILLER),
	`<p>${PASSAGE} It sits in a paragraph of its own.</p>`,
	`<p>${BARE_PASSAGE}</p>`,
	...Array.from({ length: 6 }, () => FILLER),
	`<p>${TALL_ONE}</p>`,
	`<p>${TALL_TWO}</p>`,
	...Array.from({ length: 6 }, () => FILLER),
].join("");

const FIRST_NOTE = "The first line of the note.\nThe second line of the note.";
const EDITED_NOTE = "The note, edited from the rail.";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openHighlightableReader(
	page: Page,
	stamp: string,
	account: { verified: boolean } = { verified: true },
): Promise<{ userId: string; articleId: string }> {
	const email = `highlight-note-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: account.verified },
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
	return { userId, articleId };
}

const COLUMN = ".article-body__content";
const DRAFT = null;
const CLEAR_BACKDROP = {
	background: "rgba(0, 0, 0, 0)",
	filter: "none",
	contentOpacity: "1",
};

async function editorMeasure(
	page: Page,
	panel: string,
	passage: string[] | null,
): Promise<NoteEditorMeasure> {
	return page.evaluate(measureNoteEditor, { panel, passage });
}

async function openCreateEditor(page: Page, exact: string) {
	await page
		.locator(CONTENT)
		.getByText(exact, { exact: false })
		.evaluate((paragraph) =>
			paragraph.scrollIntoView({ block: "center", behavior: "instant" }),
		);
	await page.evaluate(selectPassage, { root: CONTENT, exact });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator(ADD_NOTE_BUTTON).click();
	const dialog = page.locator(OPEN_NOTE_DIALOG);
	await expect(dialog).toHaveCount(1, { timeout: SETTLE_MS });
	await expect(dialog.locator(NOTE_INPUT)).toBeFocused();
	return dialog;
}

async function nextFrames(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
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

	test("adds a two-line note from the bar without moving the page, then edits it and deletes it from the rail", async ({
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
		expect((await editorMeasure(page, OPEN_NOTE_DIALOG, DRAFT)).miss).toBe(
			true,
		);
		expect(
			await page.evaluate(backdropOf, {
				panel: OPEN_NOTE_DIALOG,
				content: COLUMN,
			}),
		).toEqual(CLEAR_BACKDROP);
		expect(await page.evaluate(draftTintRegistered)).toBe(true);

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
		await expect.poll(() => page.evaluate(draftTintRegistered)).toBe(false);

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
		await expect(page.locator(HTMX_IN_MOTION)).toHaveCount(0, {
			timeout: SETTLE_MS,
		});

		await page.evaluate(
			(stamp) => document.documentElement.removeAttribute(stamp),
			SCROLL_STAMP,
		);
		const deleteNote = `[data-test-highlight-row="${highlightId}"] ${DELETE_NOTE}`;
		await page.evaluate(recordScrollAfterSwap, deleteNote);
		const beforeDelete = await page.locator(deleteNote).evaluate((button) => {
			button.scrollIntoView({ block: "nearest", behavior: "instant" });
			return window.scrollY;
		});
		await page.locator(deleteNote).click();
		const clearedRow = page.locator(
			`[data-test-highlight-row="${highlightId}"]`,
		);
		await expect(clearedRow.locator(RAIL_NOTE)).toHaveCount(0, {
			timeout: SETTLE_MS,
		});
		await expect(clearedRow).toHaveCount(1);
		await expect(clearedRow.locator(DELETE_NOTE)).toHaveCount(0);
		await expect(page.locator(MARK).filter({ hasText: PASSAGE })).toHaveCount(
			1,
		);
		await expect(page.locator("html")).toHaveAttribute(
			SCROLL_STAMP,
			String(beforeDelete),
			{ timeout: SETTLE_MS },
		);
	});

	test("deletes a note from inside its Edit note dialog, closing the dialog and keeping the highlight", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`dialog-delete-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await highlightWithNote(page, FIRST_NOTE);

		const dialog = await rowNoteDialog(page, highlightId);
		const dialogDelete = `[id="note-highlight-${highlightId}"] ${DELETE_NOTE}`;
		await page.evaluate(recordScrollAfterSwap, dialogDelete);
		const beforeDelete = await page.evaluate(() => window.scrollY);
		await dialog.locator(DELETE_NOTE).click();

		const row = page.locator(`[data-test-highlight-row="${highlightId}"]`);
		await expect(row.locator(RAIL_NOTE)).toHaveCount(0, {
			timeout: SETTLE_MS,
		});
		await expect(row).toHaveCount(1);
		await expect(page.locator("[popover]:popover-open")).toHaveCount(0);
		await expect(page.locator(MARK).filter({ hasText: PASSAGE })).toHaveCount(
			1,
		);
		await expect(page.locator("html")).toHaveAttribute(
			SCROLL_STAMP,
			String(beforeDelete),
			{ timeout: SETTLE_MS },
		);
	});

	test("keeps every rail button inside its row, with or without a note, at desktop, Pixel 7 and 320px widths", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`width-${testInfo.workerIndex}-${Date.now()}`,
		);
		const notedId = await highlightWithNote(page, FIRST_NOTE);
		await page
			.locator(CONTENT)
			.getByText(BARE_PASSAGE, { exact: false })
			.evaluate((paragraph) =>
				paragraph.scrollIntoView({ block: "center", behavior: "instant" }),
			);
		await page.evaluate(selectPassage, { root: CONTENT, exact: BARE_PASSAGE });
		await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
		await page.locator(HIGHLIGHT_BUTTON).click();
		await expect(page.locator(RAIL_ROW)).toHaveCount(2, { timeout: SETTLE_MS });
		await expect(
			page.locator(`[data-test-highlight-row="${notedId}"] ${DELETE_NOTE}`),
		).toHaveCount(1);

		for (const viewport of [DESKTOP, PIXEL_7_VIEWPORT, PHONE_320]) {
			await page.setViewportSize(viewport);
			expect(
				await page.evaluate(pageOverflowsSideways),
				`no sideways overflow at ${viewport.width}px`,
			).toBe(false);
			const escapes = await page.evaluate((rowSelector) => {
				const found: string[] = [];
				for (const row of document.querySelectorAll(rowSelector)) {
					const box = row.getBoundingClientRect();
					for (const button of row.querySelectorAll(
						".highlights-rail__actions [data-test-action]",
					)) {
						const rect = button.getBoundingClientRect();
						if (rect.width === 0 || rect.height === 0) continue;
						if (
							rect.left < box.left - 0.5 ||
							rect.right > box.right + 0.5 ||
							rect.top < box.top - 0.5 ||
							rect.bottom > box.bottom + 0.5
						) {
							found.push(button.getAttribute("data-test-action") ?? "");
						}
					}
				}
				return found;
			}, RAIL_ROW);
			expect(
				escapes,
				`rail buttons outside their row at ${viewport.width}px`,
			).toEqual([]);
		}
	});
});

async function highlightWithNote(page: Page, note: string): Promise<string> {
	await page
		.locator(CONTENT)
		.getByText(PASSAGE, { exact: false })
		.evaluate((paragraph) =>
			paragraph.scrollIntoView({ block: "center", behavior: "instant" }),
		);
	await page.evaluate(selectPassage, { root: CONTENT, exact: PASSAGE });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator(ADD_NOTE_BUTTON).click();
	const dialog = page.locator(OPEN_NOTE_DIALOG);
	await expect(dialog).toHaveCount(1, { timeout: SETTLE_MS });
	await dialog.locator(NOTE_INPUT).fill(note);
	await dialog.locator('[data-test-action="highlight-note-save"]').click();
	const row = page.locator(RAIL_ROW).filter({ has: page.locator(RAIL_NOTE) });
	await expect(row).toHaveCount(1, { timeout: SETTLE_MS });
	const highlightId = await row.getAttribute("data-test-highlight-row");
	assert(highlightId, "the rail row names its highlight");
	return highlightId;
}

const PREVIEW = "[data-test-highlight-preview]";
const SHOWN_PREVIEW = `${PREVIEW}:popover-open`;
const LONG_NOTE = Array.from(
	{ length: 40 },
	(_, line) => `Line ${line + 1} of a long note.`,
).join("\n");

async function addNotedHighlight(page: Page, note: string): Promise<string> {
	await page
		.locator(CONTENT)
		.getByText(PASSAGE, { exact: false })
		.evaluate((paragraph) =>
			paragraph.scrollIntoView({ block: "center", behavior: "instant" }),
		);
	await page.evaluate(selectPassage, { root: CONTENT, exact: PASSAGE });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator(ADD_NOTE_BUTTON).click();
	const dialog = page.locator(OPEN_NOTE_DIALOG);
	await expect(dialog).toHaveCount(1, { timeout: SETTLE_MS });
	await dialog.locator(NOTE_INPUT).fill(note);
	await dialog.locator('[data-test-action="highlight-note-save"]').click();
	await expect(page.locator(PREVIEW)).toHaveCount(1, { timeout: SETTLE_MS });
	await expect(page.locator(OPEN_NOTE_DIALOG)).toHaveCount(0);
	const highlightId = await page
		.locator(RAIL_ROW)
		.getAttribute("data-test-highlight-row");
	assert(highlightId, "the rail row names its highlight");
	await page
		.locator(`#highlight-${highlightId}`)
		.evaluate((mark) =>
			mark.scrollIntoView({ block: "center", behavior: "instant" }),
		);
	return highlightId;
}

async function previewMissesPassage(
	page: Page,
	highlightId: string,
): Promise<boolean> {
	return page.evaluate(previewClearOfMarks, {
		preview: SHOWN_PREVIEW,
		marks: `mark[data-highlight-id="${highlightId}"]`,
	});
}

test.describe("Reading a note beside its highlight", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("a hover shows the note clear of the passage, and leaving or Escape hides it", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`hover-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);

		await mark.hover();
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});
		await expect(page.locator(SHOWN_PREVIEW)).toHaveJSProperty(
			"textContent",
			FIRST_NOTE,
		);
		expect(await previewMissesPassage(page, highlightId)).toBe(true);

		await page.locator(SHOWN_PREVIEW).hover();
		await page.mouse.move(5, 5);
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0, {
			timeout: SETTLE_MS,
		});

		await mark.hover();
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});
		const focusedBefore = await page.evaluate(
			() => document.activeElement?.tagName,
		);
		await page.keyboard.press("Escape");
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);
		expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
			focusedBefore,
		);
	});

	test("on a passage too tall to clear, the preview stays inside the viewport", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`tall-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		await page.setViewportSize({ width: DESKTOP.width, height: 120 });
		await page
			.locator(`#highlight-${highlightId}`)
			.evaluate((mark) =>
				mark.scrollIntoView({ block: "center", behavior: "instant" }),
			);

		await page.locator(`#highlight-${highlightId}`).hover();

		await expect(page.locator(SHOWN_PREVIEW)).toBeInViewport({
			ratio: 1,
			timeout: SETTLE_MS,
		});
	});

	test("Tab reaches the highlight, shows its note with a ring, and Enter and Space open its actions in place", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`keys-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);
		const panel = page.locator(`#manage-highlight-${highlightId}:popover-open`);
		await page.locator(CONTENT).evaluate((content) => {
			content.setAttribute("tabindex", "-1");
			content.focus();
		});

		for (let presses = 0; presses < 40; presses++) {
			if (await mark.evaluate((element) => element === document.activeElement))
				break;
			await page.keyboard.press("Tab");
		}

		await expect(mark).toBeFocused();
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});
		await expect(mark).toHaveAttribute(
			"aria-describedby",
			`preview-highlight-${highlightId} manage-highlight-hint`,
		);
		await expect(mark).toHaveCSS("outline-width", "2px");
		await expect(mark).toHaveCSS("outline-style", "solid");

		const before = await page.evaluate(() => window.scrollY);
		await page.keyboard.press("Enter");
		await expect(panel).toHaveCount(1);
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);
		await expect(
			panel.locator('[data-test-action="highlight-panel-note"]'),
		).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(panel).toHaveCount(0);
		await expect(mark).toBeFocused();
		await page.keyboard.press("Space");
		await expect(panel).toHaveCount(1);
		await expect(
			page.locator(`[id="note-highlight-${highlightId}"]:popover-open`),
		).toHaveCount(0);
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
	});

	test("a click opens the highlight's actions without scrolling, and Space pages down once a click outside closes them", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`click-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const before = await page.evaluate(() => window.scrollY);
		const panel = page.locator(`#manage-highlight-${highlightId}:popover-open`);

		await page.locator(`#highlight-${highlightId}`).click();

		await expect(panel).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
		await page.locator(CONTENT).getByText(BARE_PASSAGE).click();
		await expect(panel).toHaveCount(0);
		await page.mouse.move(5, 5);
		await page.keyboard.press("Space");
		await expect
			.poll(() => page.evaluate(() => window.scrollY), { timeout: SETTLE_MS })
			.toBeGreaterThan(before);
	});

	test("a long note shows eight lines on hover and the whole note, scrolling above the actions, once clicked", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`long-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, LONG_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);
		const note = page.locator(`${SHOWN_PREVIEW} .highlight-preview__note`);

		await mark.hover();
		await expect(note).toHaveCount(1, { timeout: SETTLE_MS });
		const clamped = await note.evaluate((element) => {
			const lineHeight = Number.parseFloat(
				getComputedStyle(element).lineHeight,
			);
			return Math.round(element.clientHeight / lineHeight);
		});
		expect(clamped).toBe(8);

		await mark.click();
		const panel = page.locator(`#manage-highlight-${highlightId}:popover-open`);
		const panelNote = panel.locator(".highlight-popover__note");
		await expect(panel).toHaveCount(1);
		await expect(panelNote).toHaveJSProperty("textContent", LONG_NOTE);
		expect(
			await panelNote.evaluate(
				(element) => element.scrollHeight > element.clientHeight,
			),
		).toBe(true);
		await expect(
			panel.locator('[data-test-action="highlight-panel-delete"]'),
		).toBeInViewport({ ratio: 1 });
	});

	test("a mouse Jump brings the mark into view and focus without its preview, and a note save leaves none open", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`jump-${testInfo.workerIndex}-${Date.now()}`,
		);
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
		await editDialog
			.locator('[data-test-action="highlight-note-edit-save"]')
			.click();
		await expect(page.locator(PREVIEW)).toHaveJSProperty(
			"textContent",
			EDITED_NOTE,
			{ timeout: SETTLE_MS },
		);
		await expect(page.locator("body")).toBeFocused();
		await page.mouse.move(5, 5);
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);
	});

	test("a read-only account sees the note in the in-app reader, with no write action and no beacon", async ({
		page,
	}, testInfo) => {
		const { userId, articleId } = await openHighlightableReader(
			page,
			`read-only-${testInfo.workerIndex}-${Date.now()}`,
			{
				verified: false,
			},
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const locked = await page.request.post(`${BASE_URL}/e2e/lock-account`, {
			data: { userId },
		});
		assert.equal(
			locked.status(),
			204,
			"the lock seam must lock the unverified account",
		);
		const opened: string[] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname.endsWith("/highlights/opened"))
				opened.push(request.url());
		});

		await page.goto(
			`${BASE_URL}/queue/${articleId}/view?platform=ios&shell=app`,
			{ waitUntil: "domcontentloaded" },
		);
		await page.waitForSelector(READY_SLOT);
		await expect(page.locator(TOOLBAR)).toHaveCount(0);
		const mark = page.locator(`#highlight-${highlightId}`);
		await expect(mark).toHaveAttribute("tabindex", "0", { timeout: SETTLE_MS });
		await mark.evaluate((element) =>
			element.scrollIntoView({ block: "center", behavior: "instant" }),
		);
		await mark.click();

		await expect(
			page.locator(`${SHOWN_PREVIEW}.highlight-preview--pinned`),
		).toHaveJSProperty("textContent", FIRST_NOTE, {
			timeout: SETTLE_MS,
		});
		expect(opened).toEqual([]);
	});
});

test.describe("Managing a highlight where it sits in the text", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	function panelOf(page: Page, highlightId: string) {
		return page.locator(`#manage-highlight-${highlightId}:popover-open`);
	}

	function editorOf(page: Page, highlightId: string) {
		return page.locator(`[id="note-highlight-${highlightId}"]:popover-open`);
	}

	test("a click opens the actions beside the passage, and Edit note saves in place with focus back on the highlight", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`manage-edit-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);
		const before = await page.evaluate(() => window.scrollY);

		await mark.click();
		const panel = panelOf(page, highlightId);
		await expect(panel).toHaveCount(1, { timeout: SETTLE_MS });
		expect(
			await page.evaluate(previewClearOfMarks, {
				preview: `#manage-highlight-${highlightId}:popover-open`,
				marks: `mark[data-highlight-id="${highlightId}"]`,
			}),
		).toBe(true);
		await expect(
			panel.locator('[data-test-action="highlight-panel-note"]'),
		).toBeFocused();

		await panel.locator('[data-test-action="highlight-panel-note"]').click();
		const editor = editorOf(page, highlightId);
		await expect(editor).toHaveCount(1);
		await expect(panel).toHaveCount(0);
		await expect(editor.locator(NOTE_INPUT)).toBeFocused();
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);
		await editor.locator(NOTE_INPUT).fill(EDITED_NOTE);
		await editor
			.locator('[data-test-action="highlight-note-edit-save"]')
			.click();

		await expect(
			page.locator(`[data-test-highlight-row="${highlightId}"] ${RAIL_NOTE}`),
		).toHaveText(EDITED_NOTE, {
			timeout: SETTLE_MS,
		});
		await expect(page.locator(HTMX_IN_MOTION)).toHaveCount(0);
		await expect(page.locator(`#highlight-${highlightId}`)).toBeFocused();
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
	});

	test("Escape and Cancel bring focus back to the highlight, and a held Enter presses no action", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`manage-keys-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);
		await page.locator(CONTENT).evaluate((content) => {
			content.setAttribute("tabindex", "-1");
			content.focus();
		});
		for (let presses = 0; presses < 40; presses++) {
			if (await mark.evaluate((element) => element === document.activeElement))
				break;
			await page.keyboard.press("Tab");
		}
		await expect(mark).toBeFocused();

		await page.keyboard.down("Enter");
		await page.keyboard.down("Enter");
		await page.keyboard.up("Enter");
		await expect(panelOf(page, highlightId)).toHaveCount(1);
		await expect(editorOf(page, highlightId)).toHaveCount(0);

		await page.keyboard.press("Escape");
		await expect(mark).toBeFocused();

		await page.keyboard.press("Enter");
		await page.keyboard.press("Enter");
		await expect(editorOf(page, highlightId)).toHaveCount(1);
		await expect(page.locator(SHOWN_PREVIEW)).toHaveCount(0);
		await editorOf(page, highlightId)
			.locator('[data-test-action="highlight-note-edit-cancel"]')
			.click();
		await expect(editorOf(page, highlightId)).toHaveCount(0);
		await expect(mark).toBeFocused();
	});

	test("a click outside the note editor opened from a highlight leaves it open, and Escape brings focus back to the highlight", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`manage-dismiss-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);

		await mark.click();
		await panelOf(page, highlightId)
			.locator('[data-test-action="highlight-panel-note"]')
			.click();
		await expect(editorOf(page, highlightId)).toHaveCount(1);
		await page.mouse.click(5, 5);
		await expect(editorOf(page, highlightId)).toHaveCount(1);

		await page.keyboard.press("Escape");
		await expect(editorOf(page, highlightId)).toHaveCount(0);
		await expect(mark).toBeFocused();
	});

	test("Delete note from the actions removes the note and keeps the place and the highlight's focus", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`manage-delete-note-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const before = await page.evaluate(() => window.scrollY);

		await page.locator(`#highlight-${highlightId}`).click();
		await panelOf(page, highlightId)
			.locator('[data-test-action="highlight-panel-note-delete"]')
			.click();

		await expect(
			page.locator(`[data-test-highlight-row="${highlightId}"] ${RAIL_NOTE}`),
		).toHaveCount(0, {
			timeout: SETTLE_MS,
		});
		await expect(page.locator(HTMX_IN_MOTION)).toHaveCount(0);
		await expect(page.locator(`#highlight-${highlightId}`)).toBeFocused();
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
	});

	test("Delete highlight opens the rail's confirm from the actions even with the Highlights card collapsed", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`manage-delete-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		await page.locator("[data-test-highlights-card]").evaluate((card) => {
			if (card instanceof HTMLDetailsElement) card.open = false;
		});
		const before = await page.evaluate(() => window.scrollY);

		await page.locator(`#highlight-${highlightId}`).click();
		await panelOf(page, highlightId)
			.locator('[data-test-action="highlight-panel-delete"]')
			.click();
		const confirm = page.locator(
			`[id="delete-highlight-${highlightId}"]:popover-open`,
		);
		await expect(confirm).toHaveCount(1);
		await expect(
			confirm.locator('[data-test-action="highlight-delete-confirm"]'),
		).toBeVisible();
		await confirm
			.locator('[data-test-action="highlight-delete-confirm"]')
			.click();

		await expect(page.locator(`#highlight-${highlightId}`)).toHaveCount(0, {
			timeout: SETTLE_MS,
		});
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
	});
});

test.describe("The note editor leaves the highlighted passage visible", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("a drag-selection in the article keeps the editor open with the bar hidden, and a wheel scroll keeps it clear of the passage", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`drag-${testInfo.workerIndex}-${Date.now()}`,
		);
		const dialog = await openCreateEditor(page, PASSAGE);

		const drag = await page.evaluate(dragClearOfEditor, {
			panel: OPEN_NOTE_DIALOG,
			content: CONTENT,
		});
		await page.mouse.move(drag.x, drag.y);
		await page.mouse.down();
		await page.mouse.move(drag.to, drag.y, { steps: 8 });
		await page.mouse.up();
		await expect
			.poll(() =>
				page.evaluate(() => window.getSelection()?.toString().length ?? 0),
			)
			.toBeGreaterThan(0);
		await nextFrames(page);
		await expect(dialog).toHaveCount(1);
		await expect(page.locator(TOOLBAR)).toBeHidden();

		const before = await page.evaluate(() => window.scrollY);
		await page.mouse.move(drag.x, drag.y);
		await page.mouse.wheel(0, 120);
		await expect
			.poll(() => page.evaluate(() => window.scrollY), { timeout: SETTLE_MS })
			.toBeGreaterThan(before);
		await nextFrames(page);
		await expect(dialog).toHaveCount(1);
		expect((await editorMeasure(page, OPEN_NOTE_DIALOG, DRAFT)).miss).toBe(
			true,
		);
	});

	test("Escape closes the editor and clears the tint", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`escape-${testInfo.workerIndex}-${Date.now()}`,
		);
		await openCreateEditor(page, PASSAGE);

		await page.keyboard.press("Escape");

		await expect(page.locator(OPEN_NOTE_DIALOG)).toHaveCount(0);
		await expect.poll(() => page.evaluate(draftTintRegistered)).toBe(false);
	});

	test("in dark mode the page under the editor has no scrim, blur or dim", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openHighlightableReader(
			page,
			`dark-${testInfo.workerIndex}-${Date.now()}`,
		);
		await openCreateEditor(page, PASSAGE);

		expect(
			await page.evaluate(backdropOf, {
				panel: OPEN_NOTE_DIALOG,
				content: COLUMN,
			}),
		).toEqual(CLEAR_BACKDROP);
		expect((await editorMeasure(page, OPEN_NOTE_DIALOG, DRAFT)).miss).toBe(
			true,
		);
	});

	test("at 768 by 1024, in one column, the editor misses the passage", async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 768, height: 1024 });
		await openHighlightableReader(
			page,
			`tablet-${testInfo.workerIndex}-${Date.now()}`,
		);
		await openCreateEditor(page, PASSAGE);

		const measured = await editorMeasure(page, OPEN_NOTE_DIALOG, DRAFT);
		expect(measured.miss).toBe(true);
		expect(measured.firstLine.top).toBeGreaterThanOrEqual(measured.visibleTop);
		expect(
			await page.evaluate(backdropOf, {
				panel: OPEN_NOTE_DIALOG,
				content: COLUMN,
			}),
		).toEqual(CLEAR_BACKDROP);
	});

	test("at 1920 by 1080 a passage too tall for above or below puts the editor in the free strip beside the column", async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1920, height: 1080 });
		await openHighlightableReader(
			page,
			`margin-${testInfo.workerIndex}-${Date.now()}`,
		);
		const column = await page.locator(COLUMN).boundingBox();
		assert(column, "the text column has a box");
		expect(column.x - 2 * 16).toBeGreaterThanOrEqual(320);
		await page
			.locator(CONTENT)
			.evaluate(centreBetweenParagraphs, { first: TALL_ONE, last: TALL_TWO });
		await page.evaluate(selectAcrossParagraphs, {
			root: CONTENT,
			first: TALL_ONE,
			second: TALL_TWO,
		});
		await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
		await page.locator(ADD_NOTE_BUTTON).click();
		await expect(page.locator(OPEN_NOTE_DIALOG)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});

		const measured = await editorMeasure(page, OPEN_NOTE_DIALOG, DRAFT);
		const editorHeight = measured.panel.bottom - measured.panel.top;
		expect(measured.passage.top - measured.visibleTop).toBeLessThan(
			editorHeight,
		);
		expect(measured.visibleBottom - measured.passage.bottom).toBeLessThan(
			editorHeight,
		);
		expect(measured.panel.right).toBeLessThanOrEqual(column.x);
		expect(measured.panel.left).toBeGreaterThanOrEqual(16);
		expect(measured.miss).toBe(true);
	});

	test("editing from the rail with the marks on screen misses the marks and the row's quote", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`rail-edit-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await highlightWithNote(page, FIRST_NOTE);
		await page
			.locator(`#highlight-${highlightId}`)
			.evaluate((mark) =>
				mark.scrollIntoView({ block: "center", behavior: "instant" }),
			);
		await expect(page.locator(`#highlight-${highlightId}`)).toBeInViewport();

		await rowNoteDialog(page, highlightId);

		const panel = `[id="note-highlight-${highlightId}"]:popover-open`;
		const marks = [`mark[data-highlight-id="${highlightId}"]`];
		const quote = [`[data-test-highlight-row="${highlightId}"] blockquote`];
		expect((await editorMeasure(page, panel, marks)).miss).toBe(true);
		expect((await editorMeasure(page, panel, quote)).miss).toBe(true);
	});

	test("editing from the highlight's actions after scrolling the passage away brings its first line back without heading for the rail", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`panel-edit-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await addNotedHighlight(page, FIRST_NOTE);
		const mark = page.locator(`#highlight-${highlightId}`);
		const quote = page.locator(
			`[data-test-highlight-row="${highlightId}"] blockquote`,
		);
		await mark.click();
		const actions = page.locator(
			`#manage-highlight-${highlightId}:popover-open`,
		);
		await expect(actions).toHaveCount(1, { timeout: SETTLE_MS });
		await page.evaluate(() =>
			window.scrollTo({
				top: document.documentElement.scrollHeight,
				behavior: "instant",
			}),
		);
		await expect(mark).not.toBeInViewport();
		await expect(quote).not.toBeInViewport();
		await expect(actions).toHaveCount(1);
		const before = await page.evaluate(() => window.scrollY);

		await actions
			.locator('[data-test-action="highlight-panel-note"]')
			.evaluate((button) => {
				if (button instanceof HTMLElement) button.click();
			});

		const panel = `[id="note-highlight-${highlightId}"]:popover-open`;
		await expect(page.locator(panel)).toHaveCount(1, { timeout: SETTLE_MS });
		await nextFrames(page);
		const measured = await editorMeasure(page, panel, [
			`mark[data-highlight-id="${highlightId}"]`,
		]);
		expect(measured.miss).toBe(true);
		expect(measured.firstLine.top).toBeGreaterThanOrEqual(measured.visibleTop);
		expect(measured.firstLine.bottom).toBeLessThanOrEqual(
			measured.visibleBottom,
		);
		expect(await page.evaluate(() => window.scrollY)).toBeLessThan(before);
		await expect(quote).not.toBeInViewport();
	});

	test("beside the rail's column, a centred passage too tall for above or below gets the sheet, and the page scrolls it clear", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`sheet-${testInfo.workerIndex}-${Date.now()}`,
		);
		await highlightWithNote(page, FIRST_NOTE);
		await expect(page.locator(".highlights-rail")).toBeVisible();
		const before = await page
			.locator(CONTENT)
			.getByText(TALL_ONE)
			.evaluate((paragraph) => {
				paragraph.scrollIntoView({ block: "center", behavior: "instant" });
				const rect = paragraph.getBoundingClientRect();
				return { scrollY: window.scrollY, top: rect.top, bottom: rect.bottom };
			});
		await page.evaluate(selectPassage, { root: CONTENT, exact: TALL_ONE });
		await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
		await page.locator(ADD_NOTE_BUTTON).click();
		await expect(page.locator(OPEN_NOTE_DIALOG)).toHaveCount(1, {
			timeout: SETTLE_MS,
		});

		const measured = await editorMeasure(page, OPEN_NOTE_DIALOG, DRAFT);
		const editorHeight = measured.panel.bottom - measured.panel.top;
		expect(before.top - measured.visibleTop).toBeLessThan(editorHeight);
		expect(DESKTOP.height - before.bottom).toBeLessThan(editorHeight);
		expect(
			Math.abs(measured.panel.bottom - (measured.visibleBottom - 16)),
		).toBeLessThanOrEqual(1);
		expect(await page.evaluate(() => window.scrollY)).not.toBe(before.scrollY);
		expect(measured.miss).toBe(true);
	});

	test("a Delete confirm opened over the editor closes first on Escape, and the next Escape closes the editor", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`stacked-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await highlightWithNote(page, FIRST_NOTE);
		const editor = await rowNoteDialog(page, highlightId);

		await page
			.locator(
				`[data-test-highlight-row="${highlightId}"] [popovertarget="delete-highlight-${highlightId}"]`,
			)
			.click();
		const confirm = page.locator(
			`[id="delete-highlight-${highlightId}"]:popover-open`,
		);
		await expect(confirm).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(editor).toHaveCount(1);

		await page.keyboard.press("Escape");
		await expect(confirm).toHaveCount(0);
		await expect(editor).toHaveCount(1);

		await page.keyboard.press("Escape");
		await expect(editor).toHaveCount(0);
	});
});

test.describe("The note editor without scripts", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("the rail's fallback opens under the quote and saves the note through a redirect", async ({
		page,
		browser,
	}, testInfo) => {
		const { articleId } = await openHighlightableReader(
			page,
			`no-script-${testInfo.workerIndex}-${Date.now()}`,
		);
		const highlightId = await highlightWithNote(page, FIRST_NOTE);
		const noScript = await browser.newContext({
			javaScriptEnabled: false,
			viewport: DESKTOP,
			timezoneId: "UTC",
			storageState: await page.context().storageState(),
		});
		const reader = await noScript.newPage();
		await reader.goto(`${BASE_URL}/queue/${articleId}/view`, {
			waitUntil: "domcontentloaded",
		});
		const row = reader.locator(`[data-test-highlight-row="${highlightId}"]`);
		const fallback = row.locator("[data-test-highlight-note-fallback]");

		await expect(row.locator(".highlight-note__trigger")).toBeHidden();
		await expect(fallback.locator("summary")).toBeVisible();
		await expect(fallback).toHaveJSProperty("open", false);

		await fallback.locator("summary").click();
		await expect(fallback).toHaveJSProperty("open", true);
		const quote = await row.locator("blockquote").boundingBox();
		const field = await fallback.locator(NOTE_INPUT).boundingBox();
		assert(quote && field, "the quote and the note field have boxes");
		expect(field.y).toBeGreaterThanOrEqual(quote.y + quote.height);

		await fallback.locator(NOTE_INPUT).fill("Saved without scripts.");
		await fallback.locator('button[type="submit"]').click();
		await reader.waitForLoadState("domcontentloaded");
		await expect(
			reader.locator(`[data-test-highlight-row="${highlightId}"] ${RAIL_NOTE}`),
		).toContainText("Saved without scripts.", { timeout: SETTLE_MS });
		await noScript.close();
	});
});
