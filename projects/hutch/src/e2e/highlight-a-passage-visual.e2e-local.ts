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
const MARKED_PARAGRAPH =
	"[data-test-reader-content] p:has(mark.article-highlight)";
const MARK = `${MARKED_PARAGRAPH} mark.article-highlight`;
const PASSAGE =
	"a reader's own mark sits behind the words without changing their ink";
const PARAGRAPH = `<p>A highlighted sentence keeps its type and its colour: ${PASSAGE}, so the passage reads as it did before it was marked.</p>`;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openMarkedParagraph(page: Page, stamp: string): Promise<void> {
	const email = `highlight-visual-${stamp}@example.com`;
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
				url: `https://example.com/highlight-visual-${stamp}`,
				title: "A Marked Paragraph",
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
	await page.locator('[data-test-action="highlight"]').click();
	await expect(page.locator(MARK)).toHaveText(PASSAGE, { timeout: SETTLE_MS });
}

async function markedParagraphSettled(page: Page): Promise<void> {
	await expect(page.locator(MARK)).toHaveCount(1);
	await expect(page.locator(TOOLBAR)).toBeHidden();
	await waitForBrandFonts(page, ["Inter"]);
	await page.mouse.move(0, 0);
}

async function markInsideParagraph(page: Page): Promise<void> {
	const paragraph = await measuredBox(page, MARKED_PARAGRAPH);
	const mark = await measuredBox(page, MARK);
	assert.ok(mark.x >= paragraph.x, "the mark starts inside its paragraph");
	assert.ok(
		mark.x + mark.width <= paragraph.x + paragraph.width,
		"the mark ends inside its paragraph",
	);
	assert.ok(mark.y >= paragraph.y, "the mark sits below the paragraph's top");
	assert.ok(
		mark.y + mark.height <= paragraph.y + paragraph.height,
		"the mark sits above the paragraph's bottom",
	);
}

function checkpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: markedParagraphSettled,
		geometry: markInsideParagraph,
		target: MARKED_PARAGRAPH,
		capture: "element",
		pinnedText: [],
	};
}

const MARKED_PARAGRAPH_LIGHT = checkpoint("highlight-marked-paragraph-light");
const MARKED_PARAGRAPH_DARK = checkpoint("highlight-marked-paragraph-dark");

test.describe("A highlighted passage in the reader", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("sits behind unchanged ink (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openMarkedParagraph(
			page,
			`light-${testInfo.workerIndex}-${Date.now()}`,
		);
		await captureCheckpoint(page, MARKED_PARAGRAPH_LIGHT);
	});

	test("sits behind unchanged ink (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openMarkedParagraph(
			page,
			`dark-${testInfo.workerIndex}-${Date.now()}`,
		);
		await captureCheckpoint(page, MARKED_PARAGRAPH_DARK);
	});
});
