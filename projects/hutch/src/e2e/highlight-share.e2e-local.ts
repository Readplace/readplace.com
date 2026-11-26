import assert from "node:assert/strict";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { z } from "zod";
import { selectPassage } from "./highlight-a-passage.browser";
import { passageInViewport, withoutWebShare } from "./highlight-share.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const SETTLE_MS = 45000;
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";

const CONTENT = "[data-test-reader-content]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const TOOLBAR = "[data-test-highlight-toolbar]";
const MARK = `${CONTENT} mark.article-highlight`;
const PANEL = "[data-highlight-popover]:popover-open";
const WHATSAPP = `${PANEL} [data-highlight-share-target="whatsapp"]`;

const PASSAGE = "a shared highlight — dash and all — opens where the reader marked it";
const FILLER = Array.from(
	{ length: 40 },
	(_, index) => `<p>Paragraph ${index + 1} keeps the passage well below the first screen of the article.</p>`,
).join("");
const ARTICLE = `${FILLER}<p>At the end, ${PASSAGE}, for whoever opens the link.</p>`;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

test.describe("Share highlight", () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test("a shared link opens the article's public page at the highlighted passage", async ({ page, browser }, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `highlight-share-${stamp}@example.com`;
		await page.addInitScript(withoutWebShare);
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email, password: PASSWORD, verified: true },
		});
		assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
		const { userId } = CreatedUser.parse(await created.json());
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/highlight-share-${stamp}`,
				title: "Sharing A Highlight",
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
		await page.waitForSelector(READY_SLOT);
		await page.locator(`${CONTENT} p`).last().scrollIntoViewIfNeeded();
		await page.evaluate(selectPassage, { root: CONTENT, exact: PASSAGE });
		await expect(page.locator(TOOLBAR)).toBeVisible({ timeout: SETTLE_MS });
		await page.locator('[data-test-action="highlight"]').click();
		await expect(page.locator(MARK)).toHaveCount(1, { timeout: SETTLE_MS });
		await page.locator(MARK).click();
		await expect(page.locator(WHATSAPP)).toBeVisible({ timeout: SETTLE_MS });

		const href = await page.locator(WHATSAPP).getAttribute("href");
		assert(href, "the WhatsApp target carries its link");
		const text = new URL(href).searchParams.get("text");
		assert(text, "the WhatsApp link carries the message");
		const shared = new URL(text.slice(text.lastIndexOf(" ") + 1));
		expect(text.startsWith(`“${PASSAGE}”\nSharing A Highlight `)).toBe(true);
		expect(shared.hash.startsWith("#:~:text=")).toBe(true);

		const recipient = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const opened = await recipient.newPage();
		await opened.goto(`${BASE_URL}${shared.pathname}${shared.search}`, { waitUntil: "load" });
		expect(await opened.evaluate(passageInViewport, { root: CONTENT, exact: PASSAGE })).toBe(false);
		await opened.goto(`${BASE_URL}${shared.pathname}${shared.search}${shared.hash}`, { waitUntil: "load" });
		await expect
			.poll(() => opened.evaluate(passageInViewport, { root: CONTENT, exact: PASSAGE }), { timeout: SETTLE_MS })
			.toBe(true);
		await recipient.close();
	});
});
