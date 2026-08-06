import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-05-14T11:20:00.000Z";
// The exit link's destination must NOT share a body class with the queue: the
// mark-read POST's own 303 lands on /queue, so an exit link pointing there
// would leave "the link was followed" indistinguishable from a broken
// interception falling back to the native form submit.
const EXIT_LINK = `.article-body__content a[href^="${BASE_URL}/privacy"]`;
const PANEL = "#reader-exit-confirm";

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

async function seedArticleWithExitLink(
	page: Page,
	params: { url: string; ownerUserId: string },
): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: params.url,
			title: "Reader Exit Confirm",
			content: `<p>Body copy that ends in <a href="${BASE_URL}/privacy?from=article">the privacy policy</a>.</p>`,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: params.ownerUserId,
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
	return SeededArticle.parse(await response.json()).articleId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-queue");
}

test.describe("Leaving the reader through an article link asks to mark it read", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("confirming marks the article read and still follows the link", async ({ page }, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `reader-exit-${stamp}@example.com`;
		const ownerUserId = await createOwner(page, email);
		const articleId = await seedArticleWithExitLink(page, {
			url: `https://example.com/reader-exit-confirm-${stamp}`,
			ownerUserId,
		});
		await loginAs(page, email);
		await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });

		await page.locator(EXIT_LINK).click();

		// The click is answered by the popover instead of navigating — the reader
		// is still the live document behind it.
		await expect(page.locator(PANEL)).toBeVisible();
		await expect(page.locator(".article-body__title")).toHaveText("Reader Exit Confirm");

		await page.locator('[data-test-action="exit-confirm-yes"]').click();
		// page-privacy, not page-queue: only the intercepted path follows the
		// clicked link — a native fallback submit would 303 to the queue instead.
		await page.waitForSelector("body.page-privacy");

		// The mark-read POST is fire-and-forget across the unload, so poll the Done
		// tab until it lands rather than assuming it beat the navigation.
		await expect(async () => {
			await page.goto(`${BASE_URL}/queue?tab=done`, { waitUntil: "domcontentloaded" });
			await expect(page.locator(`[data-test-article="${articleId}"]`)).toHaveCount(1);
		}).toPass({ timeout: 15000 });
	});
});
