import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
	waitForImagePixels,
} from "@packages/e2e-harness";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { requireEnv } from "@packages/require-env";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { clickAndWaitForPageReload } from "./page-interactions";
import { growRailToFitOpenFlyout } from "./readlist.browser";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const DESKTOP = { width: 1280, height: 900 };
const DESKTOP_TALL = { width: 1280, height: 1700 };
const PHONE = { width: 390, height: 844 };
const PHONE_TALL = { width: 390, height: 2600 };
const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };

const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const UNBROKEN_WORD = "Supercalifragilisticexpialidociousandthensomemoretokeepgoing";
const LONGEST_READLIST_NAME = "Longestpossiblereadlist".padEnd(READLIST_LABEL_MAX_LENGTH, "x");
const RENAME_INPUT = "[data-test-readlist-rename-input]";
const RENAME_SAVE = '[data-test-action="readlist-rename-save"]';
const THUMBNAIL_URL = "https://cdn.example.com/readlist-thumbnail.svg";

const MAIN = "main.readlist";
const RAIL = ".readlist__rail";
const MAIN_COLUMN = ".readlist__main";
const SIDE = ".readlist__side";
const NEW_READLIST_BUTTON = '[data-test-action="new-readlist"]';
const ACTIVE_READLIST_LABEL = ".readlist-nav__link--active .readlist-nav__label";
const READLIST_MENU_SUMMARY = '[data-test-action="readlist-menu"]';
const READLIST_MENU_PANEL = "[data-test-readlist-menu]";
const READLIST_MENU_FLYOUT = `${READLIST_MENU_PANEL} .menu__panel`;
const READLIST_MENU_RENAME = '[data-test-action="readlist-rename"]';
const READLIST_MENU_DELETE = '[data-test-action="readlist-delete"]';
const READLIST_RENAME_POPOVER = '[data-test-confirm-popover="readlist-rename"]';
const READLIST_DELETE_POPOVER = '[data-test-confirm-popover="readlist-delete"]';
const READLIST_RENAME_CANCEL = '[data-test-action="readlist-rename-cancel"]';
const READLIST_DELETE_CONFIRM = '[data-test-action="readlist-delete-confirm"]';
const SAVE_CARD = "[data-test-save-card]";
const SAVE_ERROR = "[data-test-save-error]";
const SAVE_INPUT = `${SAVE_CARD} input[name="url"]`;
const SAVE_TIP_POPOVER = '[data-test-confirm-popover="save-tip"]';
const ARTICLE = "[data-test-article]";
const FIRST_CARD = "#latest-saved";
const CARD_MARK_READ = '[data-test-action="mark-read"]';
const CARD_MENU_SUMMARY = '[data-test-action="article-menu"]';
const CARD_MENU_PANEL = "[data-test-article-menu]";
const CARD_DELETE = '[data-test-action="delete"]';
const NAV_USER = "[data-test-nav-user]";
const NAV_USER_MENU = `${NAV_USER} .nav__user-menu`;
const CARD_TIME = ".readlist-article__time";
const CARD_THUMBNAIL = ".readlist-article__thumbnail";
const DELETE_ARTICLE_POPOVER = '[data-test-confirm-popover="delete"]';
const OPEN_DELETE_ARTICLE_POPOVER = `${DELETE_ARTICLE_POPOVER}:popover-open`;
const DELETE_ARTICLE_NEVER = `${OPEN_DELETE_ARTICLE_POPOVER} [data-test-action="delete-confirm-never"]`;
const DELETE_ARTICLE_CONFIRM = `${OPEN_DELETE_ARTICLE_POPOVER} [data-test-action="delete-confirm"]`;
const MARK_STATUS_CONFIRM_BUTTON = '[data-test-action="mark-status-confirm"]';
const EMPTY = "[data-test-empty-readlist]";
const LISTING = "[data-test-listing]";
const LISTING_COUNT = "#readlist-count";
const PAGINATION_PAGES = "#readlist-pages";
const PAGINATION_PAGE = "[data-test-pagination-page]";
const READ_FILTER_TAB = '[data-test-filter="read"]';
const ALERT = '[data-test-alert="readlist"]';
const ALERT_TITLE = `${ALERT} [data-test-alert-title]`;
const SUBSCRIPTION_BANNER = "[data-test-subscription-banner]";
const SETUP_GUIDE = "[data-test-setup-guide]";
const TOAST = "[data-test-toast]";
const SETUP_GUIDE_AVATAR = ".setup-guide__avatar";
const ONBOARDING_PROGRESS = "[data-test-onboarding-progress]";
const ONBOARDING_CHIP = "[data-test-onboarding-chip]";
const SUBSCRIPTION_CHIP = "[data-test-subscription-chip]";
const PAGE_READLIST = "body.page-readlist";

const VOLATILE_CHROME = [
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

function trialTile(unit: "days" | "hours" | "minutes"): string {
	return `[data-test-trial-tile="${unit}"]`;
}

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

async function createVerifiedUser(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await created.json()).userId;
}

async function seedCrawledArticle(
	page: Page,
	input: {
		url: string;
		title: string;
		savedAt: string;
		excerpt: string;
		userId: string;
		imageUrl?: string;
	},
): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.url,
			title: input.title,
			...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
			content: "<p>Seeded body for the readlist visual baseline.</p>",
			contentFetchedAt: SEEDED_FETCHED_AT,
			savedAt: input.savedAt,
			savedByUserId: input.userId,
			excerpt: input.excerpt,
			generatedSummary: {
				summary: "Seeded summary for the readlist visual baseline.",
				excerpt: input.excerpt,
			},
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
	return SeededArticle.parse(await response.json()).articleId;
}

function seededArticles(
	stamp: string,
): { url: string; title: string; savedAt: string; excerpt: string; imageUrl?: string }[] {
	return [
		{
			url: `https://example.com/readlist-second-${stamp}`,
			title: "The second article in the readlist",
			savedAt: "2026-07-11T09:14:00.000Z",
			excerpt:
				"A fixed excerpt for the readlist visual baseline, long enough to occupy the card's excerpt lines.",
		},
		{
			url: `https://example.com/readlist-first-${stamp}`,
			title: "The article at the top of the readlist",
			savedAt: "2026-07-12T09:14:00.000Z",
			imageUrl: THUMBNAIL_URL,
			excerpt:
				"A fixed excerpt for the readlist visual baseline, long enough to occupy the card's excerpt lines.",
		},
	];
}

async function pinThumbnail(page: Page): Promise<void> {
	await page.route(THUMBNAIL_URL, (route) =>
		route.fulfill({
			contentType: "image/svg+xml",
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#B9712A"/><rect x="24" y="150" width="272" height="16" fill="#F6EFE7"/></svg>',
		}),
	);
}

async function seedTwoArticles(page: Page, userId: string, stamp: string): Promise<void> {
	await pinThumbnail(page);
	for (const article of seededArticles(stamp)) {
		await seedCrawledArticle(page, { ...article, userId });
	}
}

async function seedInboxArticleQueued(page: Page, userId: string): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-inbox-article-queued`, {
		data: { userId },
	});
	assert.equal(response.status(), 201, "the inbox-article seed endpoint must answer 201");
}

async function seedSubscriptionState(
	page: Page,
	params: { userId: string; state: "trialing" | "cancellation-scheduled" | "inactive"; at?: string },
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
		data: params,
	});
	assert.equal(response.status(), 201, "the subscription-state seed endpoint must answer 201");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

function waitForReadlistCounts(page: Page): Promise<unknown> {
	return page.waitForResponse((response) => response.url().includes("/queue/counts"));
}

async function gotoReadlistQueue(page: Page, query: string): Promise<void> {
	const counts = waitForReadlistCounts(page);
	await page.goto(`${BASE_URL}/queue${query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(PAGE_READLIST);
	await counts;
}

async function gotoReadlistQueueWithCookies(
	page: Page,
	cookies: readonly { name: string; value: string }[],
): Promise<void> {
	await page.context().addCookies(
		cookies.map((cookie) => ({ ...cookie, path: "/", domain: new URL(BASE_URL).hostname })),
	);
	await gotoReadlistQueue(page, "");
}

async function clickAndWaitForCounts(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
	const counts = waitForReadlistCounts(page);
	await clickAndWaitForPageReload(page, locator);
	await counts;
}

async function openCustomReadlist(page: Page, email: string): Promise<void> {
	await createVerifiedUser(page, email);
	await loginAs(page, email);
	await gotoReadlistQueue(page, "");
	await clickAndWaitForCounts(page, page.locator(NEW_READLIST_BUTTON));
}

async function markFirstArticleRead(page: Page): Promise<void> {
	const markRead = page.locator(`${FIRST_CARD} ${CARD_MARK_READ}`);
	await clickAndWaitForPageReload(page, markRead);
	const confirm = page.locator(MARK_STATUS_CONFIRM_BUTTON);
	if (await confirm.isVisible().catch(() => false)) {
		await clickAndWaitForPageReload(page, confirm);
	}
}

async function settledSetupGuide(page: Page): Promise<void> {
	await expect(page.locator(SETUP_GUIDE)).toBeVisible();
	await waitForImagePixels(page, SETUP_GUIDE_AVATAR);
}

async function neutralise(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function railBesideMainBesideSide(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the design queue page must never scroll sideways");
	const rail = await measuredBox(page, RAIL);
	const main = await measuredBox(page, MAIN_COLUMN);
	const side = await measuredBox(page, SIDE);
	assert.ok(
		rail.x + rail.width <= main.x,
		`the rail must sit left of the main column, measured rail=${JSON.stringify(rail)} main=${JSON.stringify(main)}`,
	);
	assert.ok(
		main.x + main.width <= side.x,
		`the side rail must sit right of the main column, measured main=${JSON.stringify(main)} side=${JSON.stringify(side)}`,
	);
}

async function openMenuGeometry(
	page: Page,
	input: { panel: string; toggle: string; rows: number },
): Promise<void> {
	const panel = await measuredBox(page, input.panel);
	const toggle = await measuredBox(page, input.toggle);
	assert.ok(panel.width >= 120, `an open menu must be at least 120px wide, measured ${panel.width}px`);
	assert.ok(
		Math.abs(panel.x + panel.width - (toggle.x + toggle.width)) <= 1,
		`the menu must align with its trigger's trailing edge, measured panel=${JSON.stringify(panel)} toggle=${JSON.stringify(toggle)}`,
	);
	assert.ok(
		panel.y >= toggle.y + toggle.height - 0.5,
		`the menu must open below its trigger, measured panel=${JSON.stringify(panel)} toggle=${JSON.stringify(toggle)}`,
	);
	const rows = page.locator(`${input.panel} .menu__item:visible`);
	await expect(rows).toHaveCount(input.rows);
	for (const row of await rows.all()) {
		const box = await row.boundingBox();
		assert.ok(box, "a visible menu row must have a box");
		assert.ok(Math.abs(box.height - 44) <= 0.5, `a menu row must be 44px high, measured ${box.height}px`);
	}
}

async function railMenuGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	await openMenuGeometry(page, {
		panel: READLIST_MENU_FLYOUT,
		toggle: READLIST_MENU_SUMMARY,
		rows: 2,
	});
}

async function cardMenuGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	await openMenuGeometry(page, {
		panel: `${FIRST_CARD} .menu__panel`,
		toggle: `${FIRST_CARD} ${CARD_MENU_SUMMARY}`,
		rows: 1,
	});
}

async function cardMenuPhoneGeometry(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	await openMenuGeometry(page, {
		panel: `${FIRST_CARD} .menu__panel`,
		toggle: `${FIRST_CARD} ${CARD_MENU_SUMMARY}`,
		rows: 1,
	});
	const viewport = page.viewportSize();
	assert(viewport, "the phone menu needs a fixed viewport");
	const panel = await measuredBox(page, `${FIRST_CARD} .menu__panel`);
	const card = await measuredBox(page, FIRST_CARD);
	assert.ok(panel.x >= 16 && panel.x + panel.width <= viewport.width - 16);
	assert.ok(panel.x >= card.x && panel.x + panel.width <= card.x + card.width);
	assert.ok(panel.y >= card.y && panel.y + panel.height <= card.y + card.height);
}

async function headerAccountMenuGeometry(page: Page): Promise<void> {
	const items = page.locator(`${NAV_USER_MENU} > li:visible`);
	await expect(items).toHaveCount(5);
	await expect(page.locator(`${NAV_USER_MENU} [data-test-nav-item]`)).toHaveCount(5);
	for (const item of await items.all()) {
		const box = await item.boundingBox();
		assert.ok(box, "a visible account menu row must have a box");
		assert.ok(Math.abs(box.height - 44) <= 0.5, `an account menu row must be 44px high, measured ${box.height}px`);
	}
}

async function pageFitsTheClip(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "a whole-page capture needs a fixed viewport to size its clip");
	const target = await measuredBox(page, MAIN);
	assert.ok(
		target.y + target.height <= viewport.height,
		`the whole-page clip runs to ${Math.ceil(target.y + target.height)}px, past the ${viewport.height}px viewport a clip can reach`,
	);
}

async function pageFromTopGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	await pageFitsTheClip(page);
}

async function neverScrollsSideways(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the queue page must never scroll sideways");
}

async function railStacksAboveTheListing(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	const rail = await measuredBox(page, RAIL);
	const main = await measuredBox(page, MAIN_COLUMN);
	assert.ok(
		rail.y + rail.height <= main.y,
		`the rail must stack above the listing on a phone, measured rail=${JSON.stringify(rail)} main=${JSON.stringify(main)}`,
	);
}

async function phonePageGeometry(page: Page): Promise<void> {
	await railStacksAboveTheListing(page);
	await pageFitsTheClip(page);
}

function near(actual: number, expected: number): boolean {
	return Math.abs(actual - expected) <= 1;
}

async function renameDialogGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	const panel = await measuredBox(page, READLIST_RENAME_POPOVER);
	const cancel = await measuredBox(page, READLIST_RENAME_CANCEL);
	const save = await measuredBox(page, RENAME_SAVE);
	assert.ok(near(panel.width, 600));
	assert.ok(near(cancel.y, save.y));
	assert.ok(near(save.x, cancel.x + cancel.width + 8));
	assert.ok(near(save.x + save.width, panel.x + panel.width - 33));
}

async function deleteReadlistDialogGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	const panel = await measuredBox(page, READLIST_DELETE_POPOVER);
	const commit = await measuredBox(page, READLIST_DELETE_CONFIRM);
	assert.ok(near(panel.width, 600));
	assert.ok(near(commit.x, panel.x + 33));
	assert.ok(near(commit.x + commit.width, panel.x + panel.width - 33));
}

async function deleteArticleDialogGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	const panel = await measuredBox(page, OPEN_DELETE_ARTICLE_POPOVER);
	const never = await measuredBox(page, DELETE_ARTICLE_NEVER);
	const commit = await measuredBox(page, DELETE_ARTICLE_CONFIRM);
	assert.ok(near(panel.width, 600));
	assert.ok(near(never.y, commit.y));
	assert.ok(near(commit.x, never.x + never.width + 8));
	const leftSlack = never.x - panel.x;
	const rightSlack = panel.x + panel.width - (commit.x + commit.width);
	assert.ok(near(leftSlack, rightSlack));
}

async function stackedDialogButtons(
	page: Page,
	panelSelector: string,
	dismissSelector: string,
	commitSelector: string,
): Promise<void> {
	await neverScrollsSideways(page);
	const panel = await measuredBox(page, panelSelector);
	const dismiss = await measuredBox(page, dismissSelector);
	const commit = await measuredBox(page, commitSelector);
	assert.ok(near(panel.width, 358));
	assert.ok(near(dismiss.y, commit.y + commit.height + 8));
	for (const choice of [dismiss, commit]) {
		assert.ok(near(choice.x, panel.x + 25));
		assert.ok(near(choice.x + choice.width, panel.x + panel.width - 25));
	}
}

async function renameDialogPhoneGeometry(page: Page): Promise<void> {
	await stackedDialogButtons(page, READLIST_RENAME_POPOVER, READLIST_RENAME_CANCEL, RENAME_SAVE);
}

async function deleteArticleDialogPhoneGeometry(page: Page): Promise<void> {
	await stackedDialogButtons(page, OPEN_DELETE_ARTICLE_POPOVER, DELETE_ARTICLE_NEVER, DELETE_ARTICLE_CONFIRM);
}

async function chipIsHigh(page: Page, selector: string, height: number): Promise<void> {
	const chip = await measuredBox(page, selector);
	assert.ok(near(chip.height, height), `${selector} must be ${height}px high, measured ${chip.height}px`);
}

async function subscriptionChipIsStatusSize(page: Page): Promise<void> {
	await chipIsHigh(page, SUBSCRIPTION_CHIP, 34);
}

async function setupGuideChipIsTagSize(page: Page): Promise<void> {
	await chipIsHigh(page, ONBOARDING_CHIP, 26);
}

async function subscriptionNoticeLeadsTheListing(page: Page): Promise<void> {
	await phonePageGeometry(page);
	const banner = await measuredBox(page, SUBSCRIPTION_BANNER);
	const listing = await measuredBox(page, LISTING);
	assert.ok(
		banner.y + banner.height <= listing.y,
		`a trial notice must stay above the article list on a phone, measured banner=${JSON.stringify(banner)} listing=${JSON.stringify(listing)}`,
	);
}

async function emptyPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(EMPTY)).toBeVisible();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Unread Articles");
	await settledSetupGuide(page);
}

async function articlesPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ARTICLE)).toHaveCount(2);
	await expect(page.locator(LISTING_COUNT)).toHaveText("2 Unread Articles");
	await waitForImagePixels(page, CARD_THUMBNAIL);
	await settledSetupGuide(page);
}

async function readTabSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(READ_FILTER_TAB)).toHaveAttribute("aria-current", "page");
	await expect(page.locator(ARTICLE)).toHaveCount(1);
	await expect(page.locator(LISTING_COUNT)).toHaveText("1 Read Article");
	await waitForImagePixels(page, CARD_THUMBNAIL);
}

async function customReadlistPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist");
	await expect(page.locator(EMPTY)).toBeVisible();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Unread Articles");
	await settledSetupGuide(page);
}

async function railMenuOpenSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(READLIST_MENU_SUMMARY);
	await expect(page.locator(READLIST_MENU_PANEL)).toHaveAttribute("open", "");
	await expect(page.locator(READLIST_MENU_RENAME)).toBeVisible();
	await expect(page.locator(READLIST_MENU_DELETE)).toBeVisible();
	await page.evaluate(growRailToFitOpenFlyout, { rail: RAIL, flyout: READLIST_MENU_FLYOUT });
	await page.mouse.move(0, 0);
}

async function renameDialogSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(READLIST_MENU_SUMMARY);
	await expect(page.locator(READLIST_MENU_PANEL)).toHaveAttribute("open", "");
	await page.click(READLIST_MENU_RENAME);
	await page.waitForSelector(`${READLIST_RENAME_POPOVER}:popover-open`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function deleteReadlistDialogSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(READLIST_MENU_SUMMARY);
	await expect(page.locator(READLIST_MENU_PANEL)).toHaveAttribute("open", "");
	await page.click(READLIST_MENU_DELETE);
	await page.waitForSelector(`${READLIST_DELETE_POPOVER}:popover-open`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function cardMenuOpenSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(`${FIRST_CARD} ${CARD_MENU_SUMMARY}`);
	await expect(page.locator(`${FIRST_CARD} ${CARD_MENU_PANEL}`)).toHaveAttribute("open", "");
	await expect(page.locator(`${FIRST_CARD} ${CARD_DELETE}`)).toBeVisible();
	await waitForImagePixels(page, CARD_THUMBNAIL);
	await page.mouse.move(0, 0);
}

async function headerAccountMenuOpenSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.locator(`${NAV_USER} .nav__user-summary`).click();
	await expect(page.locator(NAV_USER)).toHaveAttribute("open", "");
	await expect(page.locator(NAV_USER_MENU)).toBeVisible();
	await page.mouse.move(0, 0);
}

async function deleteArticleDialogSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(`${FIRST_CARD} ${CARD_MENU_SUMMARY}`);
	await expect(page.locator(`${FIRST_CARD} ${CARD_MENU_PANEL}`)).toHaveAttribute("open", "");
	await page.click(`${FIRST_CARD} ${CARD_DELETE}`);
	await page.waitForSelector(OPEN_DELETE_ARTICLE_POPOVER);
	await waitForBrandFonts(page, ["Inter"]);
}

async function alertLimitSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ALERT)).toBeVisible();
	await expect(page.locator(ALERT_TITLE)).toHaveText("Readlist limit reached");
}

async function alertGoneSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ALERT)).toBeVisible();
	await expect(page.locator(ALERT_TITLE)).toHaveText("Readlist not found");
}

async function saveErrorSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SAVE_CARD)).toBeVisible();
	await expect(page.locator(SAVE_ERROR)).toHaveAttribute("data-test-saveable-url-code", "malformed_url");
}

async function saveFieldFocusSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	const input = page.locator(SAVE_INPUT);
	await input.focus();
	await expect(input).toBeFocused();
	await expect(input).toHaveValue("");
	await expect(page.locator(SAVE_TIP_POPOVER)).toBeHidden();
}

async function subscriptionTrialSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SUBSCRIPTION_BANNER)).toHaveClass(/readlist-subscription--trial-countdown/);
	await expect(page.locator(trialTile("days"))).toBeVisible();
	await expect(page.locator(trialTile("hours"))).toBeVisible();
	await expect(page.locator(trialTile("minutes"))).toBeVisible();
}

async function subscriptionCancellationSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SUBSCRIPTION_BANNER)).toHaveClass(
		/readlist-subscription--cancellation-scheduled/,
	);
}

async function subscriptionInactiveSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SUBSCRIPTION_BANNER)).toHaveClass(/readlist-subscription--inactive/);
	await expect(page.locator(SAVE_INPUT)).toBeDisabled();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Unread Articles");
	await settledSetupGuide(page);
}

async function setupGuideEmailStepSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SETUP_GUIDE)).toBeVisible();
	await expect(page.locator('[data-test-onboarding-step="receive-articles-by-email"]')).toHaveAttribute(
		"data-test-onboarding-current",
		"true",
	);
	await expect(page.locator(ONBOARDING_PROGRESS)).toHaveAttribute("data-test-onboarding-progress", "50");
	await settledSetupGuide(page);
}

async function setupGuideNextReadSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SETUP_GUIDE)).toBeVisible();
	await expect(page.locator('[data-test-onboarding-step="save-enough-for-next-read"]')).toHaveAttribute(
		"data-test-onboarding-current",
		"true",
	);
	await expect(page.locator(ONBOARDING_PROGRESS)).toHaveAttribute("data-test-onboarding-progress", "75");
	await expect(page.locator(ONBOARDING_CHIP)).toHaveText(`Saved 0 of ${NEXT_READ_MINIMUM_SAVES}`);
	await settledSetupGuide(page);
}

const PAGE_EMPTY: VisualCheckpoint = {
	name: "readlist-page-empty",
	settled: emptyPageSettled,
	geometry: pageFromTopGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const PAGE_ARTICLES: VisualCheckpoint = {
	name: "readlist-page-articles",
	settled: articlesPageSettled,
	geometry: pageFromTopGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [
		{ selector: `${FIRST_CARD} ${CARD_TIME}`, text: "3 days ago" },
		{
			selector: `.readlist-list > .readlist-article:nth-of-type(2) ${CARD_TIME}`,
			text: "2 days ago",
		},
	],
};

const PAGE_READ_TAB: VisualCheckpoint = {
	name: "readlist-page-read-tab",
	settled: readTabSettled,
	geometry: railBesideMainBesideSide,
	target: LISTING,
	capture: "element",
	pinnedText: [{ selector: `${FIRST_CARD} ${CARD_TIME}`, text: "3 days ago" }],
};

const PAGE_CUSTOM_READLIST: VisualCheckpoint = {
	name: "readlist-page-custom-readlist",
	settled: customReadlistPageSettled,
	geometry: pageFromTopGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const RAIL_MENU_OPEN: VisualCheckpoint = {
	name: "readlist-rail-menu-open",
	settled: railMenuOpenSettled,
	geometry: railMenuGeometry,
	target: RAIL,
	capture: "element",
	pinnedText: [],
};

const RENAME_DIALOG: VisualCheckpoint = {
	name: "readlist-rename-dialog",
	settled: renameDialogSettled,
	geometry: renameDialogGeometry,
	target: READLIST_RENAME_POPOVER,
	capture: "element",
	pinnedText: [],
};

const RENAME_DIALOG_PHONE: VisualCheckpoint = {
	...RENAME_DIALOG,
	name: "readlist-rename-dialog-phone",
	geometry: renameDialogPhoneGeometry,
};

const DELETE_READLIST_DIALOG: VisualCheckpoint = {
	name: "readlist-delete-readlist-dialog",
	settled: deleteReadlistDialogSettled,
	geometry: deleteReadlistDialogGeometry,
	target: READLIST_DELETE_POPOVER,
	capture: "element",
	pinnedText: [],
};

const CARD_MENU_OPEN: VisualCheckpoint = {
	name: "readlist-article-menu-open",
	settled: cardMenuOpenSettled,
	geometry: cardMenuGeometry,
	target: FIRST_CARD,
	capture: "element",
	pinnedText: [{ selector: `${FIRST_CARD} ${CARD_TIME}`, text: "3 days ago" }],
};

const CARD_MENU_OPEN_PHONE: VisualCheckpoint = {
	...CARD_MENU_OPEN,
	name: "readlist-article-menu-open-phone",
	geometry: cardMenuPhoneGeometry,
};

const HEADER_ACCOUNT_MENU_OPEN: VisualCheckpoint = {
	name: "header-account-menu-open",
	settled: headerAccountMenuOpenSettled,
	geometry: headerAccountMenuGeometry,
	target: NAV_USER_MENU,
	capture: "page-from-top",
	pinnedText: [],
};

const DELETE_ARTICLE_DIALOG: VisualCheckpoint = {
	name: "readlist-delete-article-dialog",
	settled: deleteArticleDialogSettled,
	geometry: deleteArticleDialogGeometry,
	target: OPEN_DELETE_ARTICLE_POPOVER,
	capture: "element",
	pinnedText: [],
};

const DELETE_ARTICLE_DIALOG_PHONE: VisualCheckpoint = {
	...DELETE_ARTICLE_DIALOG,
	name: "readlist-delete-article-dialog-phone",
	geometry: deleteArticleDialogPhoneGeometry,
};

const ALERT_LIMIT: VisualCheckpoint = {
	name: "readlist-alert-limit",
	settled: alertLimitSettled,
	geometry: railBesideMainBesideSide,
	target: ALERT,
	capture: "element",
	pinnedText: [],
};

const ALERT_GONE: VisualCheckpoint = {
	name: "readlist-alert-gone",
	settled: alertGoneSettled,
	geometry: railBesideMainBesideSide,
	target: ALERT,
	capture: "element",
	pinnedText: [],
};

const ALERT_LIMIT_PHONE: VisualCheckpoint = {
	...ALERT_LIMIT,
	name: "readlist-alert-limit-phone",
	geometry: neverScrollsSideways,
};

const SAVE_ERROR_CHECKPOINT: VisualCheckpoint = {
	name: "readlist-save-error",
	settled: saveErrorSettled,
	geometry: railBesideMainBesideSide,
	target: SAVE_CARD,
	capture: "element",
	pinnedText: [],
};

const SAVE_FIELD_FOCUS: VisualCheckpoint = {
	name: "readlist-save-field-focus",
	settled: saveFieldFocusSettled,
	geometry: railBesideMainBesideSide,
	target: SAVE_CARD,
	capture: "element",
	pinnedText: [],
};

const SUBSCRIPTION_TRIAL: VisualCheckpoint = {
	name: "readlist-subscription-trial",
	settled: subscriptionTrialSettled,
	geometry: railBesideMainBesideSide,
	target: SUBSCRIPTION_BANNER,
	capture: "element",
	pinnedText: [
		{ selector: trialTile("days"), text: "9" },
		{ selector: trialTile("hours"), text: "23" },
		{ selector: trialTile("minutes"), text: "18" },
	],
};

const SUBSCRIPTION_CANCELLATION: VisualCheckpoint = {
	name: "readlist-subscription-cancellation",
	settled: subscriptionCancellationSettled,
	geometry: async (page) => {
		await railBesideMainBesideSide(page);
		await subscriptionChipIsStatusSize(page);
	},
	target: SUBSCRIPTION_BANNER,
	capture: "element",
	pinnedText: [],
};

const SUBSCRIPTION_INACTIVE: VisualCheckpoint = {
	name: "readlist-subscription-inactive",
	settled: subscriptionInactiveSettled,
	geometry: async (page) => {
		await pageFromTopGeometry(page);
		await subscriptionChipIsStatusSize(page);
	},
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const SETUP_GUIDE_EMAIL_STEP: VisualCheckpoint = {
	name: "readlist-setup-guide-email-step",
	settled: setupGuideEmailStepSettled,
	geometry: railBesideMainBesideSide,
	target: SETUP_GUIDE,
	capture: "element",
	pinnedText: [],
};

const SETUP_GUIDE_NEXT_READ: VisualCheckpoint = {
	name: "readlist-setup-guide-next-read",
	settled: setupGuideNextReadSettled,
	geometry: async (page) => {
		await railBesideMainBesideSide(page);
		await setupGuideChipIsTagSize(page);
	},
	target: SETUP_GUIDE,
	capture: "element",
	pinnedText: [],
};

const PAGE_ARTICLES_PHONE: VisualCheckpoint = {
	...PAGE_ARTICLES,
	name: "readlist-page-articles-phone",
	geometry: phonePageGeometry,
};

const PAGE_EMPTY_PHONE: VisualCheckpoint = {
	...PAGE_EMPTY,
	name: "readlist-page-empty-phone",
	geometry: phonePageGeometry,
};

const PAGE_CUSTOM_READLIST_PHONE: VisualCheckpoint = {
	...PAGE_CUSTOM_READLIST,
	name: "readlist-page-custom-readlist-phone",
	geometry: phonePageGeometry,
};

const SUBSCRIPTION_TRIAL_PHONE: VisualCheckpoint = {
	name: "readlist-subscription-trial-phone",
	settled: subscriptionTrialSettled,
	geometry: subscriptionNoticeLeadsTheListing,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const RAIL_PHONE: VisualCheckpoint = {
	name: "readlist-rail-phone",
	settled: customReadlistPageSettled,
	geometry: railStacksAboveTheListing,
	target: RAIL,
	capture: "element",
	pinnedText: [],
};

async function statusToastSettled(page: Page): Promise<void> {
	await expect(page.locator(TOAST)).toBeVisible();
	await expect(page.locator(`${TOAST} [data-test-toast-message]`)).toHaveText("Marked as read");
	await expect(page.locator(`${TOAST} [data-test-toast-action]`)).toHaveText("Undo");
}

async function desktopStatusToastGeometry(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert(viewport, "the toast needs a fixed viewport");
	const box = await measuredBox(page, TOAST);
	assert.equal(Math.round(box.x + box.width), viewport.width - 48);
	assert.equal(Math.round(box.y + box.height), viewport.height - 48);
	assert.equal(Math.round(box.height), 58);
	const shadow = await page.locator(TOAST).evaluate((el) => getComputedStyle(el).boxShadow);
	assert.notEqual(shadow, "none", "the floating toast must cast a shadow");
}

async function phoneStatusToastGeometry(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert(viewport, "the toast needs a fixed viewport");
	const box = await measuredBox(page, TOAST);
	assert.equal(Math.round(box.x), 20);
	assert.equal(Math.round(box.x + box.width), viewport.width - 20);
	assert.equal(Math.round(box.y + box.height), viewport.height - 20);
	assert.equal(Math.round(box.height), 58);
}

const STATUS_TOAST: VisualCheckpoint = {
	name: "readlist-status-toast",
	settled: statusToastSettled,
	geometry: desktopStatusToastGeometry,
	target: TOAST,
	capture: "element",
	pinnedText: [],
};

const STATUS_TOAST_PHONE: VisualCheckpoint = {
	...STATUS_TOAST,
	name: "readlist-status-toast-phone",
	geometry: phoneStatusToastGeometry,
};

async function openStatusToast(page: Page, stamp: string): Promise<void> {
	const email = `readlist-status-toast-${stamp}@example.com`;
	const userId = await createVerifiedUser(page, email);
	const articleId = await seedCrawledArticle(page, {
		url: `https://example.com/readlist-status-toast-${stamp}`,
		title: "An article with a reversible status",
		savedAt: "2026-07-12T09:14:00.000Z",
		excerpt: "A saved article for the status toast visual checkpoint.",
		userId,
	});
	await loginAs(page, email);
	await page.route("**/client-dist/toast.client.js", (route) => route.abort());
	await gotoReadlistQueue(page, `?status_changed=read&status_article=${encodeURIComponent(articleId)}`);
}

const THEMES = ["light", "dark"] as const;

function withTheme(checkpoint: VisualCheckpoint, theme: (typeof THEMES)[number]): VisualCheckpoint {
	return { ...checkpoint, name: `${checkpoint.name}-${theme}` };
}

test.describe("Readlist page (empty)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`shows the empty state with nothing saved (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-empty-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(PAGE_EMPTY, theme));
		});
	}
});

test.describe("Readlist page (seeded articles)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`shows two seeded articles with pinned saved times (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-articles-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedTwoArticles(page, userId, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");
			await page.waitForSelector(`${PAGINATION_PAGES} ${PAGINATION_PAGE}`);

			await captureCheckpoint(page, withTheme(PAGE_ARTICLES, theme));
		});
	}
});

test.describe("Readlist page (custom readlist)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`lands on a freshly made readlist with its own empty state (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-custom-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, email);

			await captureCheckpoint(page, withTheme(PAGE_CUSTOM_READLIST, theme));
		});
	}
});

test.describe("Readlist page (subscription inactive)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`shows the inactive banner with the disabled save form (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-subscription-inactive-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedSubscriptionState(page, { userId, state: "inactive" });
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(SUBSCRIPTION_INACTIVE, theme));
		});
	}
});

test.describe("Readlist read tab", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the article marked read on the Read tab (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-read-tab-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedTwoArticles(page, userId, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");
			await markFirstArticleRead(page);
			await gotoReadlistQueue(page, "?tab=done");

			await captureCheckpoint(page, withTheme(PAGE_READ_TAB, theme));
		});
	}
});

test.describe("Readlist status toast", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`floats at the header inset with Undo (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openStatusToast(page, `${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(page, withTheme(STATUS_TOAST, theme));
		});
	}
});

test.describe("Readlist status toast on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("spans the page gutters with Undo", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openStatusToast(page, `phone-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, STATUS_TOAST_PHONE);
	});
});

test.describe("Readlist rail menu", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`opens the rail menu for a custom readlist (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-rail-menu-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, email);

			await captureCheckpoint(page, withTheme(RAIL_MENU_OPEN, theme));
		});
	}

	for (const theme of THEMES) {
		test(`opens the rename dialog from the rail menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-rename-dialog-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, email);

			await captureCheckpoint(page, withTheme(RENAME_DIALOG, theme));
		});
	}

	for (const theme of THEMES) {
		test(`opens the delete-readlist dialog from the rail menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-delete-readlist-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, email);

			await captureCheckpoint(page, withTheme(DELETE_READLIST_DIALOG, theme));
		});
	}
});

test.describe("Readlist card menu", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`opens the card menu on the first article (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-article-menu-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedTwoArticles(page, userId, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(CARD_MENU_OPEN, theme));
		});
	}

	for (const theme of THEMES) {
		test(`opens the delete-article dialog from the card menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-delete-article-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedTwoArticles(page, userId, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(DELETE_ARTICLE_DIALOG, theme));
			const backdrop = await page.locator(OPEN_DELETE_ARTICLE_POPOVER).evaluate((panel) => {
				const style = getComputedStyle(panel, "::backdrop");
				return { background: style.backgroundColor, blur: style.backdropFilter };
			});
			assert.equal(
				backdrop.background,
				theme === "light" ? "rgba(0, 0, 0, 0.5)" : "rgba(13, 13, 13, 0.72)",
			);
			assert.notEqual(backdrop.blur, "none");
		});
	}
});

test.describe("Readlist card menu on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("keeps the open menu inside the first card and the screen gutters", async ({ page }, testInfo) => {
		const email = `readlist-article-menu-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedTwoArticles(page, userId, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");

		await captureCheckpoint(page, CARD_MENU_OPEN_PHONE);
	});
});

test.describe("Header account menu", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows all account actions in the dropdown (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `header-account-menu-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(HEADER_ACCOUNT_MENU_OPEN, theme));
		});
	}
});

test.describe("Readlist dialogs on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("stacks Save above Cancel in the rename dialog", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const email = `readlist-rename-dialog-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openCustomReadlist(page, email);
		await captureCheckpoint(page, RENAME_DIALOG_PHONE);
	});

	test("stacks Delete article above its quiet choice", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const email = `readlist-delete-article-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedTwoArticles(page, userId, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await captureCheckpoint(page, DELETE_ARTICLE_DIALOG_PHONE);
	});
});

test.describe("Readlist alerts", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the readlist-limit alert (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-alert-limit-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "?queue_error=limit");

			await captureCheckpoint(page, withTheme(ALERT_LIMIT, theme));
		});

		test(`shows the readlist-gone alert (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-alert-gone-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "?queue_error=unknown_readlist");

			await captureCheckpoint(page, withTheme(ALERT_GONE, theme));
		});
	}

	for (const theme of THEMES) {
		test(`shows the save-form error for a malformed URL (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-save-error-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "?error_code=malformed_url");

			await captureCheckpoint(page, withTheme(SAVE_ERROR_CHECKPOINT, theme));
		});
	}
});

test.describe("Readlist save field", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the empty save field focused (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-save-field-focus-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueueWithCookies(page, [{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN }]);

			await captureCheckpoint(page, withTheme(SAVE_FIELD_FOCUS, theme));
		});
	}
});

test.describe("Readlist subscription banner", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the trial-countdown banner with pinned tile values (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-subscription-trial-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedSubscriptionState(page, { userId, state: "trialing" });
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(SUBSCRIPTION_TRIAL, theme));
		});
	}

	for (const theme of THEMES) {
		test(`shows the cancellation-scheduled banner (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-subscription-cancellation-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedSubscriptionState(page, {
				userId,
				state: "cancellation-scheduled",
				at: "2027-03-01T00:00:00.000Z",
			});
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(SUBSCRIPTION_CANCELLATION, theme));
		});
	}
});

test.describe("Readlist setup guide", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the email step as current at 50% complete (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-setup-email-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueueWithCookies(page, [
				{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
				{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE },
			]);

			await captureCheckpoint(page, withTheme(SETUP_GUIDE_EMAIL_STEP, theme));
		});
	}

	for (const theme of THEMES) {
		test(`shows the next-read step as current at 75% complete with its saves chip (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-setup-next-read-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedInboxArticleQueued(page, userId);
			await loginAs(page, email);
			await gotoReadlistQueueWithCookies(page, [
				{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
				{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE },
			]);

			await captureCheckpoint(page, withTheme(SETUP_GUIDE_NEXT_READ, theme));
		});
	}
});

test.describe("Readlist alert on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("wraps the readlist-limit alert inside the phone viewport", async ({ page }, testInfo) => {
		const email = `readlist-alert-limit-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "?queue_error=limit");

		await captureCheckpoint(page, ALERT_LIMIT_PHONE);
	});
});

test.describe("Readlist page on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_TALL });

	test("stacks the empty state under the rail with nothing saved", async ({ page }, testInfo) => {
		const email = `readlist-phone-empty-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");

		await captureCheckpoint(page, PAGE_EMPTY_PHONE);
	});

	test("stacks two seeded articles under the rail", async ({ page }, testInfo) => {
		const email = `readlist-phone-articles-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedTwoArticles(page, userId, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await page.waitForSelector(`${PAGINATION_PAGES} ${PAGINATION_PAGE}`);

		await captureCheckpoint(page, PAGE_ARTICLES_PHONE);
	});

	test("keeps a trial notice above the article list", async ({ page }, testInfo) => {
		const email = `readlist-phone-trial-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedTwoArticles(page, userId, email);
		await seedSubscriptionState(page, { userId, state: "trialing" });
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");

		await captureCheckpoint(page, SUBSCRIPTION_TRIAL_PHONE);
	});

	test("hides the save card on a custom readlist and points back at the default", async ({ page }, testInfo) => {
		const email = `readlist-phone-custom-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openCustomReadlist(page, email);
		await expect(page.locator(SAVE_CARD)).toHaveClass(/readlist-save--hidden/);
		await expect(page.locator('[data-test-empty-action="open-default"]')).toBeVisible();

		await captureCheckpoint(page, PAGE_CUSTOM_READLIST_PHONE);
	});
});

test.describe("Readlist rail on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("keeps every readlist reachable above the listing", async ({ page }, testInfo) => {
		const email = `readlist-phone-rail-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openCustomReadlist(page, email);

		await captureCheckpoint(page, RAIL_PHONE);
	});
});

test.describe("Readlist page reflow", () => {
	test("never scrolls sideways, down to the reflow minimum", async ({ page }, testInfo) => {
		const email = `readlist-reflow-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedCrawledArticle(page, {
			userId,
			url: `https://averyverylongsitenamewithnospacesatallinit.example.com/${UNBROKEN_WORD}`,
			title: UNBROKEN_WORD,
			savedAt: "2026-07-12T09:14:00.000Z",
			excerpt: UNBROKEN_WORD,
		});
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");

		for (const viewport of [WCAG_REFLOW_MINIMUM, PHONE, { width: 768, height: 900 }, DESKTOP]) {
			await page.setViewportSize(viewport);
			await expect(page.locator(ARTICLE)).toHaveCount(1);
			await neverScrollsSideways(page);
		}
	});
});

test.describe("Readlist rail at the name cap", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("wraps a cap-length name inside a rail it never widens", async ({ page }, testInfo) => {
		const email = `readlist-cap-name-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openCustomReadlist(page, email);
		const railBefore = await measuredBox(page, RAIL);
		const singleLine = await measuredBox(page, `${RAIL} .readlist-nav__link--active`);

		await page.click(READLIST_MENU_SUMMARY);
		await page.click(READLIST_MENU_RENAME);
		await page.waitForSelector(`${READLIST_RENAME_POPOVER}:popover-open`);
		await page.locator(RENAME_INPUT).fill(LONGEST_READLIST_NAME);
		await clickAndWaitForPageReload(page, page.locator(RENAME_SAVE));
		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText(LONGEST_READLIST_NAME);

		const railAfter = await measuredBox(page, RAIL);
		const wrapped = await measuredBox(page, `${RAIL} .readlist-nav__link--active`);
		const menu = await measuredBox(page, `${RAIL} ${READLIST_MENU_SUMMARY}`);
		assert.equal(railAfter.width, railBefore.width, "a long name must never widen the rail");
		assert.ok(
			wrapped.height > singleLine.height,
			`a cap-length name must wrap onto another line, measured ${wrapped.height}px against ${singleLine.height}px`,
		);
		assert.ok(
			menu.x + menu.width <= railAfter.x + railAfter.width,
			"the readlist menu must stay inside the rail once the name wraps",
		);
		await neverScrollsSideways(page);

		for (const viewport of [WCAG_REFLOW_MINIMUM, PHONE]) {
			await page.setViewportSize(viewport);
			await neverScrollsSideways(page);
		}
	});
});

test.describe("Readlist subscription chip at the reflow minimum", () => {
	test.use({ timezoneId: "UTC", viewport: WCAG_REFLOW_MINIMUM });

	for (const state of ["cancellation-scheduled", "inactive"] as const) {
		test(`keeps the ${state} chip on one line inside its card at 320px`, async ({ page }, testInfo) => {
			const email = `readlist-subscription-chip-${state}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedSubscriptionState(page, { userId, state, at: "2027-03-15T00:00:00.000Z" });
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");
			await waitForBrandFonts(page, ["Inter"]);

			await chipIsHigh(page, `[data-test-subscription-chip="${state}"]`, 34);
			const chip = await measuredBox(page, SUBSCRIPTION_CHIP);
			const banner = await measuredBox(page, SUBSCRIPTION_BANNER);
			assert.ok(
				chip.x >= banner.x && chip.x + chip.width <= banner.x + banner.width,
				`the status chip must stay inside its card, measured chip=${JSON.stringify(chip)} card=${JSON.stringify(banner)}`,
			);
			await neverScrollsSideways(page);
		});
	}
});
