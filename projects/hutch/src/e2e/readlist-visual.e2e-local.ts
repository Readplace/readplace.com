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
const READLIST_MENU_FLYOUT = ".readlist-nav__menu-panel";
const READLIST_MENU_RENAME = '[data-test-action="readlist-rename"]';
const READLIST_MENU_DELETE = '[data-test-action="readlist-delete"]';
const READLIST_RENAME_POPOVER = '[data-test-confirm-popover="readlist-rename"]';
const READLIST_DELETE_POPOVER = '[data-test-confirm-popover="readlist-delete"]';
const SAVE_CARD = "[data-test-save-card]";
const SAVE_ERROR = "[data-test-save-error]";
const ARTICLE = "[data-test-article]";
const FIRST_CARD = "#latest-saved";
const CARD_MARK_READ = '[data-test-action="mark-read"]';
const CARD_MENU_SUMMARY = '[data-test-action="article-menu"]';
const CARD_MENU_PANEL = "[data-test-article-menu]";
const CARD_DELETE = '[data-test-action="delete"]';
const CARD_TIME = ".readlist-article__time";
const CARD_THUMBNAIL = ".readlist-article__thumbnail";
const DELETE_ARTICLE_POPOVER = '[data-test-confirm-popover="delete"]';
const OPEN_DELETE_ARTICLE_POPOVER = `${DELETE_ARTICLE_POPOVER}:popover-open`;
const MARK_STATUS_CONFIRM_BUTTON = '[data-test-action="mark-status-confirm"]';
const EMPTY = "[data-test-empty-readlist]";
const LISTING = "[data-test-listing]";
const LISTING_COUNT = "#readlist-count";
const PAGINATION_PAGES = "#readlist-pages";
const PAGINATION_PAGE = "[data-test-pagination-page]";
const READ_FILTER_TAB = '[data-test-filter="read"]';
const ALERT = "[data-test-readlist-error]";
const ALERT_TITLE = "[data-test-readlist-error-title]";
const SUBSCRIPTION_BANNER = "[data-test-subscription-banner]";
const SETUP_GUIDE = "[data-test-setup-guide]";
const SETUP_GUIDE_AVATAR = ".setup-guide__avatar";
const ONBOARDING_PROGRESS = "[data-test-onboarding-progress]";
const ONBOARDING_CHIP = "[data-test-onboarding-chip]";
const PAGE_READLIST = "body.page-readlist";

const VOLATILE_CHROME = [
	".trial-countdown",
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

function trialTile(unit: "days" | "hours" | "minutes"): string {
	return `[data-test-trial-tile="${unit}"]`;
}

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

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
): Promise<void> {
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
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
	await settledSetupGuide(page);
}

async function articlesPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ARTICLE)).toHaveCount(2);
	await expect(page.locator(LISTING_COUNT)).toHaveText("2 Saved Articles");
	await waitForImagePixels(page, CARD_THUMBNAIL);
	await settledSetupGuide(page);
}

async function readTabSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(READ_FILTER_TAB)).toHaveAttribute("aria-current", "page");
	await expect(page.locator(ARTICLE)).toHaveCount(1);
	await expect(page.locator(LISTING_COUNT)).toHaveText("1 Saved Article");
	await waitForImagePixels(page, CARD_THUMBNAIL);
}

async function customReadlistPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist");
	await expect(page.locator(EMPTY)).toBeVisible();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
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

async function saveErrorSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SAVE_CARD)).toBeVisible();
	await expect(page.locator(SAVE_ERROR)).toHaveAttribute("data-test-saveable-url-code", "malformed_url");
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
	await expect(page.locator(`${SAVE_CARD} form`)).toHaveClass(/readlist-save__form--disabled/);
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
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
	geometry: railBesideMainBesideSide,
	target: RAIL,
	capture: "element",
	pinnedText: [],
};

const RENAME_DIALOG: VisualCheckpoint = {
	name: "readlist-rename-dialog",
	settled: renameDialogSettled,
	geometry: railBesideMainBesideSide,
	target: READLIST_RENAME_POPOVER,
	capture: "element",
	pinnedText: [],
};

const DELETE_READLIST_DIALOG: VisualCheckpoint = {
	name: "readlist-delete-readlist-dialog",
	settled: deleteReadlistDialogSettled,
	geometry: railBesideMainBesideSide,
	target: READLIST_DELETE_POPOVER,
	capture: "element",
	pinnedText: [],
};

const CARD_MENU_OPEN: VisualCheckpoint = {
	name: "readlist-article-menu-open",
	settled: cardMenuOpenSettled,
	geometry: railBesideMainBesideSide,
	target: FIRST_CARD,
	capture: "element",
	pinnedText: [{ selector: `${FIRST_CARD} ${CARD_TIME}`, text: "3 days ago" }],
};

const DELETE_ARTICLE_DIALOG: VisualCheckpoint = {
	name: "readlist-delete-article-dialog",
	settled: deleteArticleDialogSettled,
	geometry: railBesideMainBesideSide,
	target: OPEN_DELETE_ARTICLE_POPOVER,
	capture: "element",
	pinnedText: [],
};

const ALERT_LIMIT: VisualCheckpoint = {
	name: "readlist-alert-limit",
	settled: alertLimitSettled,
	geometry: railBesideMainBesideSide,
	target: ALERT,
	capture: "element",
	pinnedText: [],
};

const SAVE_ERROR_CHECKPOINT: VisualCheckpoint = {
	name: "readlist-save-error",
	settled: saveErrorSettled,
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
	geometry: railBesideMainBesideSide,
	target: SUBSCRIPTION_BANNER,
	capture: "element",
	pinnedText: [],
};

const SUBSCRIPTION_INACTIVE: VisualCheckpoint = {
	name: "readlist-subscription-inactive",
	settled: subscriptionInactiveSettled,
	geometry: pageFromTopGeometry,
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
	geometry: railBesideMainBesideSide,
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
		});
	}
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
