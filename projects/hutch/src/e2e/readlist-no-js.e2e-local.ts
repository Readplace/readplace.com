import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const CONTENT_FETCHED_AT = "2026-04-27T08:00:00.000Z";
const SETTLE_MS = 45000;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

test.describe("The readlist is whole without client JavaScript", () => {
	test.use({
		timezoneId: "UTC",
		viewport: { width: 758, height: 1024 },
		javaScriptEnabled: false,
	});

	async function seedArticle(page: Page, stamp: string): Promise<string> {
		const email = `readlist-no-js-${stamp}@example.com`;
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email, password: PASSWORD, verified: true },
		});
		assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
		const { userId } = CreatedUser.parse(await created.json());

		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/queue-no-js-${stamp}`,
				title: "A saved article",
				content: "<p>Seeded so the listing renders a card.</p>",
				contentFetchedAt: CONTENT_FETCHED_AT,
				savedByUserId: userId,
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the saved article");
		return email;
	}

	async function seedManyArticles(page: Page, stamp: string, count: number): Promise<string> {
		const email = `readlist-no-js-${stamp}@example.com`;
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email, password: PASSWORD, verified: true },
		});
		assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
		const { userId } = CreatedUser.parse(await created.json());
		for (let index = 0; index < count; index += 1) {
			const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
				data: {
					url: `https://example.com/queue-no-js-${stamp}-${index}`,
					title: `A saved article numbered ${index}`,
					content: "<p>Seeded so the listing spans more than one page.</p>",
					contentFetchedAt: CONTENT_FETCHED_AT,
					savedByUserId: userId,
				},
			});
			assert.equal(seeded.status(), 201, "the seed endpoint must create the saved article");
		}
		return email;
	}

	async function loginAs(page: Page, email: string): Promise<void> {
		await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
		await page.locator("#email").fill(email);
		await page.locator("#password").fill(PASSWORD);
		await page.locator('[data-test-form="login"] button[type="submit"]').click();
		await page.waitForSelector("body.page-readlist");
	}

	test("reading an article and marking it read work as plain form submits", async ({
		page,
	}, testInfo) => {
		const email = await seedArticle(
			page,
			`${testInfo.workerIndex}-${Date.now()}-flow`,
		);
		await loginAs(page, email);

		const readerHref = await page
			.locator("[data-test-article-title]")
			.first()
			.getAttribute("href");
		assert(readerHref, "a saved card must link to its own reader");
		const readerUrl = new URL(readerHref, BASE_URL);
		await page.goto(readerUrl.toString(), { waitUntil: "domcontentloaded" });
		await expect(page.locator("[data-test-reader-content]")).toBeVisible({ timeout: SETTLE_MS });
		await expect(page.locator("#reader-downloads-slot")).toHaveClass(
			"article-body__downloads-slot article-body__downloads-slot--visible",
		);

		// Server-rendered on the first navigation and reachable with no click:
		// the collapse from a <details> disclosure to a direct link is what this
		// asserts, on the one page that runs with scripting disabled.
		const epubHref = await page.locator('[data-test-download="epub"]').getAttribute("href");
		assert(epubHref, "a ready reader must offer an EPUB download link");
		const epubResponse = await page.request.get(new URL(epubHref, BASE_URL).toString());
		assert.equal(epubResponse.status(), 200, "the EPUB download must serve a file with no script");
		assert.ok(
			(epubResponse.headers()["content-type"] ?? "").includes("application/epub+zip"),
			"the EPUB download must be served as application/epub+zip",
		);

		await page.locator('[data-test-mark-read-form] button[type="submit"]').click();
		await page.waitForSelector("body.page-readlist");
		await expect(page.locator("[data-test-article]")).toHaveCount(0, { timeout: SETTLE_MS });

		await page.goto(`${BASE_URL}/queue?tab=done`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-action="mark-unread"]')).toHaveCount(1, {
			timeout: SETTLE_MS,
		});
	});

	test("a status toast's Undo works as a plain form submit", async ({ page }, testInfo) => {
		const email = await seedArticle(
			page,
			`${testInfo.workerIndex}-${Date.now()}-undo`,
		);
		await loginAs(page, email);

		const readerHref = await page.locator("[data-test-article-title]").first().getAttribute("href");
		assert(readerHref, "a saved card must link to its own reader");
		await page.goto(new URL(readerHref, BASE_URL).toString(), { waitUntil: "domcontentloaded" });
		await expect(page.locator("[data-test-reader-content]")).toBeVisible({ timeout: SETTLE_MS });

		await Promise.all([
			page.waitForNavigation({ waitUntil: "domcontentloaded" }),
			page.locator('[data-test-mark-read-form] button[type="submit"]').click(),
		]);
		await expect(page.locator("body.page-readlist")).toBeVisible({ timeout: SETTLE_MS });
		await expect(page.locator("[data-test-toast]")).toBeVisible();

		await Promise.all([
			page.waitForNavigation({ waitUntil: "domcontentloaded" }),
			page.locator("[data-test-toast-action]").click(),
		]);
		await expect(page.locator("body.page-readlist")).toBeVisible({ timeout: SETTLE_MS });
		await expect(page.locator("[data-test-article]")).toHaveCount(1, { timeout: SETTLE_MS });

		await page.goto(`${BASE_URL}/queue?tab=done`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-action="mark-unread"]')).toHaveCount(0, {
			timeout: SETTLE_MS,
		});
	});

	test("the listing count keeps its noun and shows no bar when the total is deferred", async ({
		page,
	}, testInfo) => {
		const email = await seedManyArticles(page, `${testInfo.workerIndex}-${Date.now()}-count`, 21);
		await loginAs(page, email);

		const noun = page.locator("#readlist-count [data-test-listing-count-noun]");
		await expect(noun).toHaveText("Saved Articles", { timeout: SETTLE_MS });

		const number = page.locator("#readlist-count [data-test-listing-count-number]");
		await expect(number).toBeEmpty();
		const box = await number.boundingBox();
		if (box) {
			assert.ok(
				box.width < 1,
				`with scripting off the number slot must draw no skeleton bar, measured ${box.width}`,
			);
		}
	});

	test("the nav opens and signs the reader out with no script", async ({ page }, testInfo) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		const email = await seedArticle(page, `${testInfo.workerIndex}-${Date.now()}-nav`);
		await loginAs(page, email);

		const menu = page.locator("#nav-menu");
		await expect(menu).toBeHidden();

		await page.locator(".nav__toggle").click();
		await expect(menu).toBeVisible({ timeout: SETTLE_MS });

		await page.locator('[data-test-nav-item="logout"]').click();
		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-form="login"]')).toBeVisible({ timeout: SETTLE_MS });
	});

	test("a trialing reader picks a plan and posts it with scripts off", async ({ page }, testInfo) => {
		const email = `readlist-no-js-${testInfo.workerIndex}-${Date.now()}-plans@example.com`;
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email, password: PASSWORD, verified: true },
		});
		assert.equal(created.status(), 201, "the e2e user fixture must create the reader");
		const { userId } = CreatedUser.parse(await created.json());
		const trialing = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
			data: { userId, state: "trialing" },
		});
		assert.equal(trialing.status(), 201, "the subscription-state seed endpoint must answer 201");
		await loginAs(page, email);
		const panel = page.locator('[data-test-confirm-popover="subscribe-plans"]');

		await page.locator('[data-test-action="subscribe-plans-open"]').click();
		await expect(panel).toBeVisible();
		await panel.locator('input[name="plan"][value="monthly"]').check();
		const [subscribe] = await Promise.all([
			page.waitForRequest("**/account/subscribe?*"),
			panel.locator('[data-test-action="subscribe-plans-submit"]').click(),
		]);

		expect(subscribe.method()).toBe("POST");
		expect(new URL(subscribe.url()).search).toBe(
			"?utm_source=queue-banner&utm_medium=internal&utm_content=choose-plan",
		);
		expect(subscribe.postData()).toBe("plan=monthly");
	});

	test("the readlist switcher opens and switches readlist with no script", async ({ page }, testInfo) => {
		const email = await seedArticle(page, `${testInfo.workerIndex}-${Date.now()}-switcher`);
		await loginAs(page, email);
		const switcher = page.locator("main [data-test-readlist-switcher]");
		const toggle = page.locator('main [data-test-action="readlist-switcher"]');

		await toggle.click();
		await expect(switcher).toHaveJSProperty("open", true);
		await page.locator('main [data-test-action="new-readlist"]').click();
		await page.waitForSelector("body.page-readlist");
		await expect(toggle).toContainText("New Readlist", { timeout: SETTLE_MS });
		await expect(switcher).toHaveJSProperty("open", false);

		await toggle.click();
		await page.locator('main [data-test-readlist="default"]').click();
		await expect(toggle).toContainText("All", { timeout: SETTLE_MS });
		await expect(switcher).toHaveJSProperty("open", false);
	});
});
