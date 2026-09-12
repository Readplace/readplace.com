import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { measuredBox, test, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TLDR = "dan@tldr.tech";
const BREW = "crew@morningbrew.com";
const KALE = "kale@hackernewsletter.com";
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const INBOX_PICKER = "[data-test-gmail-inbox-picker]";
const RESULTS = "[data-test-gmail-sender-results]";

async function openGmail(page: Page, stamp: string, enhanced = true): Promise<void> {
	const email = `gmail-picker-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, { data: { email, password: PASSWORD, verified: true } });
	assert.equal(created.status(), 201);
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, { data: {
		userId, state: "filtering", senders: [{ email: TLDR, place: "mapped" }],
		discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW, name: "Morning Brew" }, { email: KALE, name: "Hacker Newsletter" }],
	} });
	assert.equal(seeded.status(), 201);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/integrations`, { waitUntil: "domcontentloaded" });
	await page.locator('[data-test-integration="gmail"] [data-test-integration-action="manage"]').click();
	await expect(page.locator(SENDER_PICKER)).toBeVisible();
	if (enhanced) {
		await expect(page.locator(`${RESULTS} > input[form="gmail-sender-search-form"][name="discovery_after"]`)).toHaveCount(1);
		await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
	}
}

async function chooseSender(page: Page, email: string): Promise<void> {
	await page.locator(`${SENDER_PICKER} summary`).click();
	await page.locator(`[data-test-gmail-sender-option="${email}"]`).click();
	await expect(page.locator("#gmail-sender-choice")).toHaveText(email);
	await expect(page.locator(INBOX_PICKER)).toBeVisible();
}

test.describe("Gmail sender picker", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("automatically loads, searches, groups senders by inbox, excludes a sender and removes a mapping", async ({ page }, testInfo) => {
		const discoveryRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/integrations/gmail/discovery/start"));
		await openGmail(page, `group-${testInfo.workerIndex}-${Date.now()}`);
		await discoveryRequest;
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator("#gmail-sender-search")).toBeFocused();
		await page.locator("#gmail-sender-search").fill("Morning");
		await expect(page.locator("[data-test-gmail-sender-option]")).toHaveCount(1);
		await page.locator(`[data-test-gmail-sender-option="${BREW}"]`).click();
		await expect(page.locator("#gmail-sender-choice")).toHaveText(BREW);
		await page.locator(`${INBOX_PICKER} summary`).click();
		await page.locator('[data-test-gmail-destination-option]:not([data-test-gmail-destination-option="new"])').click();
		await page.locator("[data-test-gmail-save]").click();
		await expect(page.locator("[data-test-gmail-mapping]")).toHaveCount(1);
		await expect(page.locator("[data-test-gmail-mapped-sender]")).toHaveCount(2);
		await page.locator(`[data-test-gmail-exclude-sender="${BREW}"]`).click();
		await expect(page.locator("[data-test-gmail-mapped-sender]")).toHaveCount(1);
		await expect(page.locator(`[data-test-gmail-mapped-sender="${TLDR}"]`)).toBeVisible();
		await page.locator("[data-test-gmail-remove-mapping]").click();
		await expect(page.locator("[data-test-gmail-empty]")).toBeVisible();
	});

	test("preserves a new inbox name through discovery polling and supports keyboard dismissal", async ({ page }, testInfo) => {
		await openGmail(page, `new-${testInfo.workerIndex}-${Date.now()}`);
		await chooseSender(page, KALE);
		await page.locator(`${INBOX_PICKER} summary`).click();
		await page.locator('[data-test-gmail-destination-option="new"]').click();
		await page.locator("#gmail-inbox-name").fill("science");
		await page.waitForResponse((response) => response.url().includes("/integrations/gmail/senders?") && new URL(response.url()).searchParams.has("poll"));
		await expect(page.locator("#gmail-inbox-name")).toHaveValue("science");
		await expect(page.locator("#gmail-sender-choice")).toHaveText(KALE);
		await expect(page.locator("#gmail-destination-choice")).toHaveText("New inbox");
		await page.locator(`${SENDER_PICKER} summary`).focus();
		await page.keyboard.press("Enter");
		await expect(page.locator("#gmail-sender-search")).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(page.locator(`${SENDER_PICKER} summary`)).toBeFocused();
		await expect(page.locator(SENDER_PICKER)).not.toHaveAttribute("open");
		await page.locator("[data-test-gmail-save]").click();
		await expect(page.locator(`[data-test-gmail-mapped-sender="${KALE}"]`)).toBeVisible();
		await expect(page.locator("[data-test-gmail-mapping] h3")).toContainText(["tldr", "science"]);
	});

	test("keeps the searchable menu inside the page on narrow screens", async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 375, height: 800 });
		await openGmail(page, `mobile-${testInfo.workerIndex}-${Date.now()}`);
		await waitForBrandFonts(page, ["Inter"]);
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator(RESULTS)).toBeVisible();
		const picker = await measuredBox(page, SENDER_PICKER);
		const menu = await measuredBox(page, `${SENDER_PICKER} .gmail__picker-menu`);
		const search = await measuredBox(page, "#gmail-sender-search");
		assert.ok(menu.x >= 0 && menu.x + menu.width <= 375, "the menu must fit the viewport");
		assert.ok(menu.y >= picker.y, "the menu must open below the sender trigger");
		assert.ok(search.x >= menu.x && search.x + search.width <= menu.x + menu.width, "search must fit inside the menu");
	});
});

test.describe("Gmail sender picker without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	test("loads, searches and saves a sender through ordinary forms", async ({ page }, testInfo) => {
		await openGmail(page, `nojs-${testInfo.workerIndex}-${Date.now()}`, false);
		await page.locator("[data-test-gmail-load-senders] button").click();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("Hacker");
		await page.locator("#gmail-sender-search-form button").click();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator("[data-test-gmail-sender-option]")).toHaveCount(1);
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await page.locator(`${INBOX_PICKER} summary`).click();
		await page.locator('[data-test-gmail-destination-option="new"]').click();
		await page.locator("#gmail-inbox-name").fill("news");
		await page.locator("[data-test-gmail-save]").click();
		await expect(page.locator(`[data-test-gmail-mapped-sender="${KALE}"]`)).toBeVisible();
	});
});
