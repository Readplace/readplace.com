import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { MACOS_CHROME_USER_AGENT } from "./user-agents";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const CONTENT_FETCHED_AT = "2026-04-27T08:00:00.000Z";
const POLL_SETTLE_MS = 20_000;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function seedReader(page: Page, stamp: string, titles: readonly string[]): Promise<string> {
	const email = `bulk-everywhere-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, { data: { email, password: PASSWORD, verified: true } });
	assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
	const { userId } = CreatedUser.parse(await created.json());
	for (const [index, title] of titles.entries()) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: { url: `https://example.com/bulk-everywhere-${stamp}-${index}`, title, content: "<p>Seeded for the bulk read journey.</p>",
				contentFetchedAt: CONTENT_FETCHED_AT, savedByUserId: userId },
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the saved article");
	}
	return email;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login?return=%2Fqueue`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function createReadlist(page: Page, label: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label }, maxRedirects: 0 });
	const slug = new URL(created.headers().location ?? "", BASE_URL).searchParams.get("queue");
	assert(slug, `creating ${label} must land on its readlist`);
	return slug;
}

async function articleIdTitled(page: Page, title: string): Promise<string> {
	await page.goto(`${BASE_URL}/queue`);
	const href = await page.locator("[data-test-article-title]", { hasText: title }).getAttribute("href");
	const id = href && new URL(href, BASE_URL).pathname.split("/").find(segment => /^[0-9a-f]{32,}$/.test(segment));
	assert(id, `the card titled ${title} must link to its reader`);
	return id;
}

async function fileInto(page: Page, id: string, slug: string): Promise<void> {
	const filed = await page.request.post(`${BASE_URL}/queue/${id}/assign`, { form: { queue: slug }, maxRedirects: 0 });
	assert(filed.status() < 400, "filing the article must succeed");
}

async function titlesOn(page: Page, path: string): Promise<string[]> {
	await page.goto(`${BASE_URL}${path}`);
	return page.locator("[data-test-article-title]").allTextContents();
}

const count = (page: Page, label: string) => page.locator("main dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");

test.describe("Marking selected articles read in every readlist", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 320, height: 800 }, userAgent: MACOS_CHROME_USER_AGENT });

	test("marks one article read in All, Weekend and Work while polling, and keeps the full action name visible at 320px", async ({ page }, testInfo) => {
		const email = await seedReader(page, `js-${testInfo.workerIndex}-${Date.now()}`, ["Shared reading", "Unrelated reading"]);
		await loginAs(page, email);
		const lists = [await createReadlist(page, "Weekend"), await createReadlist(page, "Work")];
		for (const title of ["Shared reading", "Unrelated reading"]) {
			const id = await articleIdTitled(page, title);
			for (const slug of lists) await fileInto(page, id, slug);
		}
		await page.request.post(`${BASE_URL}/e2e/hold-next-bulk-run`, { data: { email } });

		await page.goto(`${BASE_URL}/queue?q=Shared`);
		await page.locator("details.readlist__manage > summary").click();
		await page.locator("form[action*='/manage/preview'] summary.menu__toggle").click();
		const action = page.locator("button[value=read-everywhere]");
		await expect(action).toBeVisible();
		await expect(action).toHaveAccessibleName("Mark as read in every readlist");
		const geometry = await action.evaluate((button) => {
			const text = button.firstChild;
			if (!text?.textContent) throw new Error("the action button must hold its label as text");
			const whole = document.createRange();
			whole.selectNodeContents(button);
			const tail = document.createRange();
			const start = text.textContent.indexOf("in every readlist");
			tail.setStart(text, start);
			tail.setEnd(text, start + "in every readlist".length);
			const panel = button.closest(".menu__panel")?.getBoundingClientRect();
			if (!panel) throw new Error("the action must sit in the menu panel");
			const box = (rect: DOMRect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
			return { whole: box(whole.getBoundingClientRect()), tail: [...tail.getClientRects()].map(box), panel: box(panel),
				viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: button.scrollWidth - button.clientWidth };
		});
		expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
		expect(geometry.overflow).toBeLessThanOrEqual(0);
		for (const rect of [geometry.whole, ...geometry.tail]) {
			expect(rect.left).toBeGreaterThanOrEqual(Math.max(0, geometry.panel.left));
			expect(rect.right).toBeLessThanOrEqual(Math.min(geometry.viewport, geometry.panel.right));
		}
		expect(geometry.tail.length).toBeGreaterThan(0);

		await action.click();
		await expect(page.locator("main.bulk-status [role=status]")).toHaveText("Ready to confirm");
		await expect(page.locator("main.bulk-status p").first()).toHaveText(/^Mark as read in every readlist\s*$/);
		await expect(count(page, "Selected")).toHaveText("1");
		await page.locator("main.bulk-status form button").click();
		await expect(page.locator("main.bulk-status [role=status]")).toHaveText("Applying changes");
		const released = await page.request.post(`${BASE_URL}/e2e/release-bulk-run`, { data: { email } });
		assert.equal(released.status(), 204, "the held run must be released");
		await expect(page.locator("main.bulk-status [role=status]")).toHaveText("Finished", { timeout: POLL_SETTLE_MS });
		await expect(count(page, "Completed")).toHaveText("1");

		expect(await titlesOn(page, "/queue?tab=done")).toEqual(["Shared reading"]);
		expect(await titlesOn(page, "/queue")).toEqual(["Unrelated reading"]);
		for (const slug of lists) {
			expect(await titlesOn(page, `/queue?queue=${slug}&tab=done`)).toEqual(["Shared reading"]);
			expect(await titlesOn(page, `/queue?queue=${slug}`)).toEqual(["Unrelated reading"]);
		}
	});
});

test.describe("Marking articles read in every readlist without client JavaScript", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 320, height: 800 }, javaScriptEnabled: false, userAgent: MACOS_CHROME_USER_AGENT });

	test("reaches the action by keyboard and follows Refresh progress to Finished", async ({ page }, testInfo) => {
		const email = await seedReader(page, `no-js-${testInfo.workerIndex}-${Date.now()}`, ["Keyboard reading"]);
		await loginAs(page, email);
		const slug = await createReadlist(page, "Weekend");
		await fileInto(page, await articleIdTitled(page, "Keyboard reading"), slug);
		await page.request.post(`${BASE_URL}/e2e/hold-next-bulk-run`, { data: { email } });

		await page.goto(`${BASE_URL}/queue`);
		const manage = page.locator("details.readlist__manage > summary");
		await manage.focus();
		await manage.press("Enter");
		const toggle = page.locator("form[action*='/manage/preview'] summary.menu__toggle");
		await toggle.focus();
		await toggle.press("Enter");
		const action = page.locator("button[value=read-everywhere]");
		await action.focus();
		await action.press("Enter");
		await page.waitForSelector("main.bulk-status");
		await expect(page.locator("main.bulk-status [role=status]")).toHaveText("Ready to confirm");
		const confirm = page.locator("main.bulk-status form button");
		await confirm.focus();
		await confirm.press("Enter");
		await expect(page.locator("main.bulk-status [role=status]")).toHaveText("Applying changes");
		await page.request.post(`${BASE_URL}/e2e/release-bulk-run`, { data: { email } });
		const refresh = page.locator("main.bulk-status a[href*='content=refresh']");
		await refresh.focus();
		await refresh.press("Enter");
		await expect(page.locator("main.bulk-status [role=status]")).toHaveText("Finished");
		expect(await titlesOn(page, `/queue?queue=${slug}&tab=done`)).toEqual(["Keyboard reading"]);
	});
});
