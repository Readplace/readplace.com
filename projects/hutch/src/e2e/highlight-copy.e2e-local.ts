import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { selectPassage } from "./highlight-a-passage.browser";
import { rowActionBoxes } from "./highlight-copy.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const SETTLE_MS = 45000;
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";

const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const COPY = '[data-test-action="highlight-copy"]';
const STATUS = "[data-test-highlight-copy-status]";

const LONG_PASSAGE = [
	"A reader who keeps a passage wants all of it back when they paste it elsewhere,",
	"even when the rail shows only the first four lines of it,",
	"because a citation cut off mid-sentence is worse than no citation at all,",
	"and the reader should not have to open the article again to find the rest,",
	"scroll to the passage, and select it a second time by hand on a small screen.",
].join(" ");
const ARTICLE = `<p>${LONG_PASSAGE}</p><p>A second paragraph keeps the article longer than one passage.</p>`;

const VIEWPORTS = [
	{ name: "desktop", size: { width: 1280, height: 900 } },
	{ name: "phone", size: { width: 390, height: 844 } },
] as const;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openSignedInReader(page: Page, stamp: string): Promise<void> {
	const email = `highlight-copy-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/highlight-copy-${stamp}`,
			title: "Copying A Highlight",
			content: ARTICLE,
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
	await page.waitForSelector(READY_SLOT, { timeout: SETTLE_MS });
}

async function highlight(page: Page, input: { content: string; exact: string }): Promise<void> {
	await page.evaluate(selectPassage, { root: input.content, exact: input.exact });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.locator(HIGHLIGHT_BUTTON).click();
}

async function copyAndCheck(page: Page, input: { row: string; exact: string }): Promise<void> {
	const status = page.locator(STATUS);
	await expect(page.getByRole("status").and(status)).toHaveCount(1);
	const copy = page.locator(input.row).filter({ hasText: input.exact.slice(0, 40) }).locator(COPY);
	await copy.scrollIntoViewIfNeeded();
	await copy.click();

	await expect(status).toHaveText("Highlight copied");
	await expect(status).toBeInViewport();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(input.exact);
}

test.describe("Copying a highlight from the Highlights rail", () => {
	test.use({ timezoneId: "UTC", permissions: ["clipboard-read", "clipboard-write"] });

	for (const viewport of VIEWPORTS) {
		test(`the signed-in reader copies a long row's full quote at ${viewport.name} width`, async ({ page }, testInfo) => {
			await page.setViewportSize(viewport.size);
			await openSignedInReader(page, `${viewport.name}-${testInfo.workerIndex}-${Date.now()}`);
			await highlight(page, { content: "[data-test-reader-content]", exact: LONG_PASSAGE });
			await expect(page.locator("[data-test-highlight-row]")).toHaveCount(1, { timeout: SETTLE_MS });

			const actions = await page.evaluate(rowActionBoxes, { row: "[data-test-highlight-row]" });
			expect(actions.buttons.length).toBeGreaterThanOrEqual(4);
			for (const button of actions.buttons) {
				expect(button.left).toBeGreaterThanOrEqual(actions.row.left);
				expect(button.right).toBeLessThanOrEqual(actions.row.right);
			}
			for (const [index, a] of actions.buttons.entries()) {
				for (const b of actions.buttons.slice(index + 1)) {
					const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
					expect(overlap).toBe(false);
				}
			}

			await copyAndCheck(page, { row: "[data-test-highlight-row]", exact: LONG_PASSAGE });
		});
	}

	test("a logged-out visitor copies a kept row's quote on /view", async ({ page }, testInfo) => {
		const exact = "every request returns the same body";
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(
			`${BASE_URL}/view?url=${encodeURIComponent(`${BASE_URL}/e2e/article/highlight-copy-${testInfo.workerIndex}-${Date.now()}`)}`,
			{ waitUntil: "domcontentloaded" },
		);
		await page.waitForSelector(READY_SLOT, { timeout: SETTLE_MS });
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-view");
		await highlight(page, { content: ".article-body__content", exact });
		await expect(page.locator("[data-test-view-highlight-row]")).toHaveCount(1, { timeout: SETTLE_MS });

		await copyAndCheck(page, { row: "[data-test-view-highlight-row]", exact });
	});
});
