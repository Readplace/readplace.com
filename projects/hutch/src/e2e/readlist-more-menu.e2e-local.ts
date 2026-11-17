import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const READLISTS = 8;
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

const SURFACES = [
	{ name: "More popover", viewport: { width: 1366, height: 650 }, opener: '[data-test-action="more-readlists"]', popover: '[data-test-readlist-popover="more"]' },
	{ name: "phone sheet", viewport: { width: 390, height: 844 }, opener: '[data-test-action="readlist-sheet"]', popover: '[data-test-readlist-popover="sheet"]' },
];

async function signInWithReadlists(page: Page, stamp: string): Promise<void> {
	const email = `readlist-more-menu-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, { data: { email, password: PASSWORD } });
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	CreatedUser.parse(await created.json());
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	for (let made = 1; made <= READLISTS; made++) {
		const response = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: `Readlist ${made}` } });
		assert.equal(response.status(), 200, "a readlist under the cap must be created");
	}
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-readlist");
}

for (const surface of SURFACES) {
	test.describe(`Readlist options in the ${surface.name}`, () => {
		test.use({ viewport: surface.viewport });

		test("every entry's options panel shows all of its items", async ({ page }, testInfo) => {
			await signInWithReadlists(page, `${testInfo.workerIndex}-${Date.now()}`);
			await page.locator(surface.opener).click();
			const popover = page.locator(surface.popover);
			await expect(popover).toBeVisible();
			const menus = popover.locator("[data-test-readlist-menu]");
			const count = await menus.count();
			expect(count).toBeGreaterThan(0);

			for (let index = 0; index < count; index++) {
				const menu = menus.nth(index);
				await menu.locator('[data-test-action="readlist-menu"]').click();
				await expect(menu).toHaveAttribute("open", "");
				const clippedItems = () => menu.evaluate((details) =>
					Array.from(details.querySelectorAll<HTMLElement>(".menu__item"))
						.filter((item) => item.checkVisibility())
						.filter((item) => {
							const box = item.getBoundingClientRect();
							const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
							return hit === null || !item.contains(hit);
						})
						.map((item) => item.textContent?.trim() ?? ""),
				);
				await expect.poll(clippedItems, { message: `entry ${index + 1}'s options must not be clipped` }).toEqual([]);
				await menu.locator('[data-test-action="readlist-menu"]').click();
				await expect(menu).not.toHaveAttribute("open", "");
			}
		});
	});
}
