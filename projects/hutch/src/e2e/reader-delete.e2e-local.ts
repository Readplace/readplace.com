import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import {
	ARTICLE_TITLE,
	BASE_URL,
	CONFIRM,
	CONFIRM_CANCEL,
	CONFIRM_DELETE,
	CONFIRM_NEVER,
	FALLBACK,
	MENU,
	MENU_DELETE,
	MENU_DELETE_FALLBACK,
	MENU_PANEL,
	MENU_TOGGLE,
	OPEN_CONFIRM,
	TARGETED_FALLBACK,
	createReader,
	createReadlist,
	fileInto,
	login,
	openMenu,
	openReader,
	seedArticle,
	withoutPopoverSupport,
} from "./reader-delete-fixture";
import { MACOS_CHROME_USER_AGENT } from "./user-agents";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function stampOf(label: string, workerIndex: number): string {
	return `${label}-${workerIndex}-${Date.now()}`;
}

async function listedArticleIds(page: Page): Promise<(string | null)[]> {
	return page
		.locator("[data-test-article-list] .readlist-article")
		.evaluateAll((cards) => cards.map((card) => card.getAttribute("data-test-article")));
}

async function duplicateIds(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
		return ids.filter((id, index) => ids.indexOf(id) !== index);
	});
}

async function savedIds(page: Page): Promise<(string | null)[]> {
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	return (await listedArticleIds(page)).sort();
}

test.describe("Deleting from the reader", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, userAgent: MACOS_CHROME_USER_AGENT });

	test("dismissing the confirmation keeps the article and the reading position", async ({ page }, testInfo) => {
		const reader = await createReader(page, stampOf("dismiss", testInfo.workerIndex));
		const { articleId } = await seedArticle(page, { reader, slug: stampOf("dismiss", testInfo.workerIndex) });
		await login(page, reader);
		await openReader(page, { articleId });
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

		await openMenu(page);
		await page.click(MENU_DELETE);
		await page.waitForSelector(OPEN_CONFIRM);
		await expect(page.locator(CONFIRM_CANCEL)).toBeFocused();
		const scrollBeforeDismiss = await page.evaluate(() => window.scrollY);
		await page.keyboard.press("Escape");

		await expect(page.locator(OPEN_CONFIRM)).toHaveCount(0);
		await expect(page).toHaveURL(`${BASE_URL}/queue/${articleId}/view`);
		await expect(page.locator("body.page-reader")).toHaveCount(1);
		expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeDismiss);
		expect(await duplicateIds(page)).toEqual([]);
	});

	test("a confirmed deletion lands at the top of the readlist the article was opened from", async ({ page }, testInfo) => {
		const reader = await createReader(page, stampOf("return", testInfo.workerIndex));
		const kept = await seedArticle(page, { reader, slug: stampOf("kept", testInfo.workerIndex), title: "Kept" });
		const removed = await seedArticle(page, { reader, slug: stampOf("removed", testInfo.workerIndex) });
		await login(page, reader);
		const work = await createReadlist(page, "Work");
		await fileInto(page, { articleId: kept.articleId, readlist: work });
		await fileInto(page, { articleId: removed.articleId, readlist: work });

		await page.goto(`${BASE_URL}/queue?queue=${work}&order=asc`, { waitUntil: "domcontentloaded" });
		await page.click(`[data-test-article="${removed.articleId}"] [data-test-article-title]`);
		await page.waitForSelector(`body.page-reader ${MENU}`);
		await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
		await openMenu(page);
		await page.click(MENU_DELETE);
		await page.click(CONFIRM_DELETE);

		await page.waitForSelector("body.page-readlist");
		await expect(page).toHaveURL(`${BASE_URL}/queue?queue=${work}&order=asc`);
		expect(await listedArticleIds(page)).toEqual([kept.articleId]);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);

		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		expect((await listedArticleIds(page)).sort()).toEqual([kept.articleId, removed.articleId].sort());
	});

	test("don't ask again from the reader silences the list's confirmation", async ({ page }, testInfo) => {
		const reader = await createReader(page, stampOf("ack-reader", testInfo.workerIndex));
		const first = await seedArticle(page, { reader, slug: stampOf("ack-first", testInfo.workerIndex) });
		const second = await seedArticle(page, { reader, slug: stampOf("ack-second", testInfo.workerIndex), title: "Second" });
		await login(page, reader);
		await openReader(page, { articleId: first.articleId });

		await openMenu(page);
		await page.click(MENU_DELETE);
		await page.click(CONFIRM_NEVER);
		await page.waitForSelector("body.page-readlist");

		expect(await listedArticleIds(page)).toEqual([second.articleId]);
		await expect(page.locator(CONFIRM)).toHaveCount(0);
		await page.click(`[data-test-article="${second.articleId}"] [data-test-action="article-menu"]`);
		await page.click(`[data-test-article="${second.articleId}"] [data-test-action="delete"]`);
		await expect(page.locator(`[data-test-article="${second.articleId}"]`)).toHaveCount(0);
	});

	test("don't ask again from the list lets the reader delete straight from its menu", async ({ page }, testInfo) => {
		const reader = await createReader(page, stampOf("ack-list", testInfo.workerIndex));
		const first = await seedArticle(page, { reader, slug: stampOf("list-first", testInfo.workerIndex) });
		const second = await seedArticle(page, { reader, slug: stampOf("list-second", testInfo.workerIndex), title: "Second" });
		await login(page, reader);
		await page.click(`[data-test-article="${first.articleId}"] [data-test-action="article-menu"]`);
		await page.click(`[data-test-article="${first.articleId}"] [data-test-action="delete"]`);
		await page.click(CONFIRM_NEVER);
		await expect(page.locator(`[data-test-article="${first.articleId}"]`)).toHaveCount(0);

		await openReader(page, { articleId: second.articleId });
		await expect(page.locator(CONFIRM)).toHaveCount(0);
		await openMenu(page);
		await page.click(MENU_DELETE);

		await page.waitForSelector("body.page-readlist");
		expect(await listedArticleIds(page)).toEqual([]);
	});

	test("a second Enter after opening the question lands on Cancel and keeps the article", async ({ page }, testInfo) => {
		const reader = await createReader(page, stampOf("enter", testInfo.workerIndex));
		const { articleId } = await seedArticle(page, { reader, slug: stampOf("enter", testInfo.workerIndex) });
		await login(page, reader);
		await openReader(page, { articleId });

		await page.focus(MENU_TOGGLE);
		await page.keyboard.press("Enter");
		await page.locator(MENU_DELETE).focus();
		await page.keyboard.press("Enter");
		await page.waitForSelector(OPEN_CONFIRM);
		await expect(page.locator(CONFIRM_CANCEL)).toBeFocused();
		await page.keyboard.press("Enter");

		await expect(page.locator(OPEN_CONFIRM)).toHaveCount(0);
		await expect(page).toHaveURL(`${BASE_URL}/queue/${articleId}/view`);
		expect(await savedIds(page)).toEqual([articleId]);
	});

	test("a click outside the question dismisses it and keeps the article", async ({ page }, testInfo) => {
		const reader = await createReader(page, stampOf("light", testInfo.workerIndex));
		const { articleId } = await seedArticle(page, { reader, slug: stampOf("light", testInfo.workerIndex) });
		await login(page, reader);
		await openReader(page, { articleId });

		await openMenu(page);
		await page.click(MENU_DELETE);
		await page.waitForSelector(OPEN_CONFIRM);
		await page.mouse.click(4, 4);

		await expect(page.locator(OPEN_CONFIRM)).toHaveCount(0);
		expect(await savedIds(page)).toEqual([articleId]);
	});

	test("tapping Cancel on a phone keeps the article and the app's reader open", async ({ page }, testInfo) => {
		await page.setViewportSize(PHONE);
		const reader = await createReader(page, stampOf("phone-cancel", testInfo.workerIndex));
		const { articleId } = await seedArticle(page, { reader, slug: stampOf("phone-cancel", testInfo.workerIndex) });
		await login(page, reader);
		await openReader(page, { articleId, query: "?platform=ios" });

		await openMenu(page);
		await page.click(MENU_DELETE);
		await page.click(CONFIRM_CANCEL);

		await expect(page.locator(OPEN_CONFIRM)).toHaveCount(0);
		await expect(page).toHaveURL(`${BASE_URL}/queue/${articleId}/view?platform=ios`);
		await expect(page.locator("body.page-reader")).toHaveCount(1);
		expect(await savedIds(page)).toEqual([articleId]);
	});

	test.describe("without native popovers", () => {
		test("the menu reaches the question in the page, and Cancel returns to the menu without a request", async ({ page }, testInfo) => {
			const reader = await createReader(page, stampOf("fallback-cancel", testInfo.workerIndex));
			const { articleId } = await seedArticle(page, { reader, slug: stampOf("fallback-cancel", testInfo.workerIndex) });
			await login(page, reader);
			await withoutPopoverSupport(page);
			await openReader(page, { articleId, query: "?queue=all" });
			await expect(page.locator(FALLBACK)).toBeHidden();
			await expect(page.locator(MENU_DELETE)).toBeHidden();

			const requests: string[] = [];
			page.on("request", (request) => requests.push(request.url()));
			await openMenu(page);
			await page.click(MENU_DELETE_FALLBACK);

			const section = page.locator(TARGETED_FALLBACK);
			await expect(section).toBeVisible();
			await expect(section).toContainText(ARTICLE_TITLE);
			await expect(page.locator(`${MENU}[open]`)).toHaveCount(0);
			await expect(page).toHaveURL(`${BASE_URL}/queue/${articleId}/view?queue=all#confirm-remove-${articleId}`);
			await page.keyboard.press("Tab");
			await expect(section.locator('[data-test-action="delete-fallback-cancel"]')).toBeFocused();
			await page.keyboard.press("Enter");

			await expect(page.locator(TARGETED_FALLBACK)).toHaveCount(0);
			await expect(page.locator(FALLBACK)).toBeHidden();
			await expect(page).toHaveURL(`${BASE_URL}/queue/${articleId}/view?queue=all#reader-article-menu`);
			expect(requests.filter((url) => !url.startsWith("data:"))).toEqual([]);

			await page.goBack();
			await expect(page.locator(TARGETED_FALLBACK)).toBeVisible();
			await page.goForward();
			await expect(page.locator(TARGETED_FALLBACK)).toHaveCount(0);
			expect(requests.filter((url) => !url.startsWith("data:"))).toEqual([]);
			expect(await savedIds(page)).toEqual([articleId]);
		});

		test("a deep link to the question shows it, and only an explicit submit deletes", async ({ page }, testInfo) => {
			const reader = await createReader(page, stampOf("fallback-delete", testInfo.workerIndex));
			const kept = await seedArticle(page, { reader, slug: stampOf("fallback-kept", testInfo.workerIndex), title: "Kept" });
			const removed = await seedArticle(page, { reader, slug: stampOf("fallback-removed", testInfo.workerIndex) });
			await login(page, reader);
			await withoutPopoverSupport(page);

			await page.goto(`${BASE_URL}/queue/${removed.articleId}/view#confirm-remove-${removed.articleId}`, { waitUntil: "domcontentloaded" });
			await expect(page.locator(TARGETED_FALLBACK)).toBeVisible();
			expect(await savedIds(page)).toEqual([kept.articleId, removed.articleId].sort());

			await page.goto(`${BASE_URL}/queue/${removed.articleId}/view#confirm-remove-${removed.articleId}`, { waitUntil: "domcontentloaded" });
			await page.click(`${TARGETED_FALLBACK} [data-test-action="delete-fallback-confirm"]`);
			await page.waitForSelector("body.page-readlist");
			expect(await listedArticleIds(page)).toEqual([kept.articleId]);

			await openReader(page, { articleId: kept.articleId });
			await expect(page.locator(FALLBACK)).toHaveCount(1);
		});

		test("skipping future questions from the in-page question makes a later card delete direct", async ({ page }, testInfo) => {
			const reader = await createReader(page, stampOf("fallback-never", testInfo.workerIndex));
			const first = await seedArticle(page, { reader, slug: stampOf("fallback-first", testInfo.workerIndex) });
			const second = await seedArticle(page, { reader, slug: stampOf("fallback-second", testInfo.workerIndex), title: "Second" });
			await login(page, reader);
			await withoutPopoverSupport(page);
			await openReader(page, { articleId: first.articleId });

			await openMenu(page);
			await page.click(MENU_DELETE_FALLBACK);
			await page.click(`${TARGETED_FALLBACK} [data-test-action="delete-fallback-never"]`);
			await page.waitForSelector("body.page-readlist");

			expect(await listedArticleIds(page)).toEqual([second.articleId]);
			await expect(page.locator(FALLBACK)).toHaveCount(0);
			await page.click(`[data-test-article="${second.articleId}"] [data-test-action="article-menu"]`);
			await page.click(`[data-test-article="${second.articleId}"] [data-test-action="delete"]`);
			await expect(page.locator(`[data-test-article="${second.articleId}"]`)).toHaveCount(0);
		});

		test("a card's question opens and cancels in place at 320px", async ({ page }, testInfo) => {
			await page.setViewportSize({ width: 320, height: 640 });
			const reader = await createReader(page, stampOf("fallback-card", testInfo.workerIndex));
			const { articleId } = await seedArticle(page, {
				reader,
				slug: stampOf("fallback-card", testInfo.workerIndex),
				title: "A very long article title that has to wrap several times inside the in-page question at 320 pixels",
			});
			await login(page, reader);
			await withoutPopoverSupport(page);
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			const card = `[data-test-article="${articleId}"]`;

			await page.click(`${card} [data-test-action="article-menu"]`);
			await page.click(`${card} [data-test-action="delete-fallback"]`);
			const section = page.locator(TARGETED_FALLBACK);
			await expect(section).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
			for (const action of ["delete-fallback-cancel", "delete-fallback-confirm", "delete-fallback-never"]) {
				const box = await section.locator(`[data-test-action="${action}"]`).boundingBox();
				assert.ok(box, `${action} must be laid out`);
				expect(box.height).toBeGreaterThanOrEqual(44);
				expect(box.x + box.width).toBeLessThanOrEqual(320);
			}
			await section.locator('[data-test-action="delete-fallback-cancel"]').click();

			await expect(page.locator(TARGETED_FALLBACK)).toHaveCount(0);
			await expect(page.locator(`${card} [data-test-action="article-menu"]`)).toBeFocused();
			await page.click(`${card} [data-test-action="article-menu"]`);
			await expect(page.locator(FALLBACK)).toBeHidden();
			expect(await listedArticleIds(page)).toEqual([articleId]);
		});
	});

	test("Share and Download open from the menu on a phone, and the download follows a crawl that finishes while the menu is open", async ({
		page,
	}, testInfo) => {
		await page.setViewportSize(PHONE);
		const reader = await createReader(page, stampOf("compact", testInfo.workerIndex));
		const { articleId, url } = await seedArticle(page, { reader, slug: stampOf("compact", testInfo.workerIndex) });
		const pending = await page.request.post(`${BASE_URL}/e2e/seed-crawl-status`, { data: { url, status: "pending" } });
		assert.equal(pending.status(), 201, "the crawl must move back to pending");
		await login(page, reader);
		await page.route(`**/queue/${articleId}/view`, async (route) => {
			const response = await route.fetch();
			const body = (await response.text()).replace(
				'id="reader-menu-downloads-slot" class="article-body__menu-slot article-body__menu-slot--visible"',
				'id="reader-menu-downloads-slot" class="article-body__menu-slot article-body__menu-slot--hidden"',
			);
			await route.fulfill({ response, body });
		});
		await openReader(page, { articleId });

		await openMenu(page);
		await expect(page.locator(`${MENU_PANEL} #reader-menu-downloads-slot`)).toHaveClass(/article-body__menu-slot--hidden/);
		const ready = await page.request.post(`${BASE_URL}/e2e/seed-crawl-status`, { data: { url, status: "ready" } });
		assert.equal(ready.status(), 201, "the crawl must move to ready");

		await expect(page.locator(`${MENU_PANEL} [data-test-menu-download="epub"]`)).toBeVisible({ timeout: 20_000 });
		await expect(page.locator(`${MENU}[open]`)).toHaveCount(1);
		expect(await duplicateIds(page)).toEqual([]);
		await page.click(`${MENU_PANEL} [data-test-action="menu-share-open"]`);
		await expect(page.locator('[data-test-confirm-popover="share"]:popover-open')).toBeVisible();
	});

	test("the public reader keeps its own toolbar and offers no deletion", async ({ page }, testInfo) => {
		await page.setViewportSize(PHONE);
		const reader = await createReader(page, stampOf("public", testInfo.workerIndex));
		const { url } = await seedArticle(page, { reader, slug: stampOf("public", testInfo.workerIndex) });
		const publicPath = `/view/${url.replace(/^https:\/\//, "")}`;

		await page.goto(`${BASE_URL}${publicPath}`, { waitUntil: "domcontentloaded" });

		await expect(page.locator('.article-body__actions--top [data-test-action="share-open"]')).toBeVisible();
		await expect(page.locator(`${MENU}, ${CONFIRM}, .article-delete__form`)).toHaveCount(0);
	});
});

test.describe("Deleting from the reader without JavaScript", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, javaScriptEnabled: false });

	test("the native menu and confirmation still post the deletion", async ({ page }, testInfo) => {
		const reader = await createReader(page, stampOf("no-js", testInfo.workerIndex));
		const kept = await seedArticle(page, { reader, slug: stampOf("no-js-kept", testInfo.workerIndex), title: "Kept" });
		const removed = await seedArticle(page, { reader, slug: stampOf("no-js-removed", testInfo.workerIndex) });
		await login(page, reader);
		await page.goto(`${BASE_URL}/queue/${removed.articleId}/view?tab=queue&order=asc`, { waitUntil: "domcontentloaded" });

		await page.click('[data-test-action="reader-menu"]');
		await page.click(MENU_DELETE);
		await page.click(CONFIRM_DELETE);

		await page.waitForURL(`${BASE_URL}/queue?order=asc`);
		expect(await listedArticleIds(page)).toEqual([kept.articleId]);
	});
});
