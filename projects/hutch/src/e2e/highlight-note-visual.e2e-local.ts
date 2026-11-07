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
	await page.goto(`${BASE_URL}/queue/${articleId}/view?feature=highlight`, {
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
