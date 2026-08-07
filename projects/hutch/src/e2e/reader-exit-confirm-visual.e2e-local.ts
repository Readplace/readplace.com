import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const ARTICLE_TITLE = "Yes you can measure engineering | Jade Rubick - Engineering Leadership";
const SAME_TAB_EXIT_LINK = `.article-body__content a[href^="${BASE_URL}/privacy"]`;
const PANEL = "#reader-exit-confirm";
const PANEL_TITLE = ".reader-confirm__title";
const PANEL_ARTICLE = ".reader-confirm__article";
const PANEL_QUESTION = ".reader-confirm__body";
const PANEL_CONFIRM = '[data-test-action="exit-confirm-yes"]';
const PANEL_DECLINE = '[data-test-action="exit-confirm-no"]';

const CreatedUser = z.union([
	z.object({ ok: z.literal(true), userId: z.string() }),
	z.object({ ok: z.literal(false), reason: z.string() }),
]);
const SeededArticle = z.object({ articleId: z.string() });

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	const created = CreatedUser.parse(await response.json());
	assert(created.ok, `the e2e user fixture must create the owner ${email}`);
	return created.userId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-queue");
}

async function openExitConfirm(page: Page, stamp: string): Promise<void> {
	const email = `reader-exit-visual-${stamp}@example.com`;
	const ownerUserId = await createOwner(page, email);
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/reader-exit-confirm-visual-${stamp}`,
			title: ARTICLE_TITLE,
			content: `<p>Body copy that ends in <a href="${BASE_URL}/privacy?from=article">the privacy policy</a>.</p>`,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: ownerUserId,
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await response.json());
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await clickExitLinkUntilThePanelOpens(page);
}

async function clickExitLinkUntilThePanelOpens(page: Page): Promise<void> {
	await expect(async () => {
		await page.locator(SAME_TAB_EXIT_LINK).click();
		await expect(page.locator(PANEL)).toBeVisible({ timeout: 1500 });
	}).toPass({ timeout: 30000 });
}

async function panelOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${PANEL}:popover-open`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function titleLeadsArticleThenQuestionThenChoice(page: Page): Promise<void> {
	const panel = await measuredBox(page, PANEL);
	const stacked = [
		["title", await measuredBox(page, PANEL_TITLE)],
		["article title", await measuredBox(page, PANEL_ARTICLE)],
		["question", await measuredBox(page, PANEL_QUESTION)],
		["mark-read choice", await measuredBox(page, PANEL_CONFIRM)],
		["decline choice", await measuredBox(page, PANEL_DECLINE)],
	] as const;

	for (let i = 1; i < stacked.length; i++) {
		const [name, part] = stacked[i];
		const [aboveName, above] = stacked[i - 1];
		assert.ok(
			part.y >= above.y + above.height,
			`the ${name} must sit below the ${aboveName}, not beside it`,
		);
	}
	const confirm = await measuredBox(page, PANEL_CONFIRM);
	const decline = await measuredBox(page, PANEL_DECLINE);
	assert.equal(decline.x, confirm.x, "the two choices must stack in one column");
	assert.equal(decline.width, confirm.width, "the stacked choices must share the panel's width");

	for (const [name, part] of stacked) {
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

const EXIT_CONFIRM_LIGHT: VisualCheckpoint = {
	name: "reader-exit-confirm-light",
	settled: panelOpen,
	geometry: titleLeadsArticleThenQuestionThenChoice,
	target: PANEL,
	capture: "element",
	pinnedText: [],
};

const EXIT_CONFIRM_DARK: VisualCheckpoint = {
	name: "reader-exit-confirm-dark",
	settled: panelOpen,
	geometry: titleLeadsArticleThenQuestionThenChoice,
	target: PANEL,
	capture: "element",
	pinnedText: [],
};

test.describe("Reader exit confirmation panel", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("names the exit and asks the mark-read question under it (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openExitConfirm(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, EXIT_CONFIRM_LIGHT);
	});

	test("names the exit and asks the mark-read question under it (dark)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openExitConfirm(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, EXIT_CONFIRM_DARK);
	});
});
