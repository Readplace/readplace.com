import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SITE = "[data-test-article-url]";
const READ_TIME = "[data-test-read-time]";
const SITE_NAME = "news.ycombinator.com";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await response.json()).userId;
}

async function seedCard(page: Page, params: { url: string; userId: string }): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: params.url,
			title: "A saved article with a long site name",
			content: "<p>Seeded body for the queue-card site-name measurement.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: params.userId,
			wordCount: 400,
			excerpt: "Seeded excerpt.",
			generatedSummary: { summary: "Seeded summary body.", excerpt: "" },
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-queue");
}

async function measureSite(
	page: Page,
): Promise<{ display: string; needed: number; painted: number }> {
	return page.locator(SITE).first().evaluate((el) => ({
		display: getComputedStyle(el).display,
		needed: el.scrollWidth,
		painted: el.clientWidth,
	}));
}

async function readTimeSeparator(page: Page): Promise<string> {
	return page
		.locator(READ_TIME)
		.first()
		.evaluate((el) => getComputedStyle(el, "::before").content);
}

test.describe("Queue card site name", () => {
	test.use({ timezoneId: "UTC" });

	test("drops the site name on a phone and seats it whole once the row has the width", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `queue-site-name-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		await seedCard(page, { url: `https://${SITE_NAME}/item?id=${stamp}`, userId });
		await loginAs(page, email);
		await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
		await expect(page.locator(SITE)).toHaveText(SITE_NAME);

		await page.setViewportSize({ width: 390, height: 844 });
		const phoneSite = await measureSite(page);
		const phoneSeparator = await readTimeSeparator(page);
		assert.equal(
			phoneSite.display,
			"none",
			"a phone-width row drops the site name rather than paint an ellipsis of it — the reader is where the source stays legible",
		);
		assert.equal(
			phoneSeparator,
			"none",
			"the read time leads the meta row once the site name is gone, so it must not carry the separator that divided the two",
		);

		await page.setViewportSize({ width: 900, height: 844 });
		const wideSite = await measureSite(page);
		const wideSeparator = await readTimeSeparator(page);
		assert.equal(wideSite.display, "block", "a row this wide still shows the site name");
		assert.equal(
			wideSite.painted,
			wideSite.needed,
			`the site name seats whole at this width — painted ${wideSite.painted}px of ${wideSite.needed}px`,
		);
		assert.equal(
			wideSeparator,
			'"·"',
			"the read time follows a visible site name here, so it carries the separator",
		);
	});
});
