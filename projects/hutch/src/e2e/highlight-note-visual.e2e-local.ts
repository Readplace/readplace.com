import assert from "node:assert/strict";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { selectPassage } from "./highlight-a-passage.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const SETTLE_MS = 45000;

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const PANEL = '[data-test-confirm-popover="highlight-note"]';
const PANEL_TITLE = `${PANEL} .confirm-popover__title`;
const PANEL_INPUT = `${PANEL} [data-test-highlight-note-input]`;
const PANEL_CANCEL = `${PANEL} [data-test-action="highlight-note-cancel"]`;
const PANEL_SAVE = `${PANEL} [data-test-action="highlight-note-save"]`;
const PASSAGE =
	"a note keeps the reader's thought beside the words it is about";
const PARAGRAPH = `<p>The note dialog opens over the reader: ${PASSAGE}, so it reads beside the passage on every open.</p>`;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openNoteDialog(page: Page, stamp: string): Promise<void> {
	const email = `highlight-note-visual-${stamp}@example.com`;
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
				url: `https://example.com/highlight-note-visual-${stamp}`,
				title: "A Note Beside the Passage",
				content: PARAGRAPH,
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
	await page.evaluate(selectPassage, { root: CONTENT, exact: PASSAGE });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator('[data-test-action="add-note"]').click();
}

async function dialogOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${PANEL}:popover-open`);
	await expect(page.locator(PANEL_INPUT)).toBeFocused();
	await expect(page.locator(TOOLBAR)).toBeHidden();
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function titleThenNoteThenBothChoices(page: Page): Promise<void> {
	const panel = await measuredBox(page, PANEL);
	const title = await measuredBox(page, PANEL_TITLE);
	const input = await measuredBox(page, PANEL_INPUT);
	const cancel = await measuredBox(page, PANEL_CANCEL);
	const save = await measuredBox(page, PANEL_SAVE);
	assert.ok(
		input.y >= title.y + title.height,
		"the note field sits below the title",
	);
	assert.ok(
		save.y >= input.y + input.height,
		"Save note sits below the note field",
	);
	assert.ok(
		Math.abs(cancel.y - save.y) <= 1,
		"Cancel and Save note share one row",
	);
	assert.ok(cancel.x + cancel.width <= save.x, "Cancel sits before Save note");
	for (const [name, part] of [
		["title", title],
		["note field", input],
		["Cancel", cancel],
		["Save note", save],
	] as const) {
		assert.ok(
			part.x >= panel.x && part.x + part.width <= panel.x + panel.width,
			`the ${name} must sit inside the panel horizontally`,
		);
		assert.ok(
			part.y >= panel.y && part.y + part.height <= panel.y + panel.height,
			`the ${name} must sit inside the panel vertically`,
		);
	}
}

function checkpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: dialogOpen,
		geometry: titleThenNoteThenBothChoices,
		target: PANEL,
		capture: "element",
		pinnedText: [],
	};
}

const NOTE_DIALOG_LIGHT = checkpoint("highlight-note-dialog-light");
const NOTE_DIALOG_DARK = checkpoint("highlight-note-dialog-dark");

test.describe("The Add a note dialog", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("holds the title, the note field, then both choices (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openNoteDialog(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, NOTE_DIALOG_LIGHT);
	});

	test("holds the title, the note field, then both choices (dark)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openNoteDialog(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, NOTE_DIALOG_DARK);
	});
});

const PREVIEW = "[data-test-highlight-preview]:popover-open";
const NOTED_MARK = `${CONTENT} mark.article-highlight[tabindex="0"]`;
const NOTE = "Worth rereading before the next chapter.";

async function openNotedHighlight(page: Page, stamp: string): Promise<void> {
	await openNoteDialog(page, stamp);
	await page.waitForSelector(`${PANEL}:popover-open`);
	await page.locator(PANEL_INPUT).fill(NOTE);
	await page.locator(PANEL_SAVE).click();
	await expect(page.locator(NOTED_MARK)).toHaveCount(1, { timeout: SETTLE_MS });
	await page.mouse.move(5, 5);
}

async function previewShown(page: Page): Promise<void> {
	await expect(page.locator(PREVIEW)).toHaveJSProperty("textContent", NOTE, { timeout: SETTLE_MS });
	await waitForBrandFonts(page, ["Inter"]);
}

async function previewClearOfMark(page: Page): Promise<void> {
	const preview = await measuredBox(page, PREVIEW);
	const mark = await measuredBox(page, NOTED_MARK);
	assert.ok(
		preview.y + preview.height <= mark.y || preview.y >= mark.y + mark.height,
		"the preview sits clear of the highlighted line",
	);
}

async function markFocused(page: Page): Promise<void> {
	await expect(page.locator(NOTED_MARK)).toBeFocused();
	await expect(page.locator(NOTED_MARK)).toHaveCSS("outline-width", "2px");
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function ringInsideParagraph(page: Page): Promise<void> {
	const paragraph = await measuredBox(page, `${CONTENT} p`);
	const mark = await measuredBox(page, NOTED_MARK);
	assert.ok(
		mark.x >= paragraph.x && mark.x + mark.width <= paragraph.x + paragraph.width,
		"the focused mark sits inside its paragraph",
	);
}

function previewCheckpoint(name: string): VisualCheckpoint {
	return { name, settled: previewShown, geometry: previewClearOfMark, target: PREVIEW, capture: "element", pinnedText: [] };
}

function ringCheckpoint(name: string): VisualCheckpoint {
	return { name, settled: markFocused, geometry: ringInsideParagraph, target: `${CONTENT} p`, capture: "element", pinnedText: [] };
}

async function tabToMark(page: Page): Promise<void> {
	const mark = page.locator(NOTED_MARK);
	await page.locator(CONTENT).evaluate((content) => {
		content.setAttribute("tabindex", "-1");
		content.focus();
	});
	for (let presses = 0; presses < 20; presses++) {
		if (await mark.evaluate((element) => element === document.activeElement)) return;
		await page.keyboard.press("Tab");
	}
}

test.describe("A note beside its highlight", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const scheme of ["light", "dark"] as const) {
		test(`a hovered note shows its preview (${scheme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openNotedHighlight(page, `preview-${scheme}-${testInfo.workerIndex}-${Date.now()}`);
			await page.locator(NOTED_MARK).hover();
			await captureCheckpoint(page, previewCheckpoint(`highlight-note-preview-${scheme}`));
		});

		test(`a focused noted mark draws its ring (${scheme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openNotedHighlight(page, `ring-${scheme}-${testInfo.workerIndex}-${Date.now()}`);
			await tabToMark(page);
			await captureCheckpoint(page, ringCheckpoint(`highlight-note-focus-ring-${scheme}`));
		});
	}
});
