import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { selectPassage } from "./highlight-a-passage.browser";
import { recordScrollAfterSwap } from "./readlist-scroll-stability.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const SETTLE_MS = 45000;

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const HIGHLIGHT_BUTTON = '[data-test-action="highlight"]';
const CREATE_FORM = "[data-test-highlight-create-form]";
const MARK = `${CONTENT} mark.article-highlight`;
const RAIL_ROW = "[data-test-highlight-row]";
const TOAST_MESSAGE = "#status-toast [data-test-toast-message]";
const SCROLL_STAMP = "data-test-scroll-after-swap";

const FILLER =
	"<p>Every filler paragraph of this seeded article repeats one sentence about keeping a long read in view, so the passages worth marking sit well below the fold of the first screen.</p>";
const FIRST_PASSAGE =
	"The first passage worth keeping explains why a reader marks a sentence.";
const SECOND_PASSAGE =
	"The second passage worth keeping says the mark should outlast a reload.";
const ARTICLE = [
	...Array.from({ length: 12 }, () => FILLER),
	`<p>${FIRST_PASSAGE} It sits in a paragraph of its own.</p>`,
	...Array.from({ length: 3 }, () => FILLER),
	`<p>${SECOND_PASSAGE} It sits further down the page.</p>`,
	...Array.from({ length: 4 }, () => FILLER),
].join("");

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openHighlightableReader(
	page: Page,
	stamp: string,
): Promise<string> {
	const email = `highlight-a-passage-${stamp}@example.com`;
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
				url: `https://example.com/highlight-a-passage-${stamp}`,
				title: "Marking the Passages Worth Keeping",
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
	const readerUrl = `${BASE_URL}/queue/${articleId}/view?feature=highlight`;
	await page.goto(readerUrl, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(READY_SLOT);
	return readerUrl;
}

async function highlight(page: Page, exact: string): Promise<void> {
	await page
		.locator(CONTENT)
		.getByText(exact, { exact: false })
		.scrollIntoViewIfNeeded();
	await page.evaluate(selectPassage, { root: CONTENT, exact });
	await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
	await page.evaluate(
		(stamp) => document.documentElement.removeAttribute(stamp),
		SCROLL_STAMP,
	);
	await page.evaluate(recordScrollAfterSwap, CREATE_FORM);
	const before = await page.evaluate(() => window.scrollY);
	await page.locator(HIGHLIGHT_BUTTON).click();
	await expect(page.locator("html")).toHaveAttribute(
		SCROLL_STAMP,
		String(before),
		{ timeout: SETTLE_MS },
	);
}

function markHolding(page: Page, exact: string) {
	return page.locator(MARK).filter({ hasText: exact });
}

test.describe("Highlighting a passage in the reader", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("marks two passages without a reload, keeps both on reload, jumps to one and deletes only the other", async ({
		page,
	}, testInfo) => {
		const readerUrl = await openHighlightableReader(
			page,
			`flow-${testInfo.workerIndex}-${Date.now()}`,
		);

		await highlight(page, FIRST_PASSAGE);
		await expect(markHolding(page, FIRST_PASSAGE)).toHaveCount(1);
		await expect(page.locator(RAIL_ROW)).toHaveCount(1);
		await expect(page.locator(TOOLBAR)).toBeHidden();

		await highlight(page, SECOND_PASSAGE);
		await expect(markHolding(page, SECOND_PASSAGE)).toHaveCount(1);
		await expect(page.locator(RAIL_ROW)).toHaveCount(2);

		await page.goto(readerUrl, { waitUntil: "domcontentloaded" });
		await page.waitForSelector(READY_SLOT);
		await expect(markHolding(page, FIRST_PASSAGE)).toHaveCount(1);
		await expect(markHolding(page, SECOND_PASSAGE)).toHaveCount(1);
		const rows = page.locator(RAIL_ROW);
		await expect(rows).toHaveCount(2);

		const firstRow = rows.filter({ hasText: FIRST_PASSAGE });
		const secondRow = rows.filter({ hasText: SECOND_PASSAGE });
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
		await expect(markHolding(page, FIRST_PASSAGE)).not.toBeInViewport();
		await firstRow.locator('[data-test-action="highlight-jump"]').click();
		await expect(markHolding(page, FIRST_PASSAGE)).toBeInViewport({
			timeout: SETTLE_MS,
		});

		await secondRow.locator('[data-test-action="highlight-delete"]').click();
		const secondPopover = secondRow.locator("[popover]:popover-open");
		await expect(secondPopover).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(firstRow.locator("[popover]:popover-open")).toHaveCount(0);
		await secondPopover
			.locator('[data-test-action="highlight-delete-confirm"]')
			.click();

		await expect(page.locator(RAIL_ROW)).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(
			page.locator(RAIL_ROW).filter({ hasText: FIRST_PASSAGE }),
		).toHaveCount(1);
		await expect(markHolding(page, SECOND_PASSAGE)).toHaveCount(0);
		await expect(markHolding(page, FIRST_PASSAGE)).toHaveCount(1);
	});

	test("a passage the server no longer finds at its offsets answers with a toast", async ({
		page,
	}, testInfo) => {
		await openHighlightableReader(
			page,
			`refused-${testInfo.workerIndex}-${Date.now()}`,
		);
		await page.route("**/client-dist/toast.client.js", (route) =>
			route.abort(),
		);
		await page.route(
			(url) => url.pathname.endsWith("/highlights"),
			async (route) => {
				const posted = route.request().postData();
				assert(posted, "the create form posts its fields");
				const body = new URLSearchParams(posted);
				body.set("start", "0");
				await route.continue({ postData: body.toString() });
			},
		);

		await highlight(page, FIRST_PASSAGE);

		await expect(page.locator(TOAST_MESSAGE)).toHaveText(
			"That passage changed; select it again",
			{
				timeout: SETTLE_MS,
			},
		);
		await expect(page.locator(MARK)).toHaveCount(0);
		await expect(page.locator(RAIL_ROW)).toHaveCount(0);
	});
});
