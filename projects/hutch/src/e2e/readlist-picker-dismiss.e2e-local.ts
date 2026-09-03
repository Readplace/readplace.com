import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-05-14T11:20:00.000Z";
const PICKER = ".article-body__readlists";
const TRIGGER = "[data-test-readlists-trigger]";
const CREATE_INPUT = "[data-test-readlist-create-name]";
const ARTICLE_COPY = "[data-test-reader-content] p";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openOwnerReaderWithPicker(page: Page, stamp: string): Promise<void> {
	const email = `picker-dismiss-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/picker-dismiss-${stamp}`,
			title: "Readlist Picker Dismiss",
			content: "<p>Body copy sitting behind the open picker.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());

	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");

	// A second readlist gives the picker something to offer, so it has a menu to
	// dismiss rather than only the create row.
	await page.click('[data-test-action="new-readlist"]');
	await expect(page.locator("[data-test-readlist]")).toHaveCount(2);

	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-reader");
}

function pickerIsOpen(page: Page): Promise<boolean> {
	return page.locator(PICKER).evaluate((picker) => picker.hasAttribute("open"));
}

test.describe("Add-to-readlist picker light dismiss", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 390, height: 780 } });

	test("a click outside closes it, a click inside leaves it open", async ({ page }, testInfo) => {
		await openOwnerReaderWithPicker(page, `${testInfo.workerIndex}-${Date.now()}`);

		await page.click(TRIGGER);
		expect(await pickerIsOpen(page)).toBe(true);

		// Typing a new readlist name must not dismiss the menu out from under it.
		await page.locator(CREATE_INPUT).click();
		expect(await pickerIsOpen(page)).toBe(true);

		await page.locator(ARTICLE_COPY).first().click({ position: { x: 4, y: 4 } });
		await expect
			.poll(() => pickerIsOpen(page))
			.toBe(false);
	});

	test("the trigger still toggles it shut on its own", async ({ page }, testInfo) => {
		await openOwnerReaderWithPicker(page, `toggle-${testInfo.workerIndex}-${Date.now()}`);

		await page.click(TRIGGER);
		expect(await pickerIsOpen(page)).toBe(true);

		await page.click(TRIGGER);
		await expect
			.poll(() => pickerIsOpen(page))
			.toBe(false);
	});
});
