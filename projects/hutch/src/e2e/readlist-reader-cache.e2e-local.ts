import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { readListingFromBrowser } from "./readlist-listing-cache.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const COMPUTED_AT = "2026-07-10T09:20:00.000Z";

const CreatedUser = z.union([
	z.object({ ok: z.literal(true), userId: z.string() }),
	z.object({ ok: z.literal(false), reason: z.string() }),
]);

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	const created = CreatedUser.parse(await response.json());
	assert(created.ok, `the e2e user fixture must create ${email}`);
	return created.userId;
}

async function seedSettledArticle(page: Page, input: { url: string; userId: string }): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.url,
			title: "Reader Cache Post",
			content: "<p>Seeded article body for the reader browser-cache test.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: input.userId,
			generatedSummary: { summary: "A concise summary.", excerpt: "Lead line." },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the settled article");

	const related = await page.request.post(`${BASE_URL}/e2e/seed-related-articles`, {
		data: {
			userId: input.userId,
			sourceUrl: input.url,
			related: [{ url: "https://example.com/reader-cache-related", reason: "Same topic" }],
			computedAt: COMPUTED_AT,
		},
	});
	assert.equal(related.status(), 201, "the related seed endpoint must settle the Next-read slot");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

test.describe("Reader view browser cache", () => {
	test("serves a repeat read of a settled reader from the browser's own cache", async ({ page }, testInfo) => {
		const email = `reader-cache-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const url = `https://example.com/reader-cache-${testInfo.workerIndex}-${Date.now()}`;
		const userId = await createOwner(page, email);
		await seedSettledArticle(page, { url, userId });
		await loginAs(page, email);
		await page.context().unrouteAll({ behavior: "ignoreErrors" });

		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		const href = await page.locator("[data-test-article-title]").first().getAttribute("href");
		assert(href, "the queue card must link into the reader");
		const parsed = new URL(href, BASE_URL);
		assert(parsed.searchParams.get("v"), "the reader link must carry a content version");
		const readerUrl = `${BASE_URL}${href}`;
		const permalink = `${BASE_URL}${parsed.pathname}`;

		const cold = await page.evaluate(readListingFromBrowser, readerUrl);
		expect(cold.status).toBe(200);
		expect(cold.transferSize).toBeGreaterThan(0);

		const repeat = await page.evaluate(readListingFromBrowser, readerUrl);
		expect(repeat.status).toBe(200);
		expect(repeat.transferSize).toBe(0);

		const unversioned = await page.evaluate(readListingFromBrowser, permalink);
		expect(unversioned.status).toBe(200);
		expect(unversioned.transferSize).toBeGreaterThan(0);
	});
});
