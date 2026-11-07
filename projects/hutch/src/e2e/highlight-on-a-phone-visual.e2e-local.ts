import assert from "node:assert/strict";
import { captureCheckpoint, expect, measuredBox, test, type VisualCheckpoint, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { devices, type Page } from "@playwright/test";
import { z } from "zod";
import { pointInsideText, selectedText, toolbarBelowSelection } from "./highlight-on-a-phone.browser";
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
const TAPPED_SENTENCE = "A single tap on this sentence selects it whole.";
const ARTICLE = [
	`<p>The reader holds the phone in one hand. ${TAPPED_SENTENCE} The bar waits underneath.</p>`,
	"<p>The next paragraph sits under the bar, so the capture shows the bar over the text it covers.</p>",
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
	await page.goto(`${BASE_URL}/queue/${articleId}/view?feature=highlight`, {
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

async function toolbarUnderSentence(page: Page): Promise<void> {
	const { toolbarTop, selectionBottom } = await page.evaluate(toolbarBelowSelection, { toolbar: TOOLBAR });
	assert.ok(toolbarTop >= selectionBottom, "the bar sits below the tapped sentence");
	const content = await measuredBox(page, CONTENT);
	const toolbar = await measuredBox(page, TOOLBAR);
	assert.ok(toolbar.x >= content.x, "the bar starts inside the article column");
	assert.ok(toolbar.x + toolbar.width <= content.x + content.width, "the bar ends inside the article column");
	assert.ok(toolbar.y + toolbar.height <= content.y + content.height, "the bar sits over the article text");
}

function checkpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: toolbarSettled,
		geometry: toolbarUnderSentence,
		target: CONTENT,
		capture: "element",
		pinnedText: [],
	};
}

const TOOLBAR_UNDER_SENTENCE_LIGHT = checkpoint("highlight-phone-toolbar-light");
const TOOLBAR_UNDER_SENTENCE_DARK = checkpoint("highlight-phone-toolbar-dark");

test.describe("The highlight bar on a phone", () => {
	test.use({
		...PIXEL_7,
		timezoneId: "UTC",
		userAgent: MACOS_CHROME_USER_AGENT,
	});

	test("sits under a tapped sentence (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openTappedSentence(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, TOOLBAR_UNDER_SENTENCE_LIGHT);
	});

	test("sits under a tapped sentence (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openTappedSentence(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, TOOLBAR_UNDER_SENTENCE_DARK);
	});
});
