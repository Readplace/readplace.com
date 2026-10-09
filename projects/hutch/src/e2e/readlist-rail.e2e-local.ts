import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import { expect, measuredBox, test, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import {
	clickAndWaitForPageReload,
	fileArticleIntoReadlist,
	nameNewReadlist,
	openReadlistSwitcher,
	renameableSlugs,
} from "./page-interactions";
import { neutraliseVolatileChrome } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const DESKTOP = { width: 1280, height: 900 };

const MAIN = "main.readlist";
const RAIL_LINK = `${MAIN} [data-test-readlist]`;
const DEFAULT_RAIL_LINK = '[data-test-readlist="default"]';
const ACTIVE_RAIL_LINK = `${MAIN} [data-test-readlist][aria-current="page"]`;
const ACTIVE_RAIL_LABEL = `${ACTIVE_RAIL_LINK} [data-test-readlist-label]`;
const SWITCHER = `${MAIN} [data-test-readlist-switcher]`;
const SWITCHER_TOGGLE = `${MAIN} [data-test-action="readlist-switcher"]`;
const NEW_READLIST = '[data-test-action="new-readlist"]';
const PHONE = { width: 390, height: 844 };
const READLIST_MENU = "[data-test-readlist-menu]";
const READLIST_MENU_TOGGLE = '[data-test-action="readlist-menu"]';
const RENAME_TRIGGER = '[data-test-action="readlist-rename"]';
const DELETE_TRIGGER = '[data-test-action="readlist-delete"]';
const RENAME_POPOVER = '[data-test-confirm-popover="readlist-rename"]';
const RENAME_INPUT = "[data-test-readlist-rename-input]";
const RENAME_SAVE = '[data-test-action="readlist-rename-save"]';
const RENAME_CANCEL = '[data-test-action="readlist-rename-cancel"]';
const RENAME_ERROR = "[data-test-readlist-rename-error]";
const DELETE_POPOVER = '[data-test-confirm-popover="readlist-delete"]';
const DELETE_CANCEL = '[data-test-action="readlist-delete-cancel"]';
const CREATE_POPOVER = '[data-test-confirm-popover="readlist-create"]';
const CREATE_CANCEL = '[data-test-action="readlist-create-cancel"]';
const CREATE_INPUT = "[data-test-readlist-create-input]";
const CREATE_SAVE = '[data-test-action="readlist-create-save"]';
const CREATE_ERROR = "[data-test-readlist-create-error]";
const COMMIT_LABEL = ".readlist-name-form__commit-label";
const COMMIT_LOADER = ".readlist-name-form__loader";
const LIVE_REGION = "#toast-live-region";
const SAME_DOCUMENT_MARK = "data-test-same-document";
const CARD = "[data-test-article]";
const CARD_MENU = "[data-test-article-menu]";
const CARD_MENU_TOGGLE = '[data-test-action="article-menu"]';
const CARD_DELETE_TRIGGER = '[data-test-action="delete"]';
const CARD_MOVE_TRIGGER = '[data-test-action="move"]';
const MOVE_CANCEL = '[data-test-action="move-cancel"]';
const LISTING = `${MAIN} .readlist-listing`;
const READ_TAB = `${MAIN} [data-test-filter="read"]`;
const SORT_LINK = `${MAIN} [data-test-sort]`;
const ARTICLE_TITLE = `${MAIN} [data-test-article-title]`;
const COUNT_NUMBER = `${MAIN} [data-test-listing-count-number]`;
const LISTING_COUNT = `${MAIN} [data-test-listing-count]`;
const LISTING_HEADER = `${MAIN} .readlist-listing__header`;
const HEADER_INSET_PX = 24;
const HEADER_GAP_PX = 12;

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
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

async function createUser(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await response.json()).userId;
}

async function createUserWithArticles(page: Page, email: string): Promise<string[]> {
	const userId = await createUser(page, email);
	const articleIds: string[] = [];
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
		articleIds.push(SeededArticle.parse(await seeded.json()).articleId);
	}
	return articleIds;
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

async function makeReadlist(page: Page, name: string): Promise<void> {
	await clickAndWaitForPageReload(page, await nameNewReadlist(page, name));
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

async function seededReadlistSettled(page: Page): Promise<void> {
	await expect(page.locator("[data-test-article]")).toHaveCount(SEEDED_ARTICLES.length);
	await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
	await expect(page.locator(LISTING_COUNT)).toHaveText(`${SEEDED_ARTICLES.length} Saved Articles`);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function holdRequests(
	page: Page,
	pathname: string,
): Promise<{ held: () => number; release: () => Promise<void> }> {
	const resolvers: Array<() => void> = [];
	const released = new Promise<void>((resolve) => {
		resolvers.push(resolve);
	});
	const release = resolvers[0];
	assert.ok(release, "a promise executor runs synchronously, so its resolver must be captured");
	let held = 0;
	await page.route(
		(url) => url.pathname === pathname,
		async (route) => {
			held += 1;
			await released;
			await route.continue();
		},
	);
	return {
		held: () => held,
		release: async () => {
			await expect
				.poll(() => held, { message: `the ${pathname} request must be held before it is released` })
				.toBe(1);
			release();
		},
	};
}

async function holdListing(page: Page): Promise<() => Promise<void>> {
	return (await holdRequests(page, "/queue")).release;
}

async function markDocument(page: Page): Promise<void> {
	await page.locator("html").evaluate((html, mark) => html.setAttribute(mark, ""), SAME_DOCUMENT_MARK);
}

async function expectCreateCommitBusy(page: Page): Promise<void> {
	const dialog = page.locator(`${CREATE_POPOVER}:popover-open`);
	const commit = dialog.locator(CREATE_SAVE);
	await expect(dialog.locator(COMMIT_LABEL)).toBeHidden();
	await expect(dialog.locator(COMMIT_LOADER)).toBeVisible();
	await expect(commit).toBeEnabled();
	await expect(commit).toHaveCSS("cursor", "progress");
	await commit.click();
	await dialog.locator(CREATE_INPUT).press("Enter");
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
		await makeReadlist(page, "New Readlist");
		await makeReadlist(page, "New Readlist 2");
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

	test("moves a readlist's articles to the readlist offered by default before deleting it", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-delete-move-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const [articleId] = await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page, "Ideas & Inspiration");
		await makeReadlist(page, "Finance");
		await expect(page.locator(RAIL_LINK)).toHaveCount(3);
		const [first, second] = await renameableSlugs(page);

		await fileArticleIntoReadlist(page, { articleId, readlistSlug: first });
		await openReadlist(page);

		const menu = page.locator(`[data-test-readlist-menu="${first}"]`);
		await menu.locator(READLIST_MENU_TOGGLE).click();
		await menu.locator(DELETE_TRIGGER).click();
		const panel = page.locator(`${DELETE_POPOVER}[data-test-confirm-subject="${first}"]:popover-open`);
		await expect(panel.locator(".confirm-popover__title")).toHaveText("Move or delete articles");
		await expect(panel.locator("[data-test-migrate-select]")).toHaveValue(second);

		await clickAndWaitForPageReload(page, panel.locator('[data-test-action="readlist-delete-confirm"]'));
		await clickAndWaitForPageReload(page, page.locator(`${MAIN} [data-test-readlist="${second}"]`));
		await expect(page.locator(ACTIVE_RAIL_LINK)).toHaveAttribute("data-test-readlist", second);

		await expect(page.locator(`[data-test-article="${articleId}"]`)).toHaveCount(1);
		await expect(page.locator(RAIL_LINK)).toHaveCount(2);
	});

	test("keeps the name when the reader backs out of the rename dialog", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-rename-cancel-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page, "New Readlist");

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
		await makeReadlist(page, "New Readlist");

		await renameTo(page, "Work Reading");
		await renameTo(page, "Deep Work");
		await expect(page.locator(LIVE_REGION)).toHaveText("Readlist renamed to Deep Work.");

		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("Deep Work");
	});

	test("refuses a blank rename in place and keeps what the reader typed", async ({ page }, testInfo) => {
		const email = `readlist-rail-rename-refused-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page, "New Readlist");
		const landedOn = page.url();

		await openRenameDialog(page);
		const dialog = page.locator(`${RENAME_POPOVER}:popover-open`);
		const field = dialog.locator(RENAME_INPUT);
		await field.fill("   ");
		await dialog.locator(RENAME_SAVE).click();

		await expect(dialog.locator(RENAME_ERROR)).toHaveText(
			`Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.`,
		);
		await expect(field).toHaveValue("   ");
		await expect(field).toHaveAttribute("aria-invalid", "true");
		await expect(field).toBeFocused();
		await expect(page).toHaveURL(landedOn);
		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("New Readlist");

		await markDocument(page);
		await field.fill("Work Reading");
		await clickAndWaitForPageReload(page, dialog.locator(RENAME_SAVE));

		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("Work Reading");
		await expect(page.locator("html")).toHaveAttribute(SAME_DOCUMENT_MARK, "");
	});

	test("keeps the rename working after the listing has been swapped", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-rename-swap-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page, "New Readlist");

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

		await makeReadlist(page, "New Readlist");
		const slug = new URL(page.url()).searchParams.get("queue");
		assert.ok(slug, "creating a readlist must land the reader on it");

		assert.deepEqual(await renameableSlugs(page), [slug]);
		await expect(page.locator(`${DEFAULT_RAIL_LINK} ${RENAME_TRIGGER}`)).toHaveCount(0);
	});
});

test.describe("The readlists rail on a desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("lists every readlist without opening anything, and hides the switcher summary", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-desktop-open-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await makeReadlist(page, "New Readlist");

		const nav = page.getByRole("navigation", { name: "Readlists" });
		await expect(nav.getByRole("link", { name: "All" })).toBeVisible();
		await expect(page.locator(SWITCHER_TOGGLE)).toBeHidden();

		await page.locator(ACTIVE_RAIL_LINK).focus();
		await page.keyboard.press("Tab");
		await expect(page.locator(`${MAIN} ${READLIST_MENU_TOGGLE}`).first()).toBeFocused();
	});

	test("keeps the selected row's tint and on-tint ink when the pointer rests on it", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-selected-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		const tokens = await page.evaluate(() => {
			const probe = document.createElement("span");
			document.body.append(probe);
			probe.style.color = "var(--primary-text-on-tint)";
			probe.style.backgroundColor = "var(--secondary)";
			const style = getComputedStyle(probe);
			const resolved = { ink: style.color, tint: style.backgroundColor };
			probe.remove();
			return resolved;
		});
		const row = page.locator(ACTIVE_RAIL_LINK).locator("xpath=..");
		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveCSS("color", tokens.ink);
		await page.locator(ACTIVE_RAIL_LINK).hover();
		await expect(row).toHaveCSS("background-color", tokens.tint);
	});
});

test.describe("The readlist switcher on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("folds the rail into one closed row that opens onto every readlist and switches", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await expect(page.locator(SWITCHER)).toHaveJSProperty("open", false);
		await expect(page.locator(SWITCHER_TOGGLE)).toContainText("All");
		await expect(page.locator(`${MAIN} ${NEW_READLIST}`)).toBeHidden();

		await openReadlistSwitcher(page);
		await expect(page.locator(RAIL_LINK)).toHaveCount(1);
		await expect(page.locator(`${MAIN} ${NEW_READLIST}`)).toBeVisible();
		await makeReadlist(page, "New Readlist");
		await expect(page.locator(SWITCHER)).toHaveJSProperty("open", false);

		await openReadlistSwitcher(page);
		await expect(page.locator(RAIL_LINK)).toHaveCount(2);
		await clickAndWaitForPageReload(page, page.locator(DEFAULT_RAIL_LINK));
		await expect(page.locator(SWITCHER)).toHaveJSProperty("open", false);
		await expect(page.locator(SWITCHER_TOGGLE)).toContainText("All");

		await openReadlistSwitcher(page);
		await clickAndWaitForPageReload(page, page.locator(`${RAIL_LINK}:not(${DEFAULT_RAIL_LINK})`));
		await expect(page.locator(SWITCHER)).toHaveJSProperty("open", false);
		await expect(page.locator(SWITCHER_TOGGLE)).toContainText("New Readlist");
	});
});

test.describe("Creating a readlist from the rail", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("names the readlist in the dialog and lands on it", async ({ page }, testInfo) => {
		const email = `readlist-rail-create-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await makeReadlist(page, "Ideas & Inspiration");

		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("Ideas & Inspiration");
		await expect(page.locator(RAIL_LINK)).toHaveCount(2);
	});

	test("refuses a reserved name in place and keeps what the reader typed", async ({ page }, testInfo) => {
		const email = `readlist-rail-create-refused-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		const landedOn = page.url();

		await (await nameNewReadlist(page, "All")).click();

		const dialog = page.locator(`${CREATE_POPOVER}:popover-open`);
		const field = dialog.locator(CREATE_INPUT);
		await expect(dialog.locator(CREATE_ERROR)).toHaveText(
			"Pick a name other than All, the readlist that holds every save.",
		);
		await expect(field).toHaveValue("All");
		await expect(field).toHaveAttribute("aria-invalid", "true");
		await expect(field).toBeFocused();
		await expect(page).toHaveURL(landedOn);
		await expect(page.locator(RAIL_LINK)).toHaveCount(1);

		await markDocument(page);
		await field.fill("Ideas & Inspiration");
		await clickAndWaitForPageReload(page, dialog.locator(CREATE_SAVE));

		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("Ideas & Inspiration");
		await expect(page.locator("html")).toHaveAttribute(SAME_DOCUMENT_MARK, "");
	});

	test("keeps the create commit busy until the new readlist replaces the page", async ({ page }, testInfo) => {
		const email = `readlist-rail-create-busy-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		const creation = await holdRequests(page, "/queue/queues");

		await (await nameNewReadlist(page, "Ideas & Inspiration")).click();
		await expect.poll(creation.held).toBe(1);
		await expectCreateCommitBusy(page);

		const listing = await holdRequests(page, "/queue");
		await creation.release();
		await expect.poll(listing.held).toBe(1);
		await expectCreateCommitBusy(page);
		expect(creation.held()).toBe(1);

		await listing.release();
		await expect(page.locator(ACTIVE_RAIL_LABEL)).toHaveText("Ideas & Inspiration");
		expect(creation.held()).toBe(1);

		await page.goBack();
		await expect(page.locator(ACTIVE_RAIL_LINK)).toHaveAttribute("data-test-readlist", "default");
		await page.click(NEW_READLIST);
		const reopened = page.locator(`${CREATE_POPOVER}:popover-open`);
		await expect(reopened.locator(COMMIT_LABEL)).toBeVisible();
		await expect(reopened.locator(COMMIT_LOADER)).toBeHidden();
		await expect(page.locator(`${CREATE_POPOVER}.htmx-request, ${CREATE_POPOVER} .htmx-request`)).toHaveCount(0);
	});

	test("returns focus to the create row after the dialog is dismissed", async ({ page }, testInfo) => {
		const email = `readlist-rail-create-dismiss-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		const dismissals: ((page: Page) => Promise<void>)[] = [
			(each) => each.keyboard.press("Escape"),
			(each) => each.click(CREATE_CANCEL),
			(each) => each.mouse.click(4, 4),
		];

		for (const dismiss of dismissals) {
			await nameNewReadlist(page, "Never Created");
			await dismiss(page);
			await expect(page.locator(`${CREATE_POPOVER}:popover-open`)).toHaveCount(0);
			await expect(page.locator(NEW_READLIST)).toBeFocused();
			await expect(page.locator(RAIL_LINK)).toHaveCount(1);
		}
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
		await makeReadlist(page, "New Readlist");

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
		await menu.locator(DELETE_TRIGGER).click();
		await page.keyboard.press("Escape");
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();

		await toggle.click();
		await menu.locator(DELETE_TRIGGER).click();
		await page.locator(DELETE_CANCEL).click();
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
		const popover = page.locator(`[id="${popoverId}"]`);

		await toggle.click();
		await trigger.click();
		await page.keyboard.press("Escape");
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();

		await toggle.click();
		await trigger.click();
		await page.mouse.click(5, 5);
		await expect(popover).toBeHidden();
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();
	});

	test("returns focus to the card kebab after the move dialog is dismissed", async ({
		page,
	}, testInfo) => {
		const email = `readlist-card-move-focus-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: "Finance" } });
		assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
		await openReadlist(page);
		await seededReadlistSettled(page);

		const card = page.locator(CARD).first();
		const menu = card.locator(CARD_MENU);
		const toggle = menu.locator(CARD_MENU_TOGGLE);
		const summary = menu.locator("summary").first();
		const trigger = card.locator(CARD_MOVE_TRIGGER);
		const popoverId = await trigger.getAttribute("popovertarget");
		assert.ok(popoverId, "the card's move trigger must reference its dialog");
		const popover = page.locator(`[id="${popoverId}"]`);

		await toggle.click();
		await trigger.click();
		await expect(popover).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(popover).toBeHidden();
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();

		await toggle.click();
		await trigger.click();
		await popover.locator(MOVE_CANCEL).click();
		await expect(popover).toBeHidden();
		await expect(menu).toHaveJSProperty("open", false);
		await expect(summary).toBeFocused();
	});
});

test.describe("The readlist status tabs", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps the sort control fixed whatever the count's width or loading state", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-count-slot-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);
		await waitForBrandFonts(page, ["Inter"]);
		await expect(page.locator(COUNT_NUMBER)).toHaveText(String(SEEDED_ARTICLES.length));
		const known = await measuredBox(page, SORT_LINK);

		await page.locator(COUNT_NUMBER).evaluate((el) => {
			el.textContent = "9999+";
		});
		const widest = await measuredBox(page, SORT_LINK);

		await page.locator(COUNT_NUMBER).evaluate((el) => {
			el.textContent = "";
			el.setAttribute("class", "readlist__count-value readlist__count-value--pending");
		});
		const pending = await measuredBox(page, SORT_LINK);

		assert.equal(
			widest.x,
			known.x,
			`the widest count must not push the sort control, measured ${widest.x} against ${known.x}`,
		);
		assert.equal(
			pending.x,
			known.x,
			`a pending count must not shift the sort control, measured ${pending.x} against ${known.x}`,
		);
	});

	test("hides the count rather than letting it meet the sort control on a narrow header", async ({
		page,
	}, testInfo) => {
		const email = `readlist-rail-narrow-header-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUserWithArticles(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);
		await waitForBrandFonts(page, ["Inter"]);
		await page.locator(COUNT_NUMBER).evaluate((el) => {
			el.textContent = "9999+";
		});

		const NARROWEST = 320;
		const WIDEST_SWEPT = 520;
		const TOLERANCE = 0.5;
		const countDisplay = () =>
			page.locator(LISTING_COUNT).evaluate((el) => getComputedStyle(el).display);
		const assertHeaderHolds = async (width: number, display: string) => {
			const header = await measuredBox(page, LISTING_HEADER);
			const sort = await measuredBox(page, SORT_LINK);
			const contentEdge = header.x + header.width - HEADER_INSET_PX;
			assert.ok(
				Math.abs(sort.x + sort.width - contentEdge) <= TOLERANCE,
				`at ${width}px the sort control ends at the header's content edge — ${sort.x + sort.width}px against ${contentEdge}px`,
			);
			if (display === "none") return;
			const count = await measuredBox(page, LISTING_COUNT);
			const clearance = sort.x - (count.x + count.width);
			assert.ok(
				clearance >= HEADER_GAP_PX - TOLERANCE,
				`at ${width}px a shown count keeps its gap from the sort control — ${clearance}px`,
			);
		};

		await page.setViewportSize({ width: NARROWEST, height: PHONE.height });
		assert.equal(await countDisplay(), "none", `a ${NARROWEST}px header hides the count`);
		await assertHeaderHolds(NARROWEST, "none");

		let firstShown = NARROWEST;
		let display = "none";
		while (display === "none") {
			firstShown += 1;
			assert.ok(
				firstShown <= WIDEST_SWEPT,
				`the count must come back before ${WIDEST_SWEPT}px`,
			);
			await page.setViewportSize({ width: firstShown, height: PHONE.height });
			display = await countDisplay();
		}
		await assertHeaderHolds(firstShown, display);
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
