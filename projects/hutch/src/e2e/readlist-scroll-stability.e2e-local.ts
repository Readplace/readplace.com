import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { nameNewReadlist, openAddLink, openReadlistSwitcher } from "./page-interactions";
import { readScrollY } from "./readlist-reader-skeleton.browser";
import { maxScrollY, recordScrollAfterSwap, scrollUnderHeader } from "./readlist-scroll-stability.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const SAVED_ARTICLES = 24;
const ALREADY_READ = 6;
const VIEWPORTS = [
	{ width: 390, height: 844 },
	{ width: 1280, height: 720 },
];
const RAIL_MIN_WIDTH = 1024;
const CREATE_SAVE = '[data-test-action="readlist-create-save"]';
const CREATE_ERROR = "[data-test-readlist-create-error]";
const ALERT_TITLE = '[data-test-alert="readlist"] [data-test-alert-title]';
const READER_CREATE = '[data-test-confirm-popover="readlist-create"]';
const READER_SCROLL_PX = 40;
const ADD_LINK_SAVE = '#add-link [data-test-action="add-link-save"]';

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function seedQueue(page: Page, stamp: string): Promise<string> {
	const email = `readlist-scroll-stability-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	for (let index = 0; index < SAVED_ARTICLES; index++) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://go.dev/blog/scroll-stability-${index}?${stamp}`,
				title: `Scroll stability ${index}`,
				content: "<p>Seeded body for the readlist scroll-stability test.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedAt: new Date(Date.UTC(2026, 6, 1, 9, index)).toISOString(),
				savedByUserId: userId,
				excerpt: "Seeded excerpt for the scroll-stability test.",
				generatedSummary: { summary: "Seeded summary body.", excerpt: "" },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	}
	return email;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function cardIds(page: Page): Promise<string[]> {
	return page
		.locator("article.readlist-article")
		.evaluateAll((cards) => cards.map((card) => card.getAttribute("data-test-article") ?? ""));
}

async function openToReadListing(page: Page, stamp: string): Promise<string[]> {
	await loginAs(page, await seedQueue(page, stamp));
	for (const id of (await cardIds(page)).slice(0, ALREADY_READ)) {
		const marked = await page.request.post(`${BASE_URL}/queue/${id}/status`, {
			form: { status: "read" },
		});
		assert.equal(marked.status(), 200, "marking a card read must be accepted");
	}
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
	await expect(page.locator("article.readlist-article")).toHaveCount(SAVED_ARTICLES - ALREADY_READ);
	return cardIds(page);
}

async function openReader(page: Page, stamp: string): Promise<void> {
	const email = `reader-scroll-stability-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://go.dev/blog/reader-scroll-stability?${stamp}`,
			title: "Reader scroll stability",
			content: Array.from(
				{ length: 30 },
				(_, index) => `<p>Paragraph ${index} of the reader scroll-stability article.</p>`,
			).join(""),
			contentFetchedAt: "2026-07-10T09:14:00.000Z",
			savedByUserId: userId,
			generatedSummary: { summary: "Seeded summary body.", excerpt: "" },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
}

async function openCreateDialog(page: Page, viewport: { width: number }, name: string): Promise<void> {
	if (viewport.width < RAIL_MIN_WIDTH) await openReadlistSwitcher(page);
	await nameNewReadlist(page, name);
}

async function pressFromMidPage(page: Page, swap: { scrollTarget: string; control: string }): Promise<number> {
	await page.evaluate(scrollUnderHeader, swap.scrollTarget);
	const before = await page.evaluate(readScrollY);
	expect(before).toBeGreaterThan(0);
	await page.evaluate(recordScrollAfterSwap, swap.control);
	const box = await page.locator(swap.control).boundingBox();
	assert(box, `${swap.control} must be laid out to be clicked`);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	return before;
}

async function expectSwapKeepsScroll(
	page: Page,
	swap: { scrollTarget: string; control: string; arrived: () => Promise<void> },
): Promise<void> {
	const before = await pressFromMidPage(page, swap);
	await swap.arrived();
	await expect(page.locator("html")).toHaveAttribute("data-test-scroll-after-swap", String(before));
	expect(before).toBeLessThan(await page.evaluate(maxScrollY));
}

for (const viewport of VIEWPORTS) {
	test.describe(`Readlist swaps keep the reader's place at ${viewport.width}px`, () => {
		test.use({ viewport, timezoneId: "UTC" });

		test("switching to the Read tab keeps the page where it was instead of jumping to the bottom", async ({
			page,
		}, testInfo) => {
			await openToReadListing(page, `${testInfo.workerIndex}-${Date.now()}`);
			await expectSwapKeepsScroll(page, {
				scrollTarget: "[data-test-filters]",
				control: '[data-test-filter="read"]',
				arrived: () =>
					expect(page.locator('[data-test-filter="read"][aria-current="page"]')).toHaveCount(1),
			});
		});

		test("reversing the sort order keeps the page where it was instead of jumping to the bottom", async ({
			page,
		}, testInfo) => {
			const ids = await openToReadListing(page, `${testInfo.workerIndex}-${Date.now()}`);
			const oldest = ids.at(-1);
			assert(oldest, "the listing must render cards to sort");
			await expectSwapKeepsScroll(page, {
				scrollTarget: "[data-test-sort]",
				control: "[data-test-sort]",
				arrived: () =>
					expect(page.locator("article.readlist-article").first()).toHaveAttribute(
						"data-test-article",
						oldest,
					),
			});
		});

		test("applying a filter from the drawer keeps the page where it was", async ({ page }, testInfo) => {
			await openToReadListing(page, `${testInfo.workerIndex}-${Date.now()}`);
			const drawer = "[data-test-discovery-drawer]";
			await page.click('[data-test-action="open-discovery-filters"]');
			await page.click(`${drawer} [data-test-discovery-option="saved:month"]`);
			await expectSwapKeepsScroll(page, {
				scrollTarget: "[data-test-sort]",
				control: `${drawer} [data-test-action="apply-discovery-filters"]`,
				arrived: () =>
					expect(
						page.locator('[data-test-action="open-discovery-filters"].readlist-discovery__filter--active'),
					).toBeVisible(),
			});
		});

		test("marking a card read keeps the page where it was instead of scrolling to the toast", async ({
			page,
		}, testInfo) => {
			const ids = await openToReadListing(page, `${testInfo.workerIndex}-${Date.now()}`);
			const card = `[data-test-article="${ids[1]}"]`;
			await expectSwapKeepsScroll(page, {
				scrollTarget: card,
				control: `${card} [data-test-action="mark-read"]`,
				arrived: () => expect(page.locator(card)).toHaveCount(0),
			});
		});

		test("refusing a readlist name keeps the page where it was", async ({ page }, testInfo) => {
			const ids = await openToReadListing(page, `${testInfo.workerIndex}-${Date.now()}`);
			await openCreateDialog(page, viewport, "All");
			await expectSwapKeepsScroll(page, {
				scrollTarget: `[data-test-article="${ids[Math.floor(ids.length / 2)]}"]`,
				control: CREATE_SAVE,
				arrived: () =>
					expect(page.locator(CREATE_ERROR)).toHaveText(
						"Pick a name other than All, the readlist that holds every save.",
					),
			});
		});

		test("creating a readlist from a card's Add keeps the page where it was", async ({ page }, testInfo) => {
			const ids = await openToReadListing(page, `${testInfo.workerIndex}-${Date.now()}`);
			const articleId = ids[Math.floor(ids.length / 2)];
			const card = `[data-test-article="${articleId}"]`;
			const dialog = `#readlist-create-move-${articleId}`;
			await page.click(`${card} [data-test-action="article-menu"]`);
			await page.click(`${card} [data-test-action="move"]`);
			await page.waitForSelector(`${dialog}:popover-open`);
			await page.locator(`${dialog} input[name="label"]`).fill("Finance");

			await expectSwapKeepsScroll(page, {
				scrollTarget: card,
				control: `${dialog} [data-test-action="readlist-create-move-save"]`,
				arrived: () => expect(page.locator("#status-toast [data-test-toast-message]")).toHaveText("Added to Finance"),
			});
		});

		test("creating a readlist from the reader's Add keeps the page where it was", async ({ page }, testInfo) => {
			await openReader(page, `${testInfo.workerIndex}-${Date.now()}`);
			await page.click("summary[data-test-readlists-trigger]");
			await page.click('[data-test-action="readlist-create-open"]');
			await page.waitForSelector(`${READER_CREATE}:popover-open`);
			await page.locator(`${READER_CREATE} input[name="label"]`).fill("Deep Work");
			await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), READER_SCROLL_PX);
			expect(await page.evaluate(readScrollY)).toBe(READER_SCROLL_PX);

			const save = `${READER_CREATE} [data-test-action="readlist-create-save"]`;
			await page.evaluate(recordScrollAfterSwap, save);
			const box = await page.locator(save).boundingBox();
			assert(box, "the create dialog's save button must be laid out to be clicked");
			await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

			await expect(page.locator("#status-toast [data-test-toast-message]")).toHaveText("Added to Deep Work");
			await expect(page.locator("html")).toHaveAttribute(
				"data-test-scroll-after-swap",
				String(READER_SCROLL_PX),
			);
		});

		test("refusing a link in Add link keeps the page where it was", async ({ page }, testInfo) => {
			await page.context().addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
			const ids = await openToReadListing(page, `${testInfo.workerIndex}-${Date.now()}`);
			const form = await openAddLink(page);
			await form.locator('input[name="url"]').fill("https://server");

			await expectSwapKeepsScroll(page, {
				scrollTarget: `[data-test-article="${ids[Math.floor(ids.length / 2)]}"]`,
				control: ADD_LINK_SAVE,
				arrived: () => expect(page.locator("#add-link [data-test-save-error]")).toHaveText("Enter a valid article link."),
			});
			await expect(form.locator('input[name="url"]')).toHaveValue("https://server");
		});

		test("saving through Add link lands the page on the newest row", async ({ page }, testInfo) => {
			const stamp = `${testInfo.workerIndex}-${Date.now()}`;
			await page.context().addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
			const ids = await openToReadListing(page, stamp);
			const form = await openAddLink(page);
			await form.locator('input[name="url"]').fill(`${BASE_URL}/privacy?add-link-scroll=${stamp}`);

			await pressFromMidPage(page, {
				scrollTarget: `[data-test-article="${ids[Math.floor(ids.length / 2)]}"]`,
				control: ADD_LINK_SAVE,
			});

			await expect(page.locator("article.readlist-article")).toHaveCount(ids.length + 1);
			await expect(page.locator("#add-link:popover-open")).toHaveCount(0);
			await expect(page.locator("html")).toHaveAttribute("data-test-scroll-after-swap", /^\d+$/);
			const landed = await page.evaluate(() => {
				const card = document.querySelector("#latest-saved");
				if (!card) throw new Error("the save must land a #latest-saved row");
				return {
					top: card.getBoundingClientRect().top,
					padding: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
					atBottom: window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1,
				};
			});
			assert.ok(
				landed.atBottom || Math.abs(landed.top - landed.padding) <= 1,
				`the newest row must land at the top of the viewport, measured ${JSON.stringify(landed)}`,
			);
		});

		test("the readlist cap lands at the top like a page load", async ({ page }, testInfo) => {
			const ids = await openToReadListing(page, `${testInfo.workerIndex}-${Date.now()}`);
			for (let made = 1; made <= READLIST_MAX_PER_USER; made++) {
				const created = await page.request.post(`${BASE_URL}/queue/queues`, {
					form: { label: `Readlist ${made}` },
				});
				assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
			}
			await openCreateDialog(page, viewport, "One Too Many");

			await pressFromMidPage(page, {
				scrollTarget: `[data-test-article="${ids[Math.floor(ids.length / 2)]}"]`,
				control: CREATE_SAVE,
			});

			await expect(page.locator(ALERT_TITLE)).toHaveText("Readlist limit reached");
			await expect(page.locator("html")).toHaveAttribute("data-test-scroll-after-swap", "0");
		});
	});
}
