import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
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
import { growRailToFitOpenFlyout } from "./readlist-design.browser";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./readlist-nav.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const DESKTOP = { width: 1280, height: 900 };
const DESKTOP_TALL = { width: 1280, height: 1700 };

const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const THUMBNAIL_URL = "https://cdn.example.com/readlist-design-thumbnail.svg";

const MAIN = "main.readlist-design";
const RAIL = ".readlist-design__rail";
const MAIN_COLUMN = ".readlist-design__main";
const SIDE = ".readlist-design__side";
const NEW_READLIST_BUTTON = '[data-test-action="new-readlist"]';
const ACTIVE_READLIST_LABEL = ".readlist-design-nav__link--active .readlist-design-nav__label";
const READLIST_MENU_SUMMARY = '[data-test-action="readlist-menu"]';
const READLIST_MENU_PANEL = "[data-test-readlist-menu]";
const READLIST_MENU_FLYOUT = ".readlist-design-nav__menu-panel";
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
const CARD_TIME = ".readlist-design-card__time";
const CARD_THUMBNAIL = ".readlist-design-card__thumbnail";
const DELETE_ARTICLE_POPOVER = '[data-test-confirm-popover="delete"]';
const OPEN_DELETE_ARTICLE_POPOVER = `${DELETE_ARTICLE_POPOVER}:popover-open`;
const MARK_STATUS_CONFIRM_BUTTON = '[data-test-action="mark-status-confirm"]';
const EMPTY = "[data-test-empty-readlist]";
const LISTING = "[data-test-listing]";
const LISTING_COUNT = "#readlist-design-count";
const PAGINATION_PAGES = "#readlist-design-pages";
const PAGINATION_PAGE = "[data-test-pagination-page]";
const READ_FILTER_TAB = '[data-test-filter="read"]';
const ALERT = "[data-test-readlist-error]";
const ALERT_TITLE = "[data-test-readlist-error-title]";
const SUBSCRIPTION_BANNER = "[data-test-subscription-banner]";
const SETUP_GUIDE = "[data-test-setup-guide]";
const ONBOARDING_PROGRESS = "[data-test-onboarding-progress]";
const ONBOARDING_CHIP = "[data-test-onboarding-chip]";
const PAGE_READLIST_DESIGN = "body.page-readlist-design";

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
			content: "<p>Seeded body for the readlist-design visual baseline.</p>",
			contentFetchedAt: SEEDED_FETCHED_AT,
			savedAt: input.savedAt,
			savedByUserId: input.userId,
			excerpt: input.excerpt,
			generatedSummary: {
				summary: "Seeded summary for the readlist-design visual baseline.",
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
			url: `https://example.com/readlist-design-second-${stamp}`,
			title: "The second article in the readlist",
			savedAt: "2026-07-11T09:14:00.000Z",
			excerpt:
				"A fixed excerpt for the readlist-design visual baseline, long enough to occupy the card's excerpt lines.",
		},
		{
			url: `https://example.com/readlist-design-first-${stamp}`,
			title: "The article at the top of the readlist",
			savedAt: "2026-07-12T09:14:00.000Z",
			imageUrl: THUMBNAIL_URL,
			excerpt:
				"A fixed excerpt for the readlist-design visual baseline, long enough to occupy the card's excerpt lines.",
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

function waitForDesignCounts(page: Page): Promise<unknown> {
	return page.waitForResponse(
		(response) => response.url().includes("/queue/counts") && response.url().includes("feature=design"),
	);
}

async function gotoDesignQueue(page: Page, query: string): Promise<void> {
	const counts = waitForDesignCounts(page);
	await page.goto(`${BASE_URL}/queue${query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(PAGE_READLIST_DESIGN);
	await counts;
}

async function gotoDesignQueueWithCookies(
	page: Page,
	cookies: readonly { name: string; value: string }[],
): Promise<void> {
	await page.context().addCookies(
		cookies.map((cookie) => ({ ...cookie, path: "/", domain: new URL(BASE_URL).hostname })),
	);
	await gotoDesignQueue(page, "?feature=design");
}

async function clickAndWaitForCounts(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
	const counts = waitForDesignCounts(page);
	await clickAndWaitForPageReload(page, locator);
	await counts;
}

async function openCustomReadlist(page: Page, email: string): Promise<void> {
	await createVerifiedUser(page, email);
	await loginAs(page, email);
	await gotoDesignQueue(page, "?feature=design");
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

async function emptyPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(EMPTY)).toBeVisible();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
}

async function articlesPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ARTICLE)).toHaveCount(2);
	await expect(page.locator(LISTING_COUNT)).toHaveText("2 Saved Articles");
	await waitForImagePixels(page, CARD_THUMBNAIL);
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
	await expect(page.locator(SUBSCRIPTION_BANNER)).toHaveClass(/readlist-design-subscription--trial-countdown/);
	await expect(page.locator(trialTile("days"))).toBeVisible();
	await expect(page.locator(trialTile("hours"))).toBeVisible();
	await expect(page.locator(trialTile("minutes"))).toBeVisible();
}

async function subscriptionCancellationSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SUBSCRIPTION_BANNER)).toHaveClass(
		/readlist-design-subscription--cancellation-scheduled/,
	);
}

async function subscriptionInactiveSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(SUBSCRIPTION_BANNER)).toHaveClass(/readlist-design-subscription--inactive/);
	await expect(page.locator(`${SAVE_CARD} form`)).toHaveClass(/readlist-design-save__form--disabled/);
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
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
}

const PAGE_EMPTY: VisualCheckpoint = {
	name: "readlist-design-page-empty",
	settled: emptyPageSettled,
	geometry: pageFromTopGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const PAGE_ARTICLES: VisualCheckpoint = {
	name: "readlist-design-page-articles",
	settled: articlesPageSettled,
	geometry: pageFromTopGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [
		{ selector: `${FIRST_CARD} ${CARD_TIME}`, text: "3 days ago" },
		{
			selector: `.readlist-design-list > .readlist-design-card:nth-of-type(2) ${CARD_TIME}`,
			text: "2 days ago",
		},
	],
};

const PAGE_READ_TAB: VisualCheckpoint = {
	name: "readlist-design-page-read-tab",
	settled: readTabSettled,
	geometry: railBesideMainBesideSide,
	target: LISTING,
	capture: "element",
	pinnedText: [{ selector: `${FIRST_CARD} ${CARD_TIME}`, text: "3 days ago" }],
};

const PAGE_CUSTOM_READLIST: VisualCheckpoint = {
	name: "readlist-design-page-custom-readlist",
	settled: customReadlistPageSettled,
	geometry: pageFromTopGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const RAIL_MENU_OPEN: VisualCheckpoint = {
	name: "readlist-design-rail-menu-open",
	settled: railMenuOpenSettled,
	geometry: railBesideMainBesideSide,
	target: RAIL,
	capture: "element",
	pinnedText: [],
};

const RENAME_DIALOG: VisualCheckpoint = {
	name: "readlist-design-rename-dialog",
	settled: renameDialogSettled,
	geometry: railBesideMainBesideSide,
	target: READLIST_RENAME_POPOVER,
	capture: "element",
	pinnedText: [],
};

const DELETE_READLIST_DIALOG: VisualCheckpoint = {
	name: "readlist-design-delete-readlist-dialog",
	settled: deleteReadlistDialogSettled,
	geometry: railBesideMainBesideSide,
	target: READLIST_DELETE_POPOVER,
	capture: "element",
	pinnedText: [],
};

const CARD_MENU_OPEN: VisualCheckpoint = {
	name: "readlist-design-card-menu-open",
	settled: cardMenuOpenSettled,
	geometry: railBesideMainBesideSide,
	target: FIRST_CARD,
	capture: "element",
	pinnedText: [{ selector: `${FIRST_CARD} ${CARD_TIME}`, text: "3 days ago" }],
};

const DELETE_ARTICLE_DIALOG: VisualCheckpoint = {
	name: "readlist-design-delete-article-dialog",
	settled: deleteArticleDialogSettled,
	geometry: railBesideMainBesideSide,
	target: OPEN_DELETE_ARTICLE_POPOVER,
	capture: "element",
	pinnedText: [],
};

const ALERT_LIMIT: VisualCheckpoint = {
	name: "readlist-design-alert-limit",
	settled: alertLimitSettled,
	geometry: railBesideMainBesideSide,
	target: ALERT,
	capture: "element",
	pinnedText: [],
};

const SAVE_ERROR_CHECKPOINT: VisualCheckpoint = {
	name: "readlist-design-save-error",
	settled: saveErrorSettled,
	geometry: railBesideMainBesideSide,
	target: SAVE_CARD,
	capture: "element",
	pinnedText: [],
};

const SUBSCRIPTION_TRIAL: VisualCheckpoint = {
	name: "readlist-design-subscription-trial",
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
	name: "readlist-design-subscription-cancellation",
	settled: subscriptionCancellationSettled,
	geometry: railBesideMainBesideSide,
	target: SUBSCRIPTION_BANNER,
	capture: "element",
	pinnedText: [],
};

const SUBSCRIPTION_INACTIVE: VisualCheckpoint = {
	name: "readlist-design-subscription-inactive",
	settled: subscriptionInactiveSettled,
	geometry: pageFromTopGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const SETUP_GUIDE_EMAIL_STEP: VisualCheckpoint = {
	name: "readlist-design-setup-guide-email-step",
	settled: setupGuideEmailStepSettled,
	geometry: railBesideMainBesideSide,
	target: SETUP_GUIDE,
	capture: "element",
	pinnedText: [],
};

const SETUP_GUIDE_NEXT_READ: VisualCheckpoint = {
	name: "readlist-design-setup-guide-next-read",
	settled: setupGuideNextReadSettled,
	geometry: railBesideMainBesideSide,
	target: SETUP_GUIDE,
	capture: "element",
	pinnedText: [],
};

const THEMES = ["light", "dark"] as const;

function withTheme(checkpoint: VisualCheckpoint, theme: (typeof THEMES)[number]): VisualCheckpoint {
	return { ...checkpoint, name: `${checkpoint.name}-${theme}` };
}

test.describe("Readlist design page (empty)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`shows the empty state with nothing saved (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-empty-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design");

			await captureCheckpoint(page, withTheme(PAGE_EMPTY, theme));
		});
	}
});

test.describe("Readlist design page (seeded articles)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`shows two seeded articles with pinned saved times (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-articles-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedTwoArticles(page, userId, email);
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design");
			await page.waitForSelector(`${PAGINATION_PAGES} ${PAGINATION_PAGE}`);

			await captureCheckpoint(page, withTheme(PAGE_ARTICLES, theme));
		});
	}
});

test.describe("Readlist design page (custom readlist)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`lands on a freshly made readlist with its own empty state (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-custom-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, email);

			await captureCheckpoint(page, withTheme(PAGE_CUSTOM_READLIST, theme));
		});
	}
});

test.describe("Readlist design page (subscription inactive)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`shows the inactive banner with the disabled save form (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-subscription-inactive-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedSubscriptionState(page, { userId, state: "inactive" });
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design");

			await captureCheckpoint(page, withTheme(SUBSCRIPTION_INACTIVE, theme));
		});
	}
});

test.describe("Readlist design read tab", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the article marked read on the Read tab (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-read-tab-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedTwoArticles(page, userId, email);
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design");
			await markFirstArticleRead(page);
			await gotoDesignQueue(page, "?tab=done&feature=design");

			await captureCheckpoint(page, withTheme(PAGE_READ_TAB, theme));
		});
	}
});

test.describe("Readlist design rail menu", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`opens the rail menu for a custom readlist (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-rail-menu-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, email);

			await captureCheckpoint(page, withTheme(RAIL_MENU_OPEN, theme));
		});
	}

	for (const theme of THEMES) {
		test(`opens the rename dialog from the rail menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-rename-dialog-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, email);

			await captureCheckpoint(page, withTheme(RENAME_DIALOG, theme));
		});
	}

	for (const theme of THEMES) {
		test(`opens the delete-readlist dialog from the rail menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-delete-readlist-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, email);

			await captureCheckpoint(page, withTheme(DELETE_READLIST_DIALOG, theme));
		});
	}
});

test.describe("Readlist design card menu", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`opens the card menu on the first article (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-card-menu-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedTwoArticles(page, userId, email);
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design");

			await captureCheckpoint(page, withTheme(CARD_MENU_OPEN, theme));
		});
	}

	for (const theme of THEMES) {
		test(`opens the delete-article dialog from the card menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-delete-article-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedTwoArticles(page, userId, email);
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design");

			await captureCheckpoint(page, withTheme(DELETE_ARTICLE_DIALOG, theme));
		});
	}
});

test.describe("Readlist design alerts", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the readlist-limit alert (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-alert-limit-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design&queue_error=limit");

			await captureCheckpoint(page, withTheme(ALERT_LIMIT, theme));
		});
	}

	for (const theme of THEMES) {
		test(`shows the save-form error for a malformed URL (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-save-error-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design&error_code=malformed_url");

			await captureCheckpoint(page, withTheme(SAVE_ERROR_CHECKPOINT, theme));
		});
	}
});

test.describe("Readlist design subscription banner", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the trial-countdown banner with pinned tile values (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-subscription-trial-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedSubscriptionState(page, { userId, state: "trialing" });
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design");

			await captureCheckpoint(page, withTheme(SUBSCRIPTION_TRIAL, theme));
		});
	}

	for (const theme of THEMES) {
		test(`shows the cancellation-scheduled banner (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-subscription-cancellation-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedSubscriptionState(page, {
				userId,
				state: "cancellation-scheduled",
				at: "2027-03-01T00:00:00.000Z",
			});
			await loginAs(page, email);
			await gotoDesignQueue(page, "?feature=design");

			await captureCheckpoint(page, withTheme(SUBSCRIPTION_CANCELLATION, theme));
		});
	}
});

test.describe("Readlist design setup guide", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the email step as current at 50% complete (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-setup-email-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoDesignQueueWithCookies(page, [
				{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
				{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE },
			]);

			await captureCheckpoint(page, withTheme(SETUP_GUIDE_EMAIL_STEP, theme));
		});
	}

	for (const theme of THEMES) {
		test(`shows the next-read step as current at 75% complete with its saves chip (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-design-setup-next-read-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedInboxArticleQueued(page, userId);
			await loginAs(page, email);
			await gotoDesignQueueWithCookies(page, [
				{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
				{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE },
			]);

			await captureCheckpoint(page, withTheme(SETUP_GUIDE_NEXT_READ, theme));
		});
	}
});
