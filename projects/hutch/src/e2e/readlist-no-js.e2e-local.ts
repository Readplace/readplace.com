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

	test("moving an article works as plain form submits", async ({ page }, testInfo) => {
		const email = await seedArticle(page, `${testInfo.workerIndex}-${Date.now()}-move`);
		await loginAs(page, email);
		const articleId = await page.locator("[data-test-article]").first().getAttribute("data-test-article");
		assert(articleId, "the seeded article must be listed");
		const slugs: string[] = [];
		for (const label of ["Weekend", "Finance"]) {
			const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label } });
			assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
			const slug = new URL(created.url()).searchParams.get("queue");
			assert(slug, "creating a readlist must land the reader on it");
			slugs.push(slug);
		}
		const [weekend, finance] = slugs;
		const filed = await page.request.post(`${BASE_URL}/queue/${articleId}/assign`, {
			form: { queue: weekend, returnTo: "/queue" },
		});
		assert.equal(filed.status(), 200, "filing the article into a readlist must land back on the listing");

		await page.goto(`${BASE_URL}/queue?queue=${weekend}`, { waitUntil: "domcontentloaded" });
		await page.locator(`[data-test-article="${articleId}"] [data-test-action="article-menu"]`).click();
		await page.locator(`[data-test-article="${articleId}"] [data-test-action="move"]`).click();
		const dialog = page.locator(`#readlist-move-${articleId}`);
		await expect(dialog).toBeVisible();
		await dialog.locator(`input[name="to"][value="${finance}"]`).check();
		await Promise.all([
			page.waitForNavigation({ waitUntil: "domcontentloaded" }),
			dialog.locator('[data-test-action="move-confirm"]').click(),
		]);

		await expect(page.locator("body.page-readlist")).toBeVisible({ timeout: SETTLE_MS });
		await expect(page.locator("[data-test-toast-message]")).toHaveText("Moved to Finance");
		await expect(page.locator("[data-test-article]")).toHaveCount(0);
		await page.goto(`${BASE_URL}/queue?queue=${finance}`, { waitUntil: "domcontentloaded" });
		await expect(page.locator(`[data-test-article="${articleId}"]`)).toHaveCount(1, { timeout: SETTLE_MS });
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

	test("a purpose is set and deleted as plain form submits", async ({ page }, testInfo) => {
		const email = await seedArticle(page, `${testInfo.workerIndex}-${Date.now()}-purpose`);
		await loginAs(page, email);
		const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: "Weekend" } });
		assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
		const slug = new URL(created.url()).searchParams.get("queue");
		assert(slug, "creating a readlist must land the reader on it");
		await page.goto(`${BASE_URL}/queue/queues/${slug}/preferences?feature=pref`, { waitUntil: "domcontentloaded" });
		const preferences = page.locator("[data-test-readlist-preferences]");
		await expect(preferences).toHaveAttribute("data-test-preferences-state", "unset");

		await page.locator('[data-test-action="readlist-preferences-setup"]').click();
		const wizard = page.locator('[data-test-confirm-popover="readlist-preferences"]');
		await expect(wizard).toBeVisible();
		await wizard.locator('[data-test-field="purpose"]').fill("Essays on how teams ship software.");
		await Promise.all([
			page.waitForNavigation({ waitUntil: "domcontentloaded" }),
			wizard.locator('[data-test-action="readlist-preferences-save"]').click(),
		]);
		await expect(preferences).toHaveAttribute("data-test-preferences-state", "set", { timeout: SETTLE_MS });
		await expect(page.locator("[data-test-preferences-purpose]")).toHaveText("Essays on how teams ship software.");

		await page.locator('[data-test-action="readlist-preferences-menu"]').click();
		await page.locator('[data-test-action="readlist-preferences-delete"]').click();
		const confirm = page.locator('[data-test-confirm-popover="readlist-purpose-delete"]');
		await expect(confirm).toBeVisible();
		await Promise.all([
			page.waitForNavigation({ waitUntil: "domcontentloaded" }),
			confirm.locator('[data-test-action="readlist-purpose-delete-confirm"]').click(),
		]);
		await expect(preferences).toHaveAttribute("data-test-preferences-state", "unset", { timeout: SETTLE_MS });
		await expect(page.locator('[data-test-confirm-popover="readlist-preferences"] [data-test-field="purpose"]')).toHaveValue("");
	});

	test("the readlist switcher opens, creates a readlist from the dialog as a plain form submit, and switches readlist with no script", async ({ page }, testInfo) => {
		const email = await seedArticle(page, `${testInfo.workerIndex}-${Date.now()}-switcher`);
		await loginAs(page, email);
		const switcher = page.locator("main [data-test-readlist-switcher]");
		const toggle = page.locator('main [data-test-action="readlist-switcher"]');

		await toggle.click();
		await expect(switcher).toHaveJSProperty("open", true);
		await page.locator('main [data-test-action="new-readlist"]').click();
		const dialog = page.locator('[data-test-confirm-popover="readlist-create"]');
		await expect(dialog).toBeVisible();
		await dialog.locator('input[name="label"]').fill("New Readlist");
		await dialog.locator('[data-test-action="readlist-create-save"]').click();
		await page.waitForSelector("body.page-readlist");
		await expect(toggle).toContainText("New Readlist", { timeout: SETTLE_MS });
		await expect(page.locator('main [data-test-readlist][aria-current="page"]')).toHaveText("New Readlist");
		await expect(switcher).toHaveJSProperty("open", false);

		await toggle.click();
		await page.locator('main [data-test-readlist="default"]').click();
		await expect(toggle).toContainText("All", { timeout: SETTLE_MS });
		await expect(switcher).toHaveJSProperty("open", false);
	});

	test("the search and the filter drawer work as plain GET forms with no script", async ({ page }, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}-discovery`;
		const email = `readlist-no-js-${stamp}@example.com`;
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email, password: PASSWORD, verified: true },
		});
		assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
		const { userId } = CreatedUser.parse(await created.json());
		const articles = {
			shortRead: { url: `https://example.com/deep-work-${stamp}`, title: "Deep work in practice", wordCount: 700 },
			longerRead: { url: `https://example.com/deep-sea-${stamp}`, title: "Deep sea field notes", wordCount: 1900 },
			unrelated: { url: `https://example.com/budgeting-${stamp}`, title: "Budgeting for a sabbatical", wordCount: 1900 },
		};
		for (const article of Object.values(articles)) {
			const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
				data: {
					...article,
					content: "<p>Seeded so the search and the filters have rows to narrow.</p>",
					contentFetchedAt: CONTENT_FETCHED_AT,
					savedByUserId: userId,
				},
			});
			assert.equal(seeded.status(), 201, "the seed endpoint must create the saved article");
		}
		await loginAs(page, email);
		const listedUrls = () =>
			page
				.locator("[data-test-article] [data-test-article-url]")
				.evaluateAll((links) => links.map((link) => link.getAttribute("href")).sort());
		await expect.poll(listedUrls).toEqual(Object.values(articles).map((article) => article.url).sort());

		const search = page.locator('[data-test-form="readlist-search"] input[name="q"]');
		await search.fill("deep");
		await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), search.press("Enter")]);
		await expect(page.locator("body.page-readlist")).toBeVisible({ timeout: SETTLE_MS });
		expect(new URL(page.url()).searchParams.get("q")).toBe("deep");
		await expect(search).toHaveValue("deep");
		expect(await listedUrls()).toEqual([articles.longerRead.url, articles.shortRead.url].sort());

		await page.locator('[data-test-action="open-discovery-filters"]').click();
		const drawer = page.locator("[data-test-discovery-drawer]");
		await expect(drawer).toBeVisible();
		await drawer.locator('[data-test-discovery-option="time:5-10"]').click();
		await expect(drawer.locator('input[name="time"][value="5-10"]')).toBeChecked();
		await Promise.all([
			page.waitForNavigation({ waitUntil: "domcontentloaded" }),
			drawer.locator('[data-test-action="apply-discovery-filters"]').click(),
		]);

		await expect(page.locator("body.page-readlist")).toBeVisible({ timeout: SETTLE_MS });
		const applied = new URL(page.url()).searchParams;
		expect(applied.get("q")).toBe("deep");
		expect(applied.getAll("time")).toEqual(["5-10"]);
		expect(await listedUrls()).toEqual([articles.longerRead.url]);
		await expect(drawer).toBeHidden();
	});
});
