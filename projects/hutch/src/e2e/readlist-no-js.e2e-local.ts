import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const THUMBNAIL_URL = "https://cdn.example.com/queue-no-js-thumbnail.svg";
const CONTENT_FETCHED_AT = "2026-04-27T08:00:00.000Z";
const SETTLE_MS = 45000;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

test.describe("The readlist is whole without client JavaScript", () => {
	test.use({
		timezoneId: "UTC",
		viewport: { width: 758, height: 1024 },
		javaScriptEnabled: false,
	});

	async function pinThumbnail(page: Page): Promise<void> {
		await page.route(THUMBNAIL_URL, (route) =>
			route.fulfill({
				contentType: "image/svg+xml",
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#B9712A"/></svg>',
			}),
		);
	}

	async function seedArticleWithThumbnail(page: Page, stamp: string): Promise<string> {
		const email = `readlist-no-js-${stamp}@example.com`;
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email, password: PASSWORD, verified: true },
		});
		assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
		const { userId } = CreatedUser.parse(await created.json());

		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/queue-no-js-${stamp}`,
				title: "A saved article that carries a thumbnail",
				content: "<p>Seeded so the listing renders a card with an image.</p>",
				contentFetchedAt: CONTENT_FETCHED_AT,
				savedByUserId: userId,
				imageUrl: THUMBNAIL_URL,
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the saved article");
		return email;
	}

	async function loginAs(page: Page, email: string): Promise<void> {
		await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
		await page.locator("#email").fill(email);
		await page.locator("#password").fill(PASSWORD);
		await page.locator('[data-test-form="login"] button[type="submit"]').click();
		await page.waitForSelector("body.page-readlist");
	}

	test("a card thumbnail is visible with scripting off", async ({ page }, testInfo) => {
		await pinThumbnail(page);
		const email = await seedArticleWithThumbnail(page, `${testInfo.workerIndex}-${Date.now()}`);
		await loginAs(page, email);

		const thumbnail = page.locator(".readlist-article__thumbnail-link").first();
		await expect(thumbnail).toBeVisible({ timeout: SETTLE_MS });
		const box = await thumbnail.boundingBox();
		assert.ok(box, "the thumbnail must occupy a measurable box");
		assert.ok(box.width > 1 && box.height > 1, "the thumbnail must occupy more than a hairline");
	});

	test("reading an article and marking it read work as plain form submits", async ({
		page,
	}, testInfo) => {
		await pinThumbnail(page);
		const email = await seedArticleWithThumbnail(
			page,
			`${testInfo.workerIndex}-${Date.now()}-flow`,
		);
		await loginAs(page, email);

		const readerHref = await page
			.locator("[data-test-article-title]")
			.first()
			.getAttribute("href");
		assert(readerHref, "a saved card must link to its own reader");
		await page.goto(new URL(readerHref, BASE_URL).toString(), { waitUntil: "domcontentloaded" });
		await expect(page.locator("[data-test-reader-content]")).toBeVisible({ timeout: SETTLE_MS });

		await page.locator('[data-test-mark-read-form] button[type="submit"]').click();
		await page.waitForSelector("body.page-readlist");
		await expect(page.locator("[data-test-article]")).toHaveCount(0, { timeout: SETTLE_MS });

		await page.goto(`${BASE_URL}/queue?tab=done`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-read-status="read"]')).toHaveCount(1, {
			timeout: SETTLE_MS,
		});
	});

	test("the nav opens and signs the reader out with no script", async ({ page }, testInfo) => {
		const email = await seedArticleWithThumbnail(page, `${testInfo.workerIndex}-${Date.now()}-nav`);
		await loginAs(page, email);

		const menu = page.locator("#nav-menu");
		await expect(menu).toBeHidden();

		await page.locator(".nav__toggle").click();
		await expect(menu).toBeVisible({ timeout: SETTLE_MS });

		await page.locator('[data-test-nav-item="logout"]').click();
		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-form="login"]')).toBeVisible({ timeout: SETTLE_MS });
	});
});
