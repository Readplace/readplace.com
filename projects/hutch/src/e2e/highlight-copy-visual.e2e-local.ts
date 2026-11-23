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
const MARK = `${CONTENT} mark.article-highlight`;
const PANEL = "[data-highlight-popover]:popover-open";
const PANEL_NOTE = `${PANEL} [data-test-action="highlight-panel-note"]`;
const PANEL_COPY = `${PANEL} [data-test-action="highlight-panel-copy"]`;
const PANEL_DELETE = `${PANEL} [data-test-action="highlight-panel-delete"]`;
const COPY_STATUS = "[data-test-highlight-copy-status]";
const PASSAGE = "a copied highlight carries only the words the reader marked";
const PARAGRAPH = `<p>The actions beside a highlight: ${PASSAGE}, ready to paste into notes.</p>`;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openHighlightedReader(page: Page, stamp: string): Promise<void> {
	const email = `highlight-copy-visual-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/highlight-copy-visual-${stamp}`,
			title: "Copying a Highlight",
			content: PARAGRAPH,
			contentFetchedAt: CONTENT_FETCHED_AT,
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
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(READY_SLOT);
	await page.evaluate(selectPassage, { root: CONTENT, exact: PASSAGE });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator('[data-test-action="highlight"]').click();
	await expect(page.locator(MARK)).toHaveCount(1, { timeout: SETTLE_MS });
}

async function openPanel(page: Page): Promise<void> {
	await page.locator(MARK).click();
	await expect(page.locator(PANEL)).toHaveCount(1, { timeout: SETTLE_MS });
}

async function panelShown(page: Page): Promise<void> {
	await expect(page.locator(PANEL_NOTE)).toBeFocused();
	await expect(page.locator(PANEL_COPY)).toBeVisible();
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function copyBetweenNoteAndDelete(page: Page): Promise<void> {
	const note = await measuredBox(page, PANEL_NOTE);
	const copy = await measuredBox(page, PANEL_COPY);
	const remove = await measuredBox(page, PANEL_DELETE);
	assert.ok(copy.y >= note.y + note.height, "Copy highlight sits below the note action");
	assert.ok(remove.y >= copy.y + copy.height, "Delete highlight sits below Copy highlight");
	assert.equal(copy.width, note.width, "Copy highlight spans the panel like the note action");
}

async function statusShown(page: Page): Promise<void> {
	await expect(page.locator(COPY_STATUS)).toBeVisible();
	await waitForBrandFonts(page, ["Inter"]);
}

async function statusInsideViewport(page: Page): Promise<void> {
	const status = await measuredBox(page, COPY_STATUS);
	assert.ok(status.x >= 0 && status.x + status.width <= DESKTOP.width, "the copy status fits the viewport's width");
	assert.ok(status.y + status.height <= DESKTOP.height, "the copy status sits above the viewport's bottom edge");
}

function panelCheckpoint(name: string): VisualCheckpoint {
	return { name, settled: panelShown, geometry: copyBetweenNoteAndDelete, target: PANEL, capture: "element", pinnedText: [] };
}

function statusCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: statusShown,
		geometry: statusInsideViewport,
		target: COPY_STATUS,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Copy highlight in a highlight's actions", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, permissions: ["clipboard-read", "clipboard-write"] });

	for (const scheme of ["light", "dark"] as const) {
		test(`the actions offer Copy highlight between the note and the delete actions (${scheme})`, async ({
			page,
		}, testInfo) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openHighlightedReader(page, `panel-${scheme}-${testInfo.workerIndex}-${Date.now()}`);
			await openPanel(page);
			await captureCheckpoint(page, panelCheckpoint(`highlight-copy-panel-${scheme}`));
		});

		test(`the copy status confirms a copy (${scheme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openHighlightedReader(page, `status-${scheme}-${testInfo.workerIndex}-${Date.now()}`);
			await page.locator(COPY_STATUS).evaluate((status) => {
				status.textContent = status.getAttribute("data-copied-text");
				status.removeAttribute("hidden");
			});
			await captureCheckpoint(page, statusCheckpoint(`highlight-copy-status-${scheme}`));
		});
	}
});
