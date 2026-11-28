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
import { withoutWebShare, withWebShare } from "./highlight-share.browser";

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
const PANEL_SHARE = `${PANEL} [data-test-action="highlight-panel-share"]`;
const PANEL_TARGETS = `${PANEL} [data-test-highlight-share-targets]`;
const PANEL_DELETE = `${PANEL} [data-test-action="highlight-panel-delete"]`;
const PASSAGE = "a shared highlight sends the words the reader marked";
const PARAGRAPH = `<p>The actions beside a highlight: ${PASSAGE}, with a link back to them.</p>`;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openPanel(page: Page, stamp: string): Promise<void> {
	const email = `highlight-share-visual-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/highlight-share-visual-${stamp}`,
			title: "Sharing a Highlight",
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
	await page.locator(MARK).click();
	await expect(page.locator(PANEL)).toHaveCount(1, { timeout: SETTLE_MS });
}

async function panelShown(page: Page): Promise<void> {
	await expect(page.locator(PANEL_NOTE)).toBeFocused();
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function betweenNoteAndDelete(page: Page, selector: string): Promise<void> {
	const note = await measuredBox(page, PANEL_NOTE);
	const share = await measuredBox(page, selector);
	const remove = await measuredBox(page, PANEL_DELETE);
	assert.ok(share.y >= note.y + note.height, "the share item sits below the note action");
	assert.ok(remove.y >= share.y + share.height, "Delete highlight sits below the share item");
	assert.equal(share.width, note.width, "the share item spans the panel like the note action");
}

const STATES = [
	{
		name: "item",
		init: withWebShare,
		shown: PANEL_SHARE,
		hidden: PANEL_TARGETS,
	},
	{
		name: "targets",
		init: withoutWebShare,
		shown: PANEL_TARGETS,
		hidden: PANEL_SHARE,
	},
] as const;

test.describe("Share highlight in a highlight's actions", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const state of STATES) {
		for (const scheme of ["light", "dark"] as const) {
			test(`the actions offer Share highlight as the ${state.name} between the note and the delete actions (${scheme})`, async ({
				page,
			}, testInfo) => {
				await page.addInitScript(state.init);
				await page.emulateMedia({ colorScheme: scheme });
				await openPanel(page, `${state.name}-${scheme}-${testInfo.workerIndex}-${Date.now()}`);
				await expect(page.locator(state.shown)).toBeVisible();
				await expect(page.locator(state.hidden)).toBeHidden();
				const checkpoint: VisualCheckpoint = {
					name: `highlight-share-${state.name}-${scheme}`,
					settled: panelShown,
					geometry: (current) => betweenNoteAndDelete(current, state.shown),
					target: PANEL,
					capture: "element",
					pinnedText: [],
				};
				await captureCheckpoint(page, checkpoint);
			});
		}
	}
});
