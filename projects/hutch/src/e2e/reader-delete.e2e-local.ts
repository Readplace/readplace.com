import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import {
	BASE_URL,
	CONFIRM,
	CONFIRM_DELETE,
	CONFIRM_NEVER,
	MENU,
	MENU_DELETE,
	MENU_PANEL,
	OPEN_CONFIRM,
	createReader,
	createReadlist,
	fileInto,
	login,
	openMenu,
	openReader,
	seedArticle,
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
		await expect(page.locator(CONFIRM_DELETE)).toBeFocused();
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
