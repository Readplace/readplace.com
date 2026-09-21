import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, measuredBox, test, waitForBrandFonts } from "@packages/e2e-harness";
import { formatTabCountLabel } from "@packages/web-shell";
import { requireEnv } from "@packages/require-env";
import { clickAndWaitForPageReload } from "./page-interactions";
import { neutraliseVolatileChrome } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const DESKTOP = { width: 1280, height: 900 };

const MAIN = "main.readlist";
const RAIL_LINK = `${MAIN} [data-test-readlist]`;
const DEFAULT_RAIL_LINK = '[data-test-readlist="default"]';
const ACTIVE_RAIL_LINK = `${MAIN} .readlist-nav__link--active`;
const ACTIVE_RAIL_LABEL = `${ACTIVE_RAIL_LINK} .readlist-nav__label`;
const READLIST_MENU = "[data-test-readlist-menu]";
const READLIST_MENU_TOGGLE = '[data-test-action="readlist-menu"]';
const RENAME_TRIGGER = '[data-test-action="readlist-rename"]';
const DELETE_TRIGGER = '[data-test-action="readlist-delete"]';
const RENAME_POPOVER = '[data-test-confirm-popover="readlist-rename"]';
const RENAME_INPUT = "[data-test-readlist-rename-input]";
const RENAME_SAVE = '[data-test-action="readlist-rename-save"]';
const RENAME_CANCEL = '[data-test-action="readlist-rename-cancel"]';
const RENAME_DISMISS = '[data-test-action="readlist-rename-dismiss"]';
const DELETE_DISMISS = '[data-test-action="readlist-delete-dismiss"]';
const CARD = "[data-test-article]";
const CARD_MENU = "[data-test-article-menu]";
const CARD_MENU_TOGGLE = '[data-test-action="article-menu"]';
const CARD_DELETE_TRIGGER = '[data-test-action="delete"]';
const CARD_DELETE_DISMISS = '[data-test-action="delete-dismiss"]';
const LISTING = `${MAIN} .readlist-listing`;
const UNREAD_TAB = `${MAIN} [data-test-filter="unread"]`;
const UNREAD_TAB_LABEL = `${UNREAD_TAB} span[id]`;
const READ_TAB = `${MAIN} [data-test-filter="read"]`;
const SORT_LINK = `${MAIN} [data-test-sort]`;
const ARTICLE_TITLE = `${MAIN} [data-test-article-title]`;

const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEEDED_ARTICLES = [
	{
		url: "https://example.com/rail-second",
		title: "The second article in the readlist",
		savedAt: "2026-07-11T09:14:00.000Z",
		excerpt: "A fixed excerpt for the rail behaviour run.",
	},
	{
		url: "https://example.com/rail-first",
		title: "The article at the top of the readlist",
		savedAt: "2026-07-12T09:14:00.000Z",
		excerpt: "A fixed excerpt for the rail behaviour run.",
	},
];

const VOLATILE_CHROME = [
	".trial-countdown",
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createUser(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await response.json()).userId;
}

async function createUserWithArticles(page: Page, email: string): Promise<void> {
	const userId = await createUser(page, email);
	for (const article of SEEDED_ARTICLES) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: article.url,
				title: article.title,
				content: "<p>Seeded body for the rail behaviour run.</p>",
				contentFetchedAt: SEEDED_FETCHED_AT,
				savedAt: article.savedAt,
				savedByUserId: userId,
				excerpt: article.excerpt,
				generatedSummary: { summary: "Seeded summary.", excerpt: article.excerpt },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	}
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openReadlist(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-readlist");
}

async function makeReadlist(page: Page): Promise<void> {
	await page.click('[data-test-action="new-readlist"]');
	await page.waitForFunction(() => new URL(window.location.href).searchParams.has("queue"));
}

async function openRenameDialog(page: Page): Promise<void> {
	await page.locator(READLIST_MENU_TOGGLE).first().click();
	await page.locator(RENAME_TRIGGER).first().click();
	await page.waitForSelector(`${RENAME_POPOVER}:popover-open`);
}

async function renameTo(page: Page, name: string): Promise<void> {
	await openRenameDialog(page);
	await page.locator(RENAME_INPUT).first().fill(name);
	await clickAndWaitForPageReload(page, page.locator(RENAME_SAVE).first());
	await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText(name);
}

function renameableSlugs(page: Page): Promise<string[]> {
	return page.evaluate(
		([menu, trigger]) =>
			Array.from(document.querySelectorAll(menu))
				.filter((each) => each.querySelector(trigger) !== null)
				.map((each) => each.getAttribute("data-test-readlist-menu") ?? ""),
		[READLIST_MENU, RENAME_TRIGGER] as const,
	);
}

async function seededReadlistSettled(page: Page): Promise<void> {
	await expect(page.locator("[data-test-article]")).toHaveCount(SEEDED_ARTICLES.length);
	await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
	await expect(page.locator(UNREAD_TAB)).toHaveText(`To Read (${SEEDED_ARTICLES.length})`);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function holdCounts(page: Page): Promise<() => () => void> {
	let held: Promise<void> | undefined;
	await page.route("**/queue/counts*", async (route) => {
		if (held) await held;
		await route.continue();
	});
	return () => {
		const resolvers: Array<() => void> = [];
		held = new Promise<void>((resolve) => {
			resolvers.push(resolve);
		});
		const release = resolvers[0];
		assert.ok(release, "a promise executor runs synchronously, so its resolver must be captured");
		return () => {
			held = undefined;
			release();
		};
	};
}

async function holdListing(page: Page): Promise<() => Promise<void>> {
	const resolvers: Array<() => void> = [];
	const released = new Promise<void>((resolve) => {
		resolvers.push(resolve);
	});
	const release = resolvers[0];
	assert.ok(release, "a promise executor runs synchronously, so its resolver must be captured");
	let held = 0;
	await page.route(
		(url) => url.pathname === "/queue",
		async (route) => {
			held += 1;
			await released;
			await route.continue();
		},
	);
	return async () => {
		await expect
			.poll(() => held, {
				message: "the listing request must be waiting on the veil before it is released",
			})
			.toBe(1);
		release();
	};
}

test.describe("The readlists rail", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("stays on the readlist it was viewing after deleting another one", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-delete-other-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page);
		await makeReadlist(page);
		await expect(page.locator(RAIL_LINK)).toHaveCount(3);

		const menus = page.locator(READLIST_MENU);
		const other = menus.first();
		await other.locator(READLIST_MENU_TOGGLE).click();
		const trigger = other.locator(DELETE_TRIGGER);
		const popoverId = await trigger.getAttribute("popovertarget");
		assert.ok(popoverId, "the delete trigger must reference its confirmation popover");
		await trigger.click();
		const confirm = page.locator(`[id="${popoverId}"] [data-test-action="readlist-delete-confirm"]`);
		await expect(confirm).toBeVisible();
		await clickAndWaitForPageReload(page, confirm);

		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("New Readlist 2");
		await expect(page.locator(RAIL_LINK)).toHaveCount(2);
	});

	test("keeps the name when the reader backs out of the rename dialog", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-rename-cancel-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page);

		await openRenameDialog(page);
		await page.locator(RENAME_INPUT).first().fill("Work Reading");
		await page.locator(RENAME_CANCEL).first().click();

		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("New Readlist");
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("New Readlist");
	});

	test("lets the reader rename the same readlist again", async ({ page }, testInfo) => {
		const email = `readlist-rail-rename-twice-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page);

		await renameTo(page, "Work Reading");
		await renameTo(page, "Deep Work");

		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("Deep Work");
	});

	test("keeps the rename working after the listing has been swapped", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-rename-swap-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page);

		await page.click(READ_TAB);
		await expect(page.locator(READ_TAB)).toHaveAttribute("aria-current", "page");

		await renameTo(page, "Work Reading");
	});

	test("offers every readlist the reader made for renaming, and never the one they were given", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-rename-scope-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		assert.deepEqual(await renameableSlugs(page), []);

		await makeReadlist(page);
		const slug = new URL(page.url()).searchParams.get("queue");
		assert.ok(slug, "creating a readlist must land the reader on it");

		assert.deepEqual(await renameableSlugs(page), [slug]);
		await expect(page.locator(`${DEFAULT_RAIL_LINK} ${RENAME_TRIGGER}`)).toHaveCount(0);
	});
});

test.describe("Dismissing a menu dialog returns focus to the kebab that opened it", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("returns focus to the rail kebab after Edit and Delete are dismissed", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-focus-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page);

		const menu = page.locator(READLIST_MENU).first();
		const toggle = menu.locator(READLIST_MENU_TOGGLE);
		const summary = menu.locator("summary").first();

		await toggle.click();
		await menu.locator(RENAME_TRIGGER).click();
		await expect(page.locator(`${RENAME_POPOVER}:popover-open`)).toHaveCount(1);
		await page.keyboard.press("Escape");
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();

		await toggle.click();
		await menu.locator(RENAME_TRIGGER).click();
		await page.locator(RENAME_CANCEL).click();
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();

		await toggle.click();
		await menu.locator(RENAME_TRIGGER).click();
		await page.locator(RENAME_DISMISS).click();
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();

		await toggle.click();
		await menu.locator(DELETE_TRIGGER).click();
		await page.keyboard.press("Escape");
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();

		await toggle.click();
		await menu.locator(DELETE_TRIGGER).click();
		await page.locator(DELETE_DISMISS).click();
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();
	});

	test("returns focus to the card kebab after the delete dialog is dismissed", async ({
		page,
	}, testInfo) => {
		const email = `readlist-card-focus-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);

		const card = page.locator(CARD).first();
		const menu = card.locator(CARD_MENU);
		const toggle = menu.locator(CARD_MENU_TOGGLE);
		const summary = menu.locator("summary").first();
		const trigger = card.locator(CARD_DELETE_TRIGGER);
		const popoverId = await trigger.getAttribute("popovertarget");
		assert.ok(popoverId, "the card's delete trigger must reference its confirmation popover");
		const dismiss = page.locator(`[id="${popoverId}"] ${CARD_DELETE_DISMISS}`);

		await toggle.click();
		await trigger.click();
		await page.keyboard.press("Escape");
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();

		await toggle.click();
		await trigger.click();
		await dismiss.click();
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();
	});
});

test.describe("The readlist status tabs", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps the unread count on the tab while the counts request is in flight", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-count-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);

		await page.route("**/queue/counts*", (route) => route.abort());

		await page.locator(READ_TAB).click();
		await expect(page.locator(READ_TAB)).toHaveClass(/readlist-tabs__link--active/);
		await expect(page.locator(UNREAD_TAB)).toHaveText(`To Read (${SEEDED_ARTICLES.length})`);

		await page.locator(UNREAD_TAB).click();
		await expect(page.locator(UNREAD_TAB)).toHaveClass(/readlist-tabs__link--active/);
		await expect(page.locator(UNREAD_TAB)).toHaveText(`To Read (${SEEDED_ARTICLES.length})`);
	});

	test("never carries the previous readlist's count into the one the reader switched to", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-count-switch-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);
		const holdNextCounts = await holdCounts(page);

		const releaseMade = holdNextCounts();
		await makeReadlist(page);
		await expect(page.locator(UNREAD_TAB)).toHaveText("To Read (0)");
		releaseMade();
		await expect(page.locator(UNREAD_TAB)).toHaveText("To Read (0)");

		const releaseDefault = holdNextCounts();
		await page.click(DEFAULT_RAIL_LINK);
		await expect(page.locator(`${DEFAULT_RAIL_LINK}`)).toHaveClass(
			/readlist-nav__link--active/,
		);
		await expect(page.locator(UNREAD_TAB)).toHaveText(`To Read (${SEEDED_ARTICLES.length})`);
		releaseDefault();
	});

	test("reserves the unread tab's widest count from first paint", async ({ page }, testInfo) => {
		const email = `readlist-rail-reserve-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);
		await waitForBrandFonts(page, ["Inter"]);
		const counted = await measuredBox(page, UNREAD_TAB);

		await page.route("**/queue/counts*", (route) => route.abort());
		await openReadlist(page);
		await expect(page.locator(UNREAD_TAB)).toHaveText(`To Read (${SEEDED_ARTICLES.length})`);
		await waitForBrandFonts(page, ["Inter"]);
		const cold = await measuredBox(page, UNREAD_TAB);

		const widestLabel = formatTabCountLabel({ label: "To Read", count: Number.MAX_SAFE_INTEGER });
		await page.locator(UNREAD_TAB_LABEL).evaluate((label, text) => {
			label.textContent = text;
		}, widestLabel);
		const widest = await measuredBox(page, UNREAD_TAB);

		assert.equal(
			cold.width,
			counted.width,
			`the tab must open at the width it settles to, measured ${cold.width} then ${counted.width}`,
		);
		assert.equal(
			widest.width,
			counted.width,
			`the reserve must cover "${widestLabel}", measured ${widest.width} against ${counted.width}`,
		);
	});

	test("veils the rows the instant a status tab is pressed, and only until that tab's listing lands", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-veil-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);
		await waitForBrandFonts(page, ["Inter"]);

		const before = await measuredBox(page, LISTING);
		const release = await holdListing(page);
		await page.locator(READ_TAB).click();
		await expect(page.locator(`${LISTING}.htmx-request`)).toHaveCount(1);
		const during = await measuredBox(page, LISTING);
		assert.deepEqual(
			{ width: during.width, height: during.height },
			{ width: before.width, height: before.height },
			"the veil must keep the listing at the size it had before the press",
		);

		await release();
		await expect(page.locator(READ_TAB)).toHaveAttribute("aria-current", "page");
		await expect(page.locator(LISTING)).toHaveClass("readlist-listing");
	});

	test("keeps the rows in view while a sort request is in flight", async ({ page }, testInfo) => {
		const email = `readlist-rail-sort-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);

		const release = await holdListing(page);
		await page.locator(SORT_LINK).click();
		await expect(page.locator(`${SORT_LINK}.htmx-request`)).toHaveCount(1);
		await expect(page.locator(ARTICLE_TITLE).first()).toBeVisible();
		await release();
		await expect(page.locator(SORT_LINK)).toHaveText(/Oldest first/);
	});
});
