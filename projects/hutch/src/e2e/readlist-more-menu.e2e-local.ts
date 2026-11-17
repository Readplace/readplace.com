import assert from "node:assert/strict";
import type { Locator, Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const READLISTS = 8;
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

interface Surface {
	name: string;
	viewport: { width: number; height: number };
	opener?: string;
	container: string;
}

const SURFACES: Surface[] = [
	{ name: "rail", viewport: { width: 1366, height: 650 }, container: "[data-test-readlist-rail]" },
	{ name: "More popover", viewport: { width: 1366, height: 650 }, opener: '[data-test-action="more-readlists"]', container: '[data-test-readlist-popover="more"]' },
	{ name: "phone sheet", viewport: { width: 390, height: 844 }, opener: '[data-test-action="readlist-sheet"]', container: '[data-test-readlist-popover="sheet"]' },
];

async function signIn(page: Page, stamp: string): Promise<string> {
	const email = `readlist-more-menu-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, { data: { email, password: PASSWORD, verified: true } });
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	return userId;
}

async function signInWithReadlists(page: Page, stamp: string): Promise<void> {
	await signIn(page, stamp);
	for (let made = 1; made <= READLISTS; made++) {
		const response = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: `Readlist ${made}` } });
		assert.equal(response.status(), 200, "a readlist under the cap must be created");
	}
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-readlist");
}

function clippedItems(menu: Locator): Promise<string[]> {
	return menu.evaluate((details) =>
		Array.from(details.querySelectorAll<HTMLElement>(".menu__item"))
			.filter((item) => item.checkVisibility())
			.filter((item) => {
				const box = item.getBoundingClientRect();
				const x = box.left + box.width / 2;
				return [box.top + 2, box.top + box.height / 2, box.bottom - 2].some((y) => {
					const hit = document.elementFromPoint(x, y);
					return hit === null || !item.contains(hit);
				});
			})
			.map((item) => item.textContent?.trim() ?? ""),
	);
}

const CARD_VIEWPORTS = [
	{ width: 1366, height: 650 },
	{ width: 390, height: 844 },
];

for (const viewport of CARD_VIEWPORTS) {
	test.describe(`Article options on a readlist card at ${viewport.width}px`, () => {
		test.use({ viewport });

		test("a lone card without an excerpt shows all of its options", async ({ page }, testInfo) => {
			const stamp = `card-${testInfo.workerIndex}-${Date.now()}`;
			const userId = await signIn(page, stamp);
			const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
				data: {
					url: `https://example.com/readlist-more-menu/${stamp}`,
					title: "A lone card without an excerpt",
					content: "<p>Seeded body for the readlist article menu test.</p>",
					contentFetchedAt: "2026-07-10T09:14:00.000Z",
					savedAt: "2026-07-10T09:15:00.000Z",
					savedByUserId: userId,
					excerpt: "",
				},
			});
			assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
			SeededArticle.parse(await seeded.json());
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			await page.waitForSelector("body.page-readlist");
			await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

			const menus = page.locator("[data-test-article-menu]");
			await expect(menus).toHaveCount(1);
			const menu = menus.first();
			await menu.locator('[data-test-action="article-menu"]').click();
			await expect(menu).toHaveAttribute("open", "");
			await expect.poll(() => clippedItems(menu), { message: "the card's options must not be clipped" }).toEqual([]);
		});
	});
}

for (const surface of SURFACES) {
	test.describe(`Readlist options in the ${surface.name}`, () => {
		test.use({ viewport: surface.viewport });

		test("every entry's options panel shows all of its items", async ({ page }, testInfo) => {
			await signInWithReadlists(page, `${testInfo.workerIndex}-${Date.now()}`);
			if (surface.opener !== undefined) await page.locator(surface.opener).click();
			const container = page.locator(surface.container);
			await expect(container).toBeVisible();
			const menus = container.locator("[data-test-readlist-menu]");
			const count = await menus.count();
			expect(count).toBeGreaterThan(0);

			for (let index = 0; index < count; index++) {
				const menu = menus.nth(index);
				await menu.locator('[data-test-action="readlist-menu"]').click();
				await expect(menu).toHaveAttribute("open", "");
				await expect.poll(() => clippedItems(menu), { message: `entry ${index + 1}'s options must not be clipped` }).toEqual([]);
				await menu.locator('[data-test-action="readlist-menu"]').click();
				await expect(menu).not.toHaveAttribute("open", "");
			}
		});
	});
}
