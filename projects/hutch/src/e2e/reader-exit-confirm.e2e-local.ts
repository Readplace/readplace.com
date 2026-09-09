import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-05-14T11:20:00.000Z";
// The exit link's destination must NOT share a body class with the readlist: the
// mark-read POST's own 303 lands on /queue, so an exit link pointing there
// would leave "the link was followed" indistinguishable from a broken
// interception falling back to the native form submit.
const EXIT_LINK = `.article-body__content a[href^="${BASE_URL}/privacy"]`;
const PANEL = "#reader-exit-confirm";
const CARD_LINK = "[data-test-related-item]";
const OPEN_CARD = "[data-test-reader-related].next-read--open";
const RELATED_COMPUTED_AT = "2026-05-14T11:40:00.000Z";
const LONG_PARAGRAPH =
	"<p>Body copy long enough that reaching the end of the article is a real scroll, which is the only thing that floats the suggestion card into view.</p>";

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
	await page.waitForSelector("body.page-readlist");
}

async function seedPlainArticle(
	page: Page,
	params: { url: string; title: string; ownerUserId: string },
): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: params.url,
			title: params.title,
			content: Array.from({ length: 40 }, () => LONG_PARAGRAPH).join("\n"),
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: params.ownerUserId,
		},
	});
	assert.equal(response.status(), 201, `seed endpoint must create ${params.url}`);
	return SeededArticle.parse(await response.json()).articleId;
}

test.describe("Next Read asks before it moves the reader on, inside the app", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 390, height: 844 } });

	test("confirming marks the source read, stays in the sheet, and tells the app", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `next-read-exit-${stamp}@example.com`;
		const ownerUserId = await createOwner(page, email);
		const sourceUrl = `https://example.com/next-read-exit-source-${stamp}`;
		const suggestionUrl = `https://example.com/next-read-exit-suggestion-${stamp}`;
		const sourceId = await seedPlainArticle(page, {
			url: sourceUrl,
			title: "The Source Article",
			ownerUserId,
		});
		const suggestionId = await seedPlainArticle(page, {
			url: suggestionUrl,
			title: "The Suggested Article",
			ownerUserId,
		});
		const settled = await page.request.post(`${BASE_URL}/e2e/seed-related-articles`, {
			data: {
				userId: ownerUserId,
				sourceUrl,
				related: [{ url: suggestionUrl, reason: "Same argument" }],
				computedAt: RELATED_COMPUTED_AT,
			},
		});
		assert.equal(settled.status(), 201, "the seed endpoint must settle the relations");

		await loginAs(page, email);
		await page.addInitScript(() => {
			const posted: string[] = [];
			Object.assign(window, {
				ReadplaceReader: {
					postMessage: (message: string) => {
						posted.push(message);
					},
				},
				readplaceBridgeMessages: posted,
			});
		});
		await page.goto(`${BASE_URL}/queue/${sourceId}/view?platform=android`, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForSelector("body.page-reader--chromeless");
		await page.waitForSelector('[data-test-reader-related][data-related-status="ready"]', {
			state: "attached",
		});
		await page.evaluate(() => {
			Object.assign(window, { readplaceSheetGeneration: "opened-once" });
		});

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForSelector(OPEN_CARD);
		await page.locator(CARD_LINK).click();

		await expect(page.locator(PANEL)).toBeVisible();
		await page.locator('[data-test-action="exit-confirm-yes"]').click();

		await expect(page.locator(".article-body__title")).toHaveText("The Suggested Article");
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { readplaceSheetGeneration?: string })
						.readplaceSheetGeneration,
			),
		).toBe("opened-once");
		expect(page.url()).toContain("platform=android");
		expect(page.url()).toContain(`/queue/${suggestionId}/view`);
		await expect(page.locator("body")).toHaveClass(/page-reader--chromeless/);
		await expect(page.locator("header.header")).toHaveCount(0);
		await expect(page.locator("footer.footer")).toHaveCount(0);

		await expect(async () => {
			expect(
				await page.evaluate(() =>
					(window as unknown as { readplaceBridgeMessages: string[] })
						.readplaceBridgeMessages,
				),
			).toContainEqual(JSON.stringify({ type: "statusChanged" }));
		}).toPass({ timeout: 10000 });

		await expect(async () => {
			await page.goto(`${BASE_URL}/queue?tab=done`, { waitUntil: "domcontentloaded" });
			await expect(page.locator(`[data-test-article="${sourceId}"]`)).toHaveCount(1);
		}).toPass({ timeout: 15000 });
	});
});

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
		// page-privacy, not page-readlist: only the intercepted path follows the
		// clicked link — a native fallback submit would 303 to the readlist instead.
		await page.waitForSelector("body.page-privacy");

		// The mark-read POST is fire-and-forget across the unload, so poll the Done
		// tab until it lands rather than assuming it beat the navigation.
		await expect(async () => {
			await page.goto(`${BASE_URL}/queue?tab=done`, { waitUntil: "domcontentloaded" });
			await expect(page.locator(`[data-test-article="${articleId}"]`)).toHaveCount(1);
		}).toPass({ timeout: 15000 });
	});
});
