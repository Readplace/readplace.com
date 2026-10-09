import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { MAX_ARTICLE_TOPIC_LENGTH, NEXT_READ_MINIMUM_SAVES } from "@packages/domain/article";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { requireEnv } from "@packages/require-env";
import { encodeImportSkippedCookie, IMPORT_SKIPPED_COOKIE_NAME } from "../runtime/web/pages/import/import-skipped-cookie";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import {
	clickAndWaitForPageReload,
	fileArticleIntoReadlist,
	nameNewReadlist,
	openReadlistSwitcher,
	railIsOpen,
	renameableSlugs,
} from "./page-interactions";
import { growRailToFitOpenFlyout } from "./readlist.browser";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const DESKTOP = { width: 1280, height: 900 };
const DESKTOP_TALL = { width: 1280, height: 1700 };
const PHONE = { width: 390, height: 844 };
const PHONE_TALL = { width: 390, height: 2600 };
const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const UNBROKEN_WORD = "Supercalifragilisticexpialidociousandthensomemoretokeepgoing";
const LONGEST_READLIST_NAME = "Longestpossiblereadlist".padEnd(READLIST_LABEL_MAX_LENGTH, "x");
const LONGEST_TOPICS = ["Sustainable urban design", "Behavioural neuroscience", "International trade laws"];
const SEEDED_TOPICS = ["Productivity", "Focus", "Lifestyle"];
const RENAME_INPUT = "[data-test-readlist-rename-input]";
const RENAME_SAVE = '[data-test-action="readlist-rename-save"]';

const MAIN = "main.readlist";
const RAIL = ".readlist__rail";
const MAIN_COLUMN = ".readlist__main";
const SIDE = ".readlist__side";
const NEW_READLIST_BUTTON = '[data-test-action="new-readlist"]';
const ACTIVE_READLIST_LINK = '[data-test-readlist][aria-current="page"]';
const ACTIVE_READLIST_LABEL = `${ACTIVE_READLIST_LINK} [data-test-readlist-label]`;
const READLIST_SWITCHER_TOGGLE = '[data-test-action="readlist-switcher"]';
const READLIST_MENU_SUMMARY = '[data-test-action="readlist-menu"]';
const READLIST_MENU_PANEL = "[data-test-readlist-menu]";
const READLIST_MENU_FLYOUT = `${READLIST_MENU_PANEL} .menu__panel`;
const READLIST_MENU_RENAME = '[data-test-action="readlist-rename"]';
const READLIST_MENU_DELETE = '[data-test-action="readlist-delete"]';
const READLIST_RENAME_POPOVER = '[data-test-confirm-popover="readlist-rename"]';
const READLIST_DELETE_POPOVER = '[data-test-confirm-popover="readlist-delete"]';
const READLIST_RENAME_CANCEL = '[data-test-action="readlist-rename-cancel"]';
const READLIST_DELETE_CONFIRM = '[data-test-action="readlist-delete-confirm"]';
const READLIST_DELETE_CANCEL = '[data-test-action="readlist-delete-cancel"]';
const OPEN_READLIST_DELETE_POPOVER = `${READLIST_DELETE_POPOVER}:popover-open`;
const READLIST_CREATE_POPOVER = '[data-test-confirm-popover="readlist-create"]';
const READLIST_CREATE_CANCEL = '[data-test-action="readlist-create-cancel"]';
const READLIST_CREATE_SAVE = '[data-test-action="readlist-create-save"]';
const READLIST_CREATE_ERROR = "[data-test-readlist-create-error]";
const SAVE_CARD = "[data-test-save-card]";
const SAVE_ERROR = "[data-test-save-error]";
const SAVE_INPUT = `${SAVE_CARD} input[name="url"]`;
const SAVE_BUTTON = `${SAVE_CARD} button[type="submit"]`;
const SAVE_FIELD = `${SAVE_CARD} .readlist-save__field`;
const IMPORT_FLASH = "[data-test-import-flash]";
const IMPORT_SKIPPED = "[data-test-import-skipped]";
const SAVE_TIP_POPOVER = '[data-test-confirm-popover="save-tip"]';
const ARTICLE = "[data-test-article]";
const FIRST_CARD = "#latest-saved";
const CARD_MARK_READ = '[data-test-action="mark-read"]';
const CARD_MENU_SUMMARY = '[data-test-action="article-menu"]';
const CARD_MENU_PANEL = "[data-test-article-menu]";
const CARD_DELETE = '[data-test-action="delete"]';
const CARD_MOVE = '[data-test-action="move"]';
const NAV_USER = "[data-test-nav-user]";
const NAV_USER_MENU = `${NAV_USER} .nav__user-menu`;
const CARD_TIME = ".readlist-article__time";
const PROCESSING_CARD = '[data-card-status="pending"]';
const CARD_PROCESSING_LINE = "[data-test-processing]";
const DELETE_ARTICLE_POPOVER = '[data-test-confirm-popover="delete"]';
const OPEN_DELETE_ARTICLE_POPOVER = `${DELETE_ARTICLE_POPOVER}:popover-open`;
const DELETE_ARTICLE_NEVER = `${OPEN_DELETE_ARTICLE_POPOVER} [data-test-action="delete-confirm-never"]`;
const DELETE_ARTICLE_CONFIRM = `${OPEN_DELETE_ARTICLE_POPOVER} [data-test-action="delete-confirm"]`;
const OPEN_MOVE_ARTICLE_POPOVER = '[data-test-confirm-popover="move"]:popover-open';
const MOVE_ARTICLE_FORM = `${OPEN_MOVE_ARTICLE_POPOVER} [data-test-form="readlist-move"]`;
const MOVE_ARTICLE_DESTINATION = `${OPEN_MOVE_ARTICLE_POPOVER} [data-test-move-destination]`;
const MOVE_ARTICLE_CREATE = `${OPEN_MOVE_ARTICLE_POPOVER} [data-test-action="move-create"]`;
const MOVE_ARTICLE_CANCEL = `${OPEN_MOVE_ARTICLE_POPOVER} [data-test-action="move-cancel"]`;
const MOVE_ARTICLE_CONFIRM = `${OPEN_MOVE_ARTICLE_POPOVER} [data-test-action="move-confirm"]`;
const MARK_STATUS_CONFIRM_BUTTON = '[data-test-action="mark-status-confirm"]';
const EMPTY = "[data-test-empty-readlist]";
const LISTING = "[data-test-listing]";
const LISTING_COUNT = "#readlist-count";
const LISTING_HEADER = ".readlist-listing__header";
const EMPTY_ART = `${EMPTY} [data-test-illustration="book-lightbulb"]`;
const EMPTY_TEXT = `${EMPTY} .readlist-empty__text`;
const EMPTY_ACTION = `${EMPTY} [data-test-empty-action]`;
const PAGINATION_PAGES = "#readlist-pages";
const PAGINATION_PAGE = "[data-test-pagination-page]";
const READ_FILTER_TAB = '[data-test-filter="read"]';
const FILTER_TABS = "[data-test-filters]";
const ALERT = '[data-test-alert="readlist"]';
const ALERT_TITLE = `${ALERT} [data-test-alert-title]`;
const SUBSCRIPTION_BANNER = "[data-test-subscription-banner]";
const SETUP_GUIDE = "[data-test-setup-guide]";
const TOAST = "[data-test-toast]";
const ONBOARDING_PROGRESS = "[data-test-onboarding-progress]";
const ONBOARDING_CHIP = "[data-test-onboarding-chip]";
const SUBSCRIPTION_CHIP = "[data-test-subscription-chip]";
const PAGE_READLIST = "body.page-readlist";

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
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
		topics?: string[];
	},
): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.url,
			title: input.title,
			content: "<p>Seeded body for the readlist visual baseline.</p>",
			contentFetchedAt: SEEDED_FETCHED_AT,
			savedAt: input.savedAt,
			savedByUserId: input.userId,
			excerpt: input.excerpt,
			generatedSummary: {
				summary: "Seeded summary for the readlist visual baseline.",
				excerpt: input.excerpt,
				topics: input.topics,
			},
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
	return SeededArticle.parse(await response.json()).articleId;
}

function seededArticles(
	stamp: string,
): { url: string; title: string; savedAt: string; excerpt: string; topics?: string[] }[] {
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
			excerpt:
				"A fixed excerpt for the readlist visual baseline, long enough to occupy the card's excerpt lines.",
			topics: SEEDED_TOPICS,
		},
	];
}

async function seedTwoArticles(page: Page, userId: string, stamp: string): Promise<void> {
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

async function openCustomReadlist(
	page: Page,
	input: { email: string; openRail: (page: Page) => Promise<void> },
): Promise<void> {
	await createVerifiedUser(page, input.email);
	await loginAs(page, input.email);
	await gotoReadlistQueue(page, "");
	await input.openRail(page);
	await clickAndWaitForCounts(page, await nameNewReadlist(page, "New Readlist"));
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
		rows: 2,
	});
}

async function cardMenuPhoneGeometry(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	await openMenuGeometry(page, {
		panel: `${FIRST_CARD} .menu__panel`,
		toggle: `${FIRST_CARD} ${CARD_MENU_SUMMARY}`,
		rows: 2,
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

async function columnTopsAlign(page: Page): Promise<void> {
	await pageFromTopGeometry(page);
	await saveCardRowGeometry(page);
	const save = await measuredBox(page, SAVE_CARD);
	const rail = await measuredBox(page, RAIL);
	const side = await measuredBox(page, SIDE);
	const tabs = await measuredBox(page, FILTER_TABS);
	const listing = await measuredBox(page, LISTING);
	assert.ok(near(save.y, rail.y), `the save card and rail must start together, measured ${save.y}px and ${rail.y}px`);
	assert.ok(near(save.y, side.y), `the save card and side column must start together, measured ${save.y}px and ${side.y}px`);
	assert.ok(near(tabs.y - (save.y + save.height), 32), "the tabs must sit 32px below the save card");
	assert.ok(near(listing.y - (tabs.y + tabs.height), 32), "the listing must sit 32px below the tabs");
}

async function articlesPageGeometry(page: Page): Promise<void> {
	await columnTopsAlign(page);
	const listing = await measuredBox(page, LISTING);
	const pagination = await measuredBox(page, "[data-test-pagination]");
	assert.ok(near(pagination.y - (listing.y + listing.height), 16), "pagination must sit 16px below the listing");
}

async function alertLimitGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	const alert = await measuredBox(page, ALERT);
	const save = await measuredBox(page, SAVE_CARD);
	assert.ok(near(save.y - (alert.y + alert.height), 16), "the save card must sit 16px below the readlist alert");
}

async function saveCardRowGeometry(page: Page): Promise<void> {
	const input = await measuredBox(page, SAVE_INPUT);
	const button = await measuredBox(page, SAVE_BUTTON);
	assert.ok(near(button.x - (input.x + input.width), 8), "Save must sit 8px beside the field above the phone breakpoint");
	assert.ok(near(button.y, input.y), "Save must align with the field's top edge");
	assert.ok(near(input.height, 48), "the save field must stay 48px high");
	assert.ok(near(button.height, 48), "Save must keep its 48px height");
}

async function saveCardPhoneGeometry(page: Page): Promise<void> {
	const input = await measuredBox(page, SAVE_INPUT);
	const button = await measuredBox(page, SAVE_BUTTON);
	const content = await page.locator(SAVE_CARD).evaluate((card) => {
		const styles = getComputedStyle(card);
		return {
			x: card.getBoundingClientRect().x + Number.parseFloat(styles.borderLeftWidth) + Number.parseFloat(styles.paddingLeft),
			width: card.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight),
		};
	});
	assert.ok(near(input.width, content.width), "the save field must fill the card's content width on a phone");
	assert.ok(near(input.height, 48), "the save field must stay 48px high on a phone");
	assert.ok(near(button.y - (input.y + input.height), 16), "Save must sit 16px below the field on a phone");
	assert.ok(near(button.height, 48), "Save must keep its 48px height on a phone");
	assert.ok(button.width < content.width, "Save must hold its own width on a phone");
	assert.ok(near(button.x, content.x), "Save must align with the field's leading edge on a phone");
}

async function saveErrorPhoneGeometry(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	const input = await measuredBox(page, SAVE_INPUT);
	const message = await measuredBox(page, SAVE_ERROR);
	const field = await measuredBox(page, SAVE_FIELD);
	const button = await measuredBox(page, SAVE_BUTTON);
	assert.ok(near(message.y - (input.y + input.height), 8), "the save error must sit 8px below the phone field");
	assert.ok(near(button.y - (field.y + field.height), 16), "Save must sit 16px below the field and its error");
}

async function emptyActionFitsEveryViewport(page: Page, key: "install" | "view-unread"): Promise<void> {
	const action = `${EMPTY} [data-test-empty-action="${key}"]`;
	for (const viewport of [WCAG_REFLOW_MINIMUM, PHONE, { width: 768, height: 900 }, DESKTOP]) {
		await page.setViewportSize(viewport);
		await expect(page.locator(action)).toBeVisible();
		await neverScrollsSideways(page);
		const box = await measuredBox(page, action);
		assert.equal(
			Math.round(box.height),
			48,
			`the ${key} action must stay one 48px line at ${viewport.width}px, measured ${box.height}px`,
		);
	}
}

async function neverScrollsSideways(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the queue page must never scroll sideways");
}

async function railStacksAboveTheListing(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	const rail = await measuredBox(page, RAIL);
	const main = await measuredBox(page, LISTING);
	assert.ok(
		rail.y + rail.height <= main.y,
		`the rail must stack above the listing on a phone, measured rail=${JSON.stringify(rail)} main=${JSON.stringify(main)}`,
	);
}

async function railFoldsToOneRow(page: Page): Promise<void> {
	const rail = await measuredBox(page, RAIL);
	const summary = await measuredBox(page, `${RAIL} ${READLIST_SWITCHER_TOGGLE}`);
	assert.equal(
		rail.height,
		summary.height,
		`a closed switcher must fold the rail to its one summary row, measured rail=${rail.height}px summary=${summary.height}px`,
	);
}

async function phonePageGeometry(page: Page): Promise<void> {
	await railStacksAboveTheListing(page);
	await saveCardPhoneGeometry(page);
	await guideSitsAboveTheTabs(page);
	await pageFitsTheClip(page);
}

async function guideSitsAboveTheTabs(page: Page): Promise<void> {
	const guide = await measuredBox(page, SETUP_GUIDE);
	const save = await measuredBox(page, SAVE_CARD);
	const tabs = await measuredBox(page, FILTER_TABS);
	assert.ok(save.y + save.height <= guide.y, "the setup guide must follow the save card on a phone");
	assert.ok(guide.y + guide.height <= tabs.y, "the setup guide must lead the tabs and list on a phone");
}

async function foldedGuideSettled(page: Page): Promise<void> {
	await emptyPageSettled(page);
	expect(await page.locator(".setup-guide__fold").evaluate((el) => el.hasAttribute("open"))).toBe(false);
	const steps = page.locator("[data-test-onboarding-steps]");
	await expect(steps).toBeAttached();
	await expect(steps).toBeHidden();
}

async function foldedGuideGeometry(page: Page): Promise<void> {
	await phonePageGeometry(page);
	const guide = await measuredBox(page, SETUP_GUIDE);
	assert.ok(guide.height <= 180, "the folded guide must leave room for the reading list");
}

function near(actual: number, expected: number): boolean {
	return Math.abs(actual - expected) <= 1;
}

async function topicRowGeometry(page: Page, viewport: { width: number; height: number }): Promise<void> {
	await page.setViewportSize(viewport);
	await neverScrollsSideways(page);
	const excerpt = await measuredBox(page, `${ARTICLE} [data-test-article-excerpt]`);
	const row = await measuredBox(page, `${ARTICLE} [data-test-article-topics]`);
	const foot = await measuredBox(page, `${ARTICLE} [data-test-article-foot]`);
	const chips = await Promise.all(
		[1, 2, 3].map((position) => measuredBox(page, `${ARTICLE} [data-test-article-topic]:nth-child(${position})`)),
	);
	for (const chip of chips) {
		assert.ok(near(chip.height, 26), `a topic chip must be 26px tall at ${viewport.width}px, measured ${chip.height}px`);
	}
	for (const [left, right] of [
		[chips[0], chips[1]],
		[chips[1], chips[2]],
	]) {
		const gap = right.x - (left.x + left.width);
		assert.ok(near(gap, 4), `neighbouring topic chips must sit 4px apart at ${viewport.width}px, measured ${gap}px`);
		assert.ok(near(right.y, left.y), `the three topic chips must share one line at ${viewport.width}px`);
	}
	const underExcerpt = row.y - (excerpt.y + excerpt.height);
	assert.ok(
		near(underExcerpt, 12),
		`the topics row must start 12px under the excerpt at ${viewport.width}px, measured ${underExcerpt}px`,
	);
	const aboveFoot = foot.y - (row.y + row.height);
	assert.ok(
		near(aboveFoot, 16),
		`the foot must start 16px under the topics row at ${viewport.width}px, measured ${aboveFoot}px`,
	);
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

async function createDialogGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	const panel = await measuredBox(page, READLIST_CREATE_POPOVER);
	const cancel = await measuredBox(page, READLIST_CREATE_CANCEL);
	const save = await measuredBox(page, READLIST_CREATE_SAVE);
	assert.ok(near(panel.width, 600));
	assert.ok(near(cancel.y, save.y));
	assert.ok(near(save.x, cancel.x + cancel.width + 8));
	assert.ok(near(save.x + save.width, panel.x + panel.width - 33));
}

async function deleteReadlistDialogGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	const panel = await measuredBox(page, OPEN_READLIST_DELETE_POPOVER);
	const cancel = await measuredBox(page, `${OPEN_READLIST_DELETE_POPOVER} ${READLIST_DELETE_CANCEL}`);
	const commit = await measuredBox(page, `${OPEN_READLIST_DELETE_POPOVER} ${READLIST_DELETE_CONFIRM}`);
	assert.ok(near(panel.width, 600));
	assert.ok(near(panel.height, 298), `the plain delete dialog must be 298px tall, measured ${panel.height}px`);
	assert.ok(near(cancel.y, commit.y));
	assert.ok(near(commit.x, cancel.x + cancel.width + 8));
	const leftSlack = cancel.x - panel.x;
	const rightSlack = panel.x + panel.width - (commit.x + commit.width);
	assert.ok(near(leftSlack, rightSlack));
	const headerActions = await page
		.locator(`${OPEN_READLIST_DELETE_POPOVER} .confirm-popover__header [data-test-action]`)
		.evaluateAll((actions) => actions.map((action) => action.getAttribute("data-test-action")));
	assert.deepEqual(headerActions, [], "the delete dialog backs out through Cancel, not a close control");
}

function openDeleteReadlistDialog(slug: string): string {
	return `${READLIST_DELETE_POPOVER}[data-test-confirm-subject="${slug}"]:popover-open`;
}

function assertDialogMeasurement(input: {
	description: string;
	actual: number;
	expected: number;
	tolerance: number;
}): void {
	assert.ok(
		Math.abs(input.actual - input.expected) <= input.tolerance,
		`${input.description} must be ${input.expected}px (±${input.tolerance}), measured ${input.actual}px`,
	);
}

async function selectDrawsItsOwnChevron(page: Page, dialog: string): Promise<void> {
	const field = await measuredBox(page, `${dialog} .form-input--select`);
	const slot = await measuredBox(page, `${dialog} .form-input__chevron`);
	const glyph = await measuredBox(page, `${dialog} .form-input__chevron svg`);
	assertDialogMeasurement({ description: "the chevron's width", actual: glyph.width, expected: 20, tolerance: 0.5 });
	assertDialogMeasurement({ description: "the chevron's height", actual: glyph.height, expected: 20, tolerance: 0.5 });
	assertDialogMeasurement({
		description: "the chevron's right edge",
		actual: glyph.x + glyph.width,
		expected: field.x + field.width - 13,
		tolerance: 1,
	});
	assertDialogMeasurement({
		description: "the chevron slot's top",
		actual: slot.y,
		expected: field.y + 1,
		tolerance: 0.5,
	});
	assertDialogMeasurement({
		description: "the chevron slot's bottom",
		actual: slot.y + slot.height,
		expected: field.y + field.height - 1,
		tolerance: 0.5,
	});
	const endPadding = await page
		.locator(`${dialog} [data-test-migrate-select]`)
		.evaluate((select) => getComputedStyle(select).paddingRight);
	assert.equal(endPadding, "48px", "the select must keep its value clear of the chevron");
}

async function moveOrDeleteDialogGeometry(page: Page, dialog: string): Promise<void> {
	const panel = await measuredBox(page, dialog);
	const label = await measuredBox(page, `${dialog} .form-field__label`);
	const field = await measuredBox(page, `${dialog} .form-input--select`);
	const row = await measuredBox(page, `${dialog} .confirm-popover__buttons`);
	const cancel = await measuredBox(page, `${dialog} ${READLIST_DELETE_CANCEL}`);
	const commit = await measuredBox(page, `${dialog} ${READLIST_DELETE_CONFIRM}`);
	const contentLeft = panel.x + 33;
	assertDialogMeasurement({ description: "the label's left edge", actual: label.x, expected: contentLeft, tolerance: 0.5 });
	assertDialogMeasurement({ description: "the select's left edge", actual: field.x, expected: contentLeft, tolerance: 0.5 });
	assertDialogMeasurement({ description: "the select's width", actual: field.width, expected: 534, tolerance: 0.5 });
	assertDialogMeasurement({
		description: "Delete readlist's right edge",
		actual: commit.x + commit.width,
		expected: field.x + field.width,
		tolerance: 0.5,
	});
	assertDialogMeasurement({
		description: "Delete readlist's left edge",
		actual: commit.x,
		expected: cancel.x + cancel.width + 8,
		tolerance: 0.5,
	});
	assertDialogMeasurement({
		description: "the button row's top",
		actual: row.y,
		expected: field.y + field.height + 24,
		tolerance: 1,
	});
	await selectDrawsItsOwnChevron(page, dialog);
	assertDialogMeasurement({ description: "the dialog's height", actual: panel.height, expected: 395, tolerance: 1 });
}

async function moveOrDeleteDialogPhoneGeometry(page: Page, dialog: string): Promise<void> {
	await stackedDialogButtons(
		page,
		dialog,
		`${dialog} ${READLIST_DELETE_CANCEL}`,
		`${dialog} ${READLIST_DELETE_CONFIRM}`,
	);
	const panel = await measuredBox(page, dialog);
	const field = await measuredBox(page, `${dialog} .form-input--select`);
	assert.ok(near(field.x, panel.x + 25), `the select must start at the content edge, measured ${field.x}px`);
	assert.ok(
		near(field.x + field.width, panel.x + panel.width - 25),
		`the select must end at the content edge, measured ${field.x + field.width}px`,
	);
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

async function createDialogPhoneGeometry(page: Page): Promise<void> {
	await stackedDialogButtons(page, READLIST_CREATE_POPOVER, READLIST_CREATE_CANCEL, READLIST_CREATE_SAVE);
}

async function deleteArticleDialogPhoneGeometry(page: Page): Promise<void> {
	await stackedDialogButtons(page, OPEN_DELETE_ARTICLE_POPOVER, DELETE_ARTICLE_NEVER, DELETE_ARTICLE_CONFIRM);
}

async function moveArticleDialogGeometry(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	const panel = await measuredBox(page, OPEN_MOVE_ARTICLE_POPOVER);
	const form = await measuredBox(page, MOVE_ARTICLE_FORM);
	const cancel = await measuredBox(page, MOVE_ARTICLE_CANCEL);
	const commit = await measuredBox(page, MOVE_ARTICLE_CONFIRM);
	assertDialogMeasurement({ description: "the move dialog's width", actual: panel.width, expected: 600, tolerance: 1 });
	const rows = page.locator(`${MOVE_ARTICLE_DESTINATION}, ${MOVE_ARTICLE_CREATE}`);
	await expect(rows).toHaveCount(3);
	for (const row of await rows.all()) {
		const box = await row.boundingBox();
		assert.ok(box, "a visible move-dialog row must have a box");
		assertDialogMeasurement({ description: "a move-dialog row's height", actual: box.height, expected: 56, tolerance: 0.5 });
	}
	assertDialogMeasurement({ description: "Cancel's top", actual: cancel.y, expected: commit.y, tolerance: 0.5 });
	assertDialogMeasurement({
		description: "the commit button's left edge",
		actual: commit.x,
		expected: cancel.x + cancel.width + 8,
		tolerance: 0.5,
	});
	assertDialogMeasurement({
		description: "the commit button's right edge",
		actual: commit.x + commit.width,
		expected: form.x + form.width,
		tolerance: 1,
	});
}

async function moveArticleDialogPhoneGeometry(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	const viewport = page.viewportSize();
	assert(viewport, "the phone dialog needs a fixed viewport");
	const panel = await measuredBox(page, OPEN_MOVE_ARTICLE_POPOVER);
	assert.ok(
		panel.x >= 16 && panel.x + panel.width <= viewport.width - 16,
		`the move dialog must keep the 16px screen gutters, measured ${JSON.stringify(panel)}`,
	);
	await stackedDialogButtons(page, OPEN_MOVE_ARTICLE_POPOVER, MOVE_ARTICLE_CANCEL, MOVE_ARTICLE_CONFIRM);
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

function assertSubscriptionMeasurement(input: {
	description: string;
	actual: number;
	expected: number;
}): void {
	assert.ok(
		Math.abs(input.actual - input.expected) <= 0.5,
		`${input.description} must be ${input.expected}px, measured ${input.actual}px`,
	);
}

function subscriptionCtaIsMediumAndFullWidth(input: {
	card: { x: number; width: number };
	cta: { x: number; width: number; height: number };
}): void {
	assertSubscriptionMeasurement({ description: "the subscription CTA height", actual: input.cta.height, expected: 40 });
	assertSubscriptionMeasurement({
		description: "the subscription CTA left inset",
		actual: input.cta.x - input.card.x,
		expected: 21,
	});
	assertSubscriptionMeasurement({
		description: "the subscription CTA width",
		actual: input.cta.width,
		expected: input.card.width - 42,
	});
}

async function subscriptionTrialGeometry(page: Page): Promise<void> {
	const card = await measuredBox(page, SUBSCRIPTION_BANNER);
	const title = await measuredBox(page, `${SUBSCRIPTION_BANNER} .readlist-subscription__title`);
	const body = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-banner-message]`);
	const tiles = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-trial-tiles]`);
	const firstTile = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-trial-tiles] > div:nth-child(1)`);
	const secondTile = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-trial-tiles] > div:nth-child(2)`);
	const thirdTile = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-trial-tiles] > div:nth-child(3)`);
	const cta = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-action="subscribe-plans-open"]`);
	const note = await measuredBox(page, `${SUBSCRIPTION_BANNER} .readlist-subscription__note`);
	assertSubscriptionMeasurement({ description: "the trial card height", actual: card.height, expected: 269 });
	assertSubscriptionMeasurement({ description: "the trial title top inset", actual: title.y - card.y, expected: 21 });
	assertSubscriptionMeasurement({ description: "the trial title line height", actual: title.height, expected: 20 });
	assertSubscriptionMeasurement({
		description: "the trial title-to-body gap",
		actual: body.y - (title.y + title.height),
		expected: 4,
	});
	assertSubscriptionMeasurement({
		description: "the trial body-to-tiles gap",
		actual: tiles.y - (body.y + body.height),
		expected: 16,
	});
	for (const tile of [firstTile, secondTile, thirdTile]) {
		assertSubscriptionMeasurement({ description: "the trial tile height", actual: tile.height, expected: 60 });
	}
	for (const tile of [secondTile, thirdTile]) {
		assertSubscriptionMeasurement({ description: "the equal trial tile width", actual: tile.width, expected: firstTile.width });
	}
	assertSubscriptionMeasurement({
		description: "the first-to-second trial tile gap",
		actual: secondTile.x - (firstTile.x + firstTile.width),
		expected: 8,
	});
	assertSubscriptionMeasurement({
		description: "the second-to-third trial tile gap",
		actual: thirdTile.x - (secondTile.x + secondTile.width),
		expected: 8,
	});
	assertSubscriptionMeasurement({ description: "the trial tiles' left edge", actual: firstTile.x, expected: cta.x });
	assertSubscriptionMeasurement({
		description: "the trial tiles' right edge",
		actual: thirdTile.x + thirdTile.width,
		expected: cta.x + cta.width,
	});
	assertSubscriptionMeasurement({
		description: "the trial tiles-to-CTA gap",
		actual: cta.y - (tiles.y + tiles.height),
		expected: 16,
	});
	subscriptionCtaIsMediumAndFullWidth({ card, cta });
	assertSubscriptionMeasurement({
		description: "the trial CTA-to-note gap",
		actual: note.y - (cta.y + cta.height),
		expected: 8,
	});
	assertSubscriptionMeasurement({
		description: "the trial note bottom inset",
		actual: card.y + card.height - (note.y + note.height),
		expected: 21,
	});
}

async function subscriptionCancellationGeometry(page: Page): Promise<void> {
	const card = await measuredBox(page, SUBSCRIPTION_BANNER);
	const chip = await measuredBox(page, `${SUBSCRIPTION_BANNER} ${SUBSCRIPTION_CHIP}`);
	const title = await measuredBox(page, `${SUBSCRIPTION_BANNER} .readlist-subscription__title`);
	const body = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-banner-message]`);
	const cta = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-action="reactivate"]`);
	assertSubscriptionMeasurement({ description: "the cancellation card height", actual: card.height, expected: 214 });
	assertSubscriptionMeasurement({ description: "the cancellation chip top inset", actual: chip.y - card.y, expected: 21 });
	assertSubscriptionMeasurement({
		description: "the cancellation chip-to-title gap",
		actual: title.y - (chip.y + chip.height),
		expected: 16,
	});
	assertSubscriptionMeasurement({ description: "the cancellation title line height", actual: title.height, expected: 20 });
	assertSubscriptionMeasurement({
		description: "the cancellation title-to-body gap",
		actual: body.y - (title.y + title.height),
		expected: 4,
	});
	assertSubscriptionMeasurement({
		description: "the cancellation body-to-CTA gap",
		actual: cta.y - (body.y + body.height),
		expected: 16,
	});
	subscriptionCtaIsMediumAndFullWidth({ card, cta });
}

async function subscriptionInactiveGeometry(page: Page): Promise<void> {
	const card = await measuredBox(page, SUBSCRIPTION_BANNER);
	const guide = await measuredBox(page, SETUP_GUIDE);
	assertSubscriptionMeasurement({ description: "the inactive card height", actual: card.height, expected: 214 });
	assertSubscriptionMeasurement({
		description: "the subscription-to-setup-guide gap",
		actual: guide.y - (card.y + card.height),
		expected: 24,
	});
}

async function subscriptionNoticeLeadsTheListing(page: Page): Promise<void> {
	await phonePageGeometry(page);
	const banner = await measuredBox(page, SUBSCRIPTION_BANNER);
	const listing = await measuredBox(page, LISTING);
	const guide = await measuredBox(page, SETUP_GUIDE);
	const cta = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-action="subscribe-plans-open"]`);
	assert.ok(
		banner.y + banner.height <= listing.y,
		`a trial notice must stay above the article list on a phone, measured banner=${JSON.stringify(banner)} listing=${JSON.stringify(listing)}`,
	);
	assert.ok(banner.y + banner.height <= guide.y, "the subscription notice must lead the setup guide on a phone");
	subscriptionCtaIsMediumAndFullWidth({ card: banner, cta });
}

async function listingHeaderHidden(page: Page): Promise<void> {
	await expect(page.locator(LISTING_HEADER)).toHaveClass(/readlist-listing__header--hidden/);
}

async function binAtDrawnSize(page: Page, scope: string): Promise<void> {
	const art = await measuredBox(page, `${scope} [data-test-illustration="trash-can"]`);
	assert.equal(Math.round(art.width), 46, `the bin must keep its drawn width, measured ${art.width}px`);
	assert.equal(Math.round(art.height), 64, `the bin must keep its drawn height, measured ${art.height}px`);
}

async function emptyArtAtDrawnSize(page: Page): Promise<void> {
	const art = await measuredBox(page, EMPTY_ART);
	assert.equal(Math.round(art.width), 80, `the empty-state art must keep its drawn width, measured ${art.width}px`);
	assert.equal(Math.round(art.height), 64, `the empty-state art must keep its drawn height, measured ${art.height}px`);
}

async function emptyPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(EMPTY)).toBeVisible();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
	await listingHeaderHidden(page);
	await emptyArtAtDrawnSize(page);
	await settledSetupGuide(page);
}

async function caughtUpSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(EMPTY)).toBeVisible();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
	await listingHeaderHidden(page);
	await expect(page.locator(EMPTY_ACTION)).toHaveCount(0);
}

async function readEmptySettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(READ_FILTER_TAB)).toHaveAttribute("aria-current", "page");
	await expect(page.locator(EMPTY)).toBeVisible();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
	await listingHeaderHidden(page);
	await expect(page.locator(EMPTY_ACTION)).toHaveCount(1);
	await expect(page.locator(`${EMPTY} [data-test-empty-action="view-unread"]`)).toBeVisible();
}

async function articlesPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ARTICLE)).toHaveCount(2);
	await expect(page.locator(LISTING_COUNT)).toHaveText("2 Saved Articles");
	await settledSetupGuide(page);
}

async function readTabSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(READ_FILTER_TAB)).toHaveAttribute("aria-current", "page");
	await expect(page.locator(ARTICLE)).toHaveCount(1);
	await expect(page.locator(LISTING_COUNT)).toHaveText("1 Saved Article");
	await page.mouse.move(0, 0);
}

async function processingCardSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(PROCESSING_CARD)).toHaveCount(1);
	await expect(page.locator(`${PROCESSING_CARD} ${CARD_PROCESSING_LINE}`)).toBeVisible();
	await expect(page.locator(`${PROCESSING_CARD} ${CARD_MARK_READ}`)).toBeDisabled();
	await page.mouse.move(0, 0);
}

async function customReadlistPageSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist");
	await expect(page.locator(EMPTY)).toBeVisible();
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
	await listingHeaderHidden(page);
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

async function renameDialogPhoneSettled(page: Page): Promise<void> {
	await openReadlistSwitcher(page);
	await renameDialogSettled(page);
}

async function createDialogSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(NEW_READLIST_BUTTON);
	await page.waitForSelector(`${READLIST_CREATE_POPOVER}:popover-open`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function createDialogErrorSettled(page: Page): Promise<void> {
	await createDialogSettled(page);
	await page.locator(`${READLIST_CREATE_POPOVER} input[name="label"]`).fill("All");
	await page.click(READLIST_CREATE_SAVE);
	await expect(page.locator(READLIST_CREATE_ERROR)).not.toBeEmpty();
	await expect(page.locator(`${READLIST_CREATE_POPOVER} input[name="label"]`)).toBeFocused();
	await page.mouse.move(0, 0);
}

async function createDialogPhoneSettled(page: Page): Promise<void> {
	await openReadlistSwitcher(page);
	await createDialogSettled(page);
}

async function railPhoneOpenSettled(page: Page): Promise<void> {
	await customReadlistPageSettled(page);
	await openReadlistSwitcher(page);
	await page.mouse.move(0, 0);
}

async function readOnlyRailSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(`${RAIL} [data-test-readlist]`)).toHaveCount(3);
	await page.mouse.move(0, 0);
}

async function deleteReadlistDialogSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(READLIST_MENU_SUMMARY);
	await expect(page.locator(READLIST_MENU_PANEL)).toHaveAttribute("open", "");
	await page.click(READLIST_MENU_DELETE);
	await page.waitForSelector(OPEN_READLIST_DELETE_POPOVER);
	await waitForBrandFonts(page, ["Inter"]);
	await binAtDrawnSize(page, OPEN_READLIST_DELETE_POPOVER);
}

async function openTwoReadlistsWithAFiledArticle(
	page: Page,
	input: { email: string; openRail: (page: Page) => Promise<void> },
): Promise<{ first: string; second: string }> {
	const userId = await createVerifiedUser(page, input.email);
	const articleId = await seedCrawledArticle(page, {
		url: `https://example.com/readlist-move-or-delete-${input.email}`,
		title: "An article filed into a readlist",
		savedAt: "2026-07-12T09:14:00.000Z",
		excerpt: "A fixed excerpt for the move-or-delete dialog baseline.",
		userId,
	});
	await loginAs(page, input.email);
	await gotoReadlistQueue(page, "");
	await input.openRail(page);
	await clickAndWaitForCounts(page, await nameNewReadlist(page, "Ideas & Inspiration"));
	await input.openRail(page);
	await clickAndWaitForCounts(page, await nameNewReadlist(page, "Finance"));
	await expect(page.locator(`${RAIL} [data-test-readlist]`)).toHaveCount(3);
	const [first, second] = await renameableSlugs(page);
	await fileArticleIntoReadlist(page, { articleId, readlistSlug: first });
	await gotoReadlistQueue(page, "");
	return { first, second };
}

async function createReadlist(page: Page, label: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label } });
	assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
	const slug = new URL(created.url()).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function fileAnArticleBesideTwoReadlists(page: Page, email: string): Promise<{ weekend: string }> {
	const userId = await createVerifiedUser(page, email);
	const articleId = await seedCrawledArticle(page, {
		url: `https://example.com/readlist-move-article-${email}`,
		title: "An article filed into a readlist",
		savedAt: "2026-07-12T09:14:00.000Z",
		excerpt: "A fixed excerpt for the move-article dialog baseline.",
		userId,
	});
	await loginAs(page, email);
	await createReadlist(page, "Ideas & Inspiration");
	await createReadlist(page, "Finance");
	const weekend = await createReadlist(page, "Weekend");
	const filed = await page.request.post(`${BASE_URL}/queue/${articleId}/assign`, {
		form: { queue: weekend, returnTo: "/queue" },
	});
	assert.equal(filed.status(), 200, "filing the article into a readlist must land back on the listing");
	return { weekend };
}

function moveOrDeleteDialog(input: {
	first: string;
	openRail: (page: Page) => Promise<void>;
}): VisualCheckpoint {
	const dialog = openDeleteReadlistDialog(input.first);
	const menu = `[data-test-readlist-menu="${input.first}"]`;
	return {
		name: "readlist-delete-readlist-migrate-dialog",
		settled: async (page) => {
			await waitForBrandFonts(page, ["Inter"]);
			await neutralise(page);
			await input.openRail(page);
			await page.click(`${menu} ${READLIST_MENU_SUMMARY}`);
			await expect(page.locator(menu)).toHaveAttribute("open", "");
			await page.click(`${menu} ${READLIST_MENU_DELETE}`);
			await page.waitForSelector(dialog);
			await page.mouse.move(0, 0);
			await waitForBrandFonts(page, ["Inter"]);
			await binAtDrawnSize(page, dialog);
		},
		geometry: (page) => moveOrDeleteDialogGeometry(page, dialog),
		target: dialog,
		capture: "element",
		pinnedText: [],
	};
}

async function cardMenuOpenSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(`${FIRST_CARD} ${CARD_MENU_SUMMARY}`);
	await expect(page.locator(`${FIRST_CARD} ${CARD_MENU_PANEL}`)).toHaveAttribute("open", "");
	await expect(page.locator(`${FIRST_CARD} ${CARD_DELETE}`)).toBeVisible();
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

async function openMoveArticleDialog(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.click(`${FIRST_CARD} ${CARD_MENU_SUMMARY}`);
	await expect(page.locator(`${FIRST_CARD} ${CARD_MENU_PANEL}`)).toHaveAttribute("open", "");
	await page.click(`${FIRST_CARD} ${CARD_MOVE}`);
	await page.waitForSelector(OPEN_MOVE_ARTICLE_POPOVER);
}

async function moveArticleDialogSettled(page: Page): Promise<void> {
	await openMoveArticleDialog(page);
	await page.locator(MOVE_ARTICLE_DESTINATION).first().click();
	await expect(page.locator(`${MOVE_ARTICLE_DESTINATION} input[name="to"]`).first()).toBeChecked();
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
}

async function addArticleDialogSettled(page: Page): Promise<void> {
	await openMoveArticleDialog(page);
	await page.mouse.move(0, 0);
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

async function importResultSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(IMPORT_FLASH)).toBeVisible();
	await expect(page.locator(`${IMPORT_SKIPPED} [data-test-alert="import-skipped"]`)).toHaveAttribute("data-test-alert-variant", "error");
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
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
	await listingHeaderHidden(page);
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
	await expect(page.locator(ONBOARDING_PROGRESS)).toHaveAttribute("data-test-onboarding-progress", "40");
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
	await expect(page.locator(ONBOARDING_PROGRESS)).toHaveAttribute("data-test-onboarding-progress", "80");
	await expect(page.locator(ONBOARDING_CHIP)).toHaveText(`Saved 4 of ${NEXT_READ_MINIMUM_SAVES}`);
	await expect(page.locator('[data-test-onboarding-step="save-enough-for-next-read"] .setup-guide__marker')).toHaveClass("setup-guide__marker setup-guide__marker--partial setup-guide__marker--partial-1");
	await settledSetupGuide(page);
}

const PAGE_EMPTY: VisualCheckpoint = {
	name: "readlist-page-empty",
	settled: emptyPageSettled,
	geometry: columnTopsAlign,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const PAGE_ARTICLES: VisualCheckpoint = {
	name: "readlist-page-articles",
	settled: articlesPageSettled,
	geometry: articlesPageGeometry,
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

const CARD_PROCESSING: VisualCheckpoint = {
	name: "readlist-card-processing",
	settled: processingCardSettled,
	geometry: railBesideMainBesideSide,
	target: PROCESSING_CARD,
	capture: "element",
	pinnedText: [{ selector: `${PROCESSING_CARD} ${CARD_TIME}`, text: "3 days ago" }],
};

const PAGE_CAUGHT_UP: VisualCheckpoint = {
	name: "readlist-page-caught-up",
	settled: caughtUpSettled,
	geometry: railBesideMainBesideSide,
	target: LISTING,
	capture: "element",
	pinnedText: [],
};

const PAGE_READ_EMPTY: VisualCheckpoint = {
	name: "readlist-page-read-empty",
	settled: readEmptySettled,
	geometry: railBesideMainBesideSide,
	target: LISTING,
	capture: "element",
	pinnedText: [],
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
	settled: renameDialogPhoneSettled,
	geometry: renameDialogPhoneGeometry,
};

const CREATE_DIALOG: VisualCheckpoint = {
	name: "readlist-create-dialog",
	settled: createDialogSettled,
	geometry: createDialogGeometry,
	target: READLIST_CREATE_POPOVER,
	capture: "element",
	pinnedText: [],
};

const CREATE_DIALOG_ERROR: VisualCheckpoint = {
	...CREATE_DIALOG,
	name: "readlist-create-dialog-error",
	settled: createDialogErrorSettled,
};

const CREATE_DIALOG_PHONE: VisualCheckpoint = {
	...CREATE_DIALOG,
	name: "readlist-create-dialog-phone",
	settled: createDialogPhoneSettled,
	geometry: createDialogPhoneGeometry,
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

const MOVE_ARTICLE_DIALOG: VisualCheckpoint = {
	name: "readlist-move-article-dialog",
	settled: moveArticleDialogSettled,
	geometry: moveArticleDialogGeometry,
	target: OPEN_MOVE_ARTICLE_POPOVER,
	capture: "element",
	pinnedText: [],
};

const MOVE_ARTICLE_DIALOG_PHONE: VisualCheckpoint = {
	...MOVE_ARTICLE_DIALOG,
	name: "readlist-move-article-dialog-phone",
	geometry: moveArticleDialogPhoneGeometry,
};

const ADD_ARTICLE_DIALOG: VisualCheckpoint = {
	...MOVE_ARTICLE_DIALOG,
	name: "readlist-add-article-dialog",
	settled: addArticleDialogSettled,
};

const ALERT_LIMIT: VisualCheckpoint = {
	name: "readlist-alert-limit",
	settled: alertLimitSettled,
	geometry: alertLimitGeometry,
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

const SAVE_ERROR_PHONE: VisualCheckpoint = {
	...SAVE_ERROR_CHECKPOINT,
	name: "readlist-save-error-phone",
	geometry: saveErrorPhoneGeometry,
};

const IMPORT_RESULT: VisualCheckpoint = {
	name: "readlist-import-result",
	settled: importResultSettled,
	geometry: railBesideMainBesideSide,
	target: SAVE_CARD,
	capture: "element",
	pinnedText: [],
};

const IMPORT_RESULT_MORE: VisualCheckpoint = {
	...IMPORT_RESULT,
	name: "readlist-import-result-more",
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
	geometry: async (page) => {
		await railBesideMainBesideSide(page);
		await subscriptionTrialGeometry(page);
	},
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
		await subscriptionCancellationGeometry(page);
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
		await subscriptionInactiveGeometry(page);
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

const SETUP_GUIDE_PHONE_FOLDED: VisualCheckpoint = {
	name: "readlist-setup-guide-phone-folded",
	settled: foldedGuideSettled,
	geometry: foldedGuideGeometry,
	target: SETUP_GUIDE,
	capture: "page-from-top",
	pinnedText: [],
};

const PAGE_EMPTY_PHONE: VisualCheckpoint = {
	...PAGE_EMPTY,
	name: "readlist-page-empty-phone",
	geometry: phonePageGeometry,
};

const PAGE_CAUGHT_UP_PHONE: VisualCheckpoint = {
	...PAGE_CAUGHT_UP,
	name: "readlist-page-caught-up-phone",
	geometry: railStacksAboveTheListing,
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
	pinnedText: SUBSCRIPTION_TRIAL.pinnedText,
};

const RAIL_PHONE: VisualCheckpoint = {
	name: "readlist-rail-phone",
	settled: customReadlistPageSettled,
	geometry: async (page) => {
		await railStacksAboveTheListing(page);
		await railFoldsToOneRow(page);
	},
	target: RAIL,
	capture: "element",
	pinnedText: [],
};

const RAIL_PHONE_OPEN: VisualCheckpoint = {
	name: "readlist-rail-phone-open",
	settled: railPhoneOpenSettled,
	geometry: railStacksAboveTheListing,
	target: RAIL,
	capture: "element",
	pinnedText: [],
};

const RAIL_READ_ONLY: VisualCheckpoint = {
	name: "readlist-rail-read-only",
	settled: readOnlyRailSettled,
	geometry: railBesideMainBesideSide,
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
			await page.setViewportSize({ width: 1440, height: DESKTOP_TALL.height });
			await columnTopsAlign(page);
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
			await page.setViewportSize({ width: 1440, height: DESKTOP_TALL.height });
			await articlesPageGeometry(page);
		});
	}
});

test.describe("Readlist card topics", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("lays a card's topic chips 26px tall, 4px apart, 12px under the excerpt and 16px above the foot", async ({ page }, testInfo) => {
		const email = `readlist-card-topics-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedCrawledArticle(page, {
			userId,
			url: `https://example.com/readlist-topics-${email}`,
			title: "The article with three topics",
			savedAt: "2026-07-12T09:14:00.000Z",
			excerpt: "A fixed excerpt for the topic row geometry.",
			topics: SEEDED_TOPICS,
		});
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await waitForBrandFonts(page, ["Inter"]);
		await expect(page.locator(`${ARTICLE} [data-test-article-topic]`)).toHaveText(SEEDED_TOPICS);

		for (const viewport of [DESKTOP, PHONE]) {
			await topicRowGeometry(page, viewport);
		}
	});
});

test.describe("Readlist page (custom readlist)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`lands on a freshly made readlist with its own empty state (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-custom-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, { email, openRail: railIsOpen });

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

async function seedProcessingArticle(page: Page, userId: string, stamp: string): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/readlist-processing-${stamp}`,
			title: "An article still being processed",
			content: "<p>Seeded body for the readlist visual baseline.</p>",
			contentFetchedAt: SEEDED_FETCHED_AT,
			savedAt: "2026-07-12T09:14:00.000Z",
			savedByUserId: userId,
			excerpt:
				"A fixed excerpt for the readlist visual baseline, long enough to occupy the card's excerpt lines.",
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
}

test.describe("Readlist processing card", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the Processing line beside the disabled toggle (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const email = `readlist-card-processing-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await seedProcessingArticle(page, userId, email);
			await page.route("**/queue/*/card?*", (route) => route.fulfill({ status: 204 }));
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(CARD_PROCESSING, theme));
		});
	}
});

async function openCaughtUpReadlist(page: Page, email: string): Promise<void> {
	const userId = await createVerifiedUser(page, email);
	await seedCrawledArticle(page, {
		userId,
		url: `https://example.com/readlist-caught-up-${email}`,
		title: "The article the reader has already finished",
		savedAt: "2026-07-12T09:14:00.000Z",
		excerpt: "A seeded article that is marked read so the To Read tab empties.",
	});
	await loginAs(page, email);
	await gotoReadlistQueue(page, "");
	await markFirstArticleRead(page);
	await gotoReadlistQueue(page, "");
}

async function openReadEmptyReadlist(page: Page, email: string): Promise<void> {
	const userId = await createVerifiedUser(page, email);
	await seedCrawledArticle(page, {
		userId,
		url: `https://example.com/readlist-read-empty-${email}`,
		title: "The article the reader has not finished yet",
		savedAt: "2026-07-12T09:14:00.000Z",
		excerpt: "A seeded unread article so the Read tab is empty.",
	});
	await loginAs(page, email);
	await gotoReadlistQueue(page, "?tab=done");
}

test.describe("Readlist empty reasons", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the caught-up state with no action (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openCaughtUpReadlist(
				page,
				`readlist-caught-up-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`,
			);

			await captureCheckpoint(page, withTheme(PAGE_CAUGHT_UP, theme));
		});

		test(`shows the empty Read tab with one view-unread action (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openReadEmptyReadlist(
				page,
				`readlist-read-empty-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`,
			);

			await captureCheckpoint(page, withTheme(PAGE_READ_EMPTY, theme));
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
			await openCustomReadlist(page, { email, openRail: railIsOpen });

			await captureCheckpoint(page, withTheme(RAIL_MENU_OPEN, theme));
		});
	}

	for (const theme of THEMES) {
		test(`opens the rename dialog from the rail menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-rename-dialog-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, { email, openRail: railIsOpen });

			await captureCheckpoint(page, withTheme(RENAME_DIALOG, theme));
		});
	}

	for (const theme of THEMES) {
		test(`opens the delete-readlist dialog from the rail menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-delete-readlist-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await openCustomReadlist(page, { email, openRail: railIsOpen });

			await captureCheckpoint(page, withTheme(DELETE_READLIST_DIALOG, theme));
		});
	}

	for (const theme of THEMES) {
		test(`asks where the articles go before deleting a readlist that holds some (${theme})`, async ({
			page,
		}, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-delete-migrate-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const { first } = await openTwoReadlistsWithAFiledArticle(page, { email, openRail: railIsOpen });

			await captureCheckpoint(page, withTheme(moveOrDeleteDialog({ first, openRail: railIsOpen }), theme));
		});
	}
});

test.describe("Readlist create dialog", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`opens the create dialog empty from the rail (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-create-dialog-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(CREATE_DIALOG, theme));
		});
	}

	for (const theme of THEMES) {
		test(`explains a refused name under the field (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-create-dialog-error-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");

			await captureCheckpoint(page, withTheme(CREATE_DIALOG_ERROR, theme));
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

	for (const theme of THEMES) {
		test(`opens the move dialog from a custom readlist's card menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-move-article-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const { weekend } = await fileAnArticleBesideTwoReadlists(page, email);
			await gotoReadlistQueue(page, `?queue=${weekend}`);

			await captureCheckpoint(page, withTheme(MOVE_ARTICLE_DIALOG, theme));
		});
	}

	test("opens the add dialog from a card menu on All (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const email = `readlist-add-article-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await fileAnArticleBesideTwoReadlists(page, email);
		await gotoReadlistQueue(page, "");

		await captureCheckpoint(page, withTheme(ADD_ARTICLE_DIALOG, "light"));
	});
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
		await openCustomReadlist(page, { email, openRail: openReadlistSwitcher });
		await captureCheckpoint(page, RENAME_DIALOG_PHONE);
	});

	test("stacks Create readlist above Cancel in the create dialog", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const email = `readlist-create-dialog-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await captureCheckpoint(page, CREATE_DIALOG_PHONE);
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

	test("stacks Move above Cancel in the move dialog", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const email = `readlist-move-article-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const { weekend } = await fileAnArticleBesideTwoReadlists(page, email);
		await gotoReadlistQueue(page, `?queue=${weekend}`);
		await captureCheckpoint(page, MOVE_ARTICLE_DIALOG_PHONE);
	});

	test("stacks Delete readlist above Cancel under the move-or-delete field", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const email = `readlist-delete-migrate-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const { first } = await openTwoReadlistsWithAFiledArticle(page, { email, openRail: openReadlistSwitcher });
		await captureCheckpoint(page, {
			...moveOrDeleteDialog({ first, openRail: openReadlistSwitcher }),
			name: "readlist-delete-readlist-migrate-dialog-phone",
			geometry: (each) => moveOrDeleteDialogPhoneGeometry(each, openDeleteReadlistDialog(first)),
		});
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
		test(`keeps the field and Save in one row at tablet widths (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-save-tablet-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");
			await waitForBrandFonts(page, ["Inter"]);
			await neutralise(page);
			for (const viewport of [{ width: 601, height: 900 }, { width: 768, height: 900 }, { width: 1023, height: 900 }]) {
				await page.setViewportSize(viewport);
				await neverScrollsSideways(page);
				await saveCardRowGeometry(page);
			}
		});

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

test.describe("Readlist import results", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`shows imported counts and the reasons for skipped links (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-import-result-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await page.context().addCookies([{
				name: IMPORT_SKIPPED_COOKIE_NAME,
				value: encodeImportSkippedCookie([
					{ code: "unsupported_scheme", url: "chrome://extensions/" },
					{ code: "private_network", url: "http://192.168.1.10/admin" },
					{ code: "malformed_url", url: "invalid-link-".padEnd(150, "x") },
				]),
				domain: new URL(BASE_URL).hostname,
				path: "/queue",
			}]);
			await gotoReadlistQueue(page, "?import_imported=42&import_total=50&import_skipped=3");
			await expect(page.locator(IMPORT_FLASH)).toHaveText("42 of 50 links imported. 3 couldn't be imported.");
			await expect(page.locator("[data-test-import-skipped-row]")).toHaveCount(3);

			await captureCheckpoint(page, withTheme(IMPORT_RESULT, theme));
			for (const viewport of [WCAG_REFLOW_MINIMUM, PHONE]) {
				await page.setViewportSize(viewport);
				await neverScrollsSideways(page);
			}
		});

		test(`shows the remaining count after twenty skipped links (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-import-result-more-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			const skipped = [
				{ code: "unsupported_scheme" as const, url: "chrome://extensions/" },
				{ code: "private_network" as const, url: "http://192.168.1.10/admin" },
				{ code: "malformed_url" as const, url: "invalid-link-".padEnd(150, "x") },
			];
			await page.context().addCookies([{
				name: IMPORT_SKIPPED_COOKIE_NAME,
				value: encodeImportSkippedCookie(Array.from({ length: 25 }, (_, index) => skipped[index % skipped.length])),
				domain: new URL(BASE_URL).hostname,
				path: "/queue",
			}]);
			await gotoReadlistQueue(page, "?import_imported=42&import_total=50&import_skipped=25");
			await expect(page.locator("[data-test-import-skipped-row]")).toHaveCount(20);
			await expect(page.locator("[data-test-import-skipped-more]")).toHaveText("And 5 more.");

			await captureCheckpoint(page, withTheme(IMPORT_RESULT_MORE, theme));
		});
	}
});

test.describe("Readlist save card on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("keeps the field full width and Save at its own width down to 320px", async ({ page }, testInfo) => {
		const email = `readlist-save-stack-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await waitForBrandFonts(page, ["Inter"]);
		await neutralise(page);
		for (const viewport of [PHONE, WCAG_REFLOW_MINIMUM]) {
			await page.setViewportSize(viewport);
			await neverScrollsSideways(page);
			await saveCardPhoneGeometry(page);
		}
	});

	test("keeps the error between the field and Save", async ({ page }, testInfo) => {
		const email = `readlist-save-error-phone-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "?error_code=malformed_url");

		await captureCheckpoint(page, SAVE_ERROR_PHONE);
	});
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

test.describe("Readlist subscription banner on the 300px track", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1100, height: 900 } });

	test("keeps the trial card at 269px tall", async ({ page }, testInfo) => {
		const email = `readlist-subscription-trial-narrow-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedSubscriptionState(page, { userId, state: "trialing" });
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await subscriptionTrialSettled(page);

		const card = await measuredBox(page, SUBSCRIPTION_BANNER);
		assertSubscriptionMeasurement({ description: "the narrow trial card width", actual: card.width, expected: 300 });
		assertSubscriptionMeasurement({ description: "the narrow trial card height", actual: card.height, expected: 269 });
	});

	test("fits the cancellation body on two lines and its title on one line", async ({ page }, testInfo) => {
		const email = `readlist-subscription-cancellation-narrow-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedSubscriptionState(page, {
			userId,
			state: "cancellation-scheduled",
			at: "2027-03-01T00:00:00.000Z",
		});
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await subscriptionCancellationSettled(page);

		const card = await measuredBox(page, SUBSCRIPTION_BANNER);
		const title = await measuredBox(page, `${SUBSCRIPTION_BANNER} .readlist-subscription__title`);
		const body = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-banner-message]`);
		assertSubscriptionMeasurement({ description: "the narrow cancellation card width", actual: card.width, expected: 300 });
		assertSubscriptionMeasurement({ description: "the narrow cancellation card height", actual: card.height, expected: 214 });
		assertSubscriptionMeasurement({ description: "the narrow cancellation title line height", actual: title.height, expected: 20 });
		assertSubscriptionMeasurement({ description: "the narrow cancellation body height", actual: body.height, expected: 42 });
	});

	test("wraps the inactive body on three lines", async ({ page }, testInfo) => {
		const email = `readlist-subscription-inactive-narrow-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createVerifiedUser(page, email);
		await seedSubscriptionState(page, { userId, state: "inactive" });
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await subscriptionInactiveSettled(page);

		const card = await measuredBox(page, SUBSCRIPTION_BANNER);
		const body = await measuredBox(page, `${SUBSCRIPTION_BANNER} [data-test-banner-message]`);
		assertSubscriptionMeasurement({ description: "the narrow inactive card width", actual: card.width, expected: 300 });
		assertSubscriptionMeasurement({ description: "the narrow inactive card height", actual: card.height, expected: 235 });
		assertSubscriptionMeasurement({ description: "the narrow inactive body height", actual: body.height, expected: 63 });
	});
});

test.describe("Readlist setup guide", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the email step as current at 40% complete (${theme})`, async ({ page }, testInfo) => {
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
		test(`shows the next-read step as current at 80% complete after dismissing Gmail (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-setup-next-read-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			for (let index = 0; index < 4; index += 1) {
				await seedCrawledArticle(page, {
					url: `https://example.com/setup-next-read-${email}-${index}`,
					title: `Next Read article ${index + 1}`,
					savedAt: "2026-07-12T09:14:00.000Z",
					excerpt: "An article saved toward the Next Read milestone.",
					userId,
				});
			}
			await seedInboxArticleQueued(page, userId);
			await loginAs(page, email);
			const dismissed = await page.request.post(`${BASE_URL}/queue/onboarding/gmail/dismiss`);
			assert.equal(dismissed.status(), 200);
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

	test.describe("iPhone", () => {
		test.use({ userAgent: IPHONE_UA });

		test("folds the setup guide above the list on an iPhone", async ({ page }, testInfo) => {
			const email = `readlist-phone-folded-${testInfo.workerIndex}-${Date.now()}@example.com`;
			await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");
			await captureCheckpoint(page, SETUP_GUIDE_PHONE_FOLDED);
			await page.locator(".setup-guide__progress").click();
			await expect(page.locator("[data-test-onboarding-steps]")).toBeVisible();
			await expect(page.locator('[data-test-onboarding-step="install-extension"] .setup-guide__disclosure')).toHaveAttribute("open", "");
			const foldChevron = page.locator(".setup-guide__progress .setup-guide__chevron");
			const currentChevron = page.locator('[data-test-onboarding-step="install-extension"] .setup-guide__chevron');
			const upcomingChevron = page.locator('[data-test-onboarding-step="save-first-article-via-extension"] .setup-guide__chevron');
			await expect.poll(() => foldChevron.evaluate((el) => getComputedStyle(el).transform)).toBe("matrix(-1, 0, 0, -1, 0, 0)");
			expect(await currentChevron.evaluate((el) => getComputedStyle(el).transform)).toBe("matrix(-1, 0, 0, -1, 0, 0)");
			expect(await upcomingChevron.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
			await guideSitsAboveTheTabs(page);
		});

		test.describe("without JavaScript", () => {
			test.use({ javaScriptEnabled: false });

			test("opens and closes the setup steps through the native fold", async ({ page }, testInfo) => {
				const email = `readlist-phone-fold-no-js-${testInfo.workerIndex}-${Date.now()}@example.com`;
				await createVerifiedUser(page, email);
				await loginAs(page, email);
				const steps = page.locator("[data-test-onboarding-steps]");
				await expect(steps).toBeAttached();
				await expect(steps).toBeHidden();
				await page.locator(".setup-guide__progress").click();
				await expect(steps).toBeVisible();
				await page.locator(".setup-guide__progress").click();
				await expect(steps).toBeHidden();
			});
		});
	});

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

	test("shows the save card on a custom readlist and asks for an article from All", async ({ page }, testInfo) => {
		const email = `readlist-phone-custom-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openCustomReadlist(page, { email, openRail: openReadlistSwitcher });
		await expect(page.locator(SAVE_CARD)).toBeVisible();
		await expect(page.locator(EMPTY_TEXT)).toHaveText(
			"Choose an article from All and add it here to start organising this readlist.",
		);

		await captureCheckpoint(page, PAGE_CUSTOM_READLIST_PHONE);
	});

	test("stacks the caught-up state under the rail with no action", async ({ page }, testInfo) => {
		await openCaughtUpReadlist(page, `readlist-phone-caught-up-${testInfo.workerIndex}-${Date.now()}@example.com`);

		await captureCheckpoint(page, PAGE_CAUGHT_UP_PHONE);
	});
});

test.describe("Readlist rail on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("keeps every readlist reachable above the listing", async ({ page }, testInfo) => {
		const email = `readlist-phone-rail-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openCustomReadlist(page, { email, openRail: openReadlistSwitcher });

		await captureCheckpoint(page, RAIL_PHONE);
	});
	test("opens the switcher onto every readlist and the create row", async ({ page }, testInfo) => {
		const email = `readlist-phone-rail-open-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openCustomReadlist(page, { email, openRail: openReadlistSwitcher });

		await captureCheckpoint(page, RAIL_PHONE_OPEN);
	});
});

test.describe("Readlist rail for a read-only account", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`lists the readlists with no menus and no create row (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			const email = `readlist-rail-read-only-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createVerifiedUser(page, email);
			await loginAs(page, email);
			await gotoReadlistQueue(page, "");
			await clickAndWaitForCounts(page, await nameNewReadlist(page, "New Readlist"));
			await clickAndWaitForCounts(page, await nameNewReadlist(page, "New Readlist 2"));
			await seedSubscriptionState(page, { userId, state: "inactive" });
			await gotoReadlistQueue(page, "");

			await expect(page.locator(`${RAIL} ${READLIST_MENU_SUMMARY}`)).toHaveCount(0);
			await expect(page.locator(`${RAIL} ${NEW_READLIST_BUTTON}`)).toHaveCount(0);
			await captureCheckpoint(page, withTheme(RAIL_READ_ONLY, theme));
		});
	}
});

test.describe("Readlist grid tracks", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("sizes the rail, main and side tracks to the design grid from 1200px", async ({ page }, testInfo) => {
		const email = `readlist-grid-tracks-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");

		const rail = await measuredBox(page, RAIL);
		const main = await measuredBox(page, MAIN_COLUMN);
		const side = await measuredBox(page, SIDE);
		assert.equal(rail.width, 230, `the rail track must be 230px wide, measured ${rail.width}px`);
		assert.equal(main.width, 518, `the main track must be 518px wide at 1280, measured ${main.width}px`);
		assert.equal(side.width, 340, `the side track must be 340px wide, measured ${side.width}px`);
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
			topics: LONGEST_TOPICS,
		});
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		expect(LONGEST_TOPICS.map((topic) => topic.length)).toEqual(LONGEST_TOPICS.map(() => MAX_ARTICLE_TOPIC_LENGTH));
		await expect(page.locator(`${ARTICLE} [data-test-article-topic]`)).toHaveText(LONGEST_TOPICS);

		for (const viewport of [WCAG_REFLOW_MINIMUM, PHONE, { width: 768, height: 900 }, DESKTOP]) {
			await page.setViewportSize(viewport);
			await expect(page.locator(ARTICLE)).toHaveCount(1);
			await neverScrollsSideways(page);
		}
	});

	test("keeps the never-used install action on one line, down to the reflow minimum", async ({ page }, testInfo) => {
		const email = `readlist-reflow-empty-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUser(page, email);
		await loginAs(page, email);
		await gotoReadlistQueue(page, "");
		await waitForBrandFonts(page, ["Inter"]);

		await emptyActionFitsEveryViewport(page, "install");
	});

	test("keeps the Read tab's view-unread action on one line, down to the reflow minimum", async ({ page }, testInfo) => {
		const email = `readlist-reflow-read-empty-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openReadEmptyReadlist(page, email);
		await waitForBrandFonts(page, ["Inter"]);

		await emptyActionFitsEveryViewport(page, "view-unread");
	});
});

test.describe("Readlist rail at the name cap", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("wraps a cap-length name inside a rail it never widens", async ({ page }, testInfo) => {
		const email = `readlist-cap-name-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await openCustomReadlist(page, { email, openRail: railIsOpen });
		const railBefore = await measuredBox(page, RAIL);
		const singleLine = await measuredBox(page, `${RAIL} ${ACTIVE_READLIST_LINK}`);

		await page.click(READLIST_MENU_SUMMARY);
		await page.click(READLIST_MENU_RENAME);
		await page.waitForSelector(`${READLIST_RENAME_POPOVER}:popover-open`);
		await page.locator(RENAME_INPUT).fill(LONGEST_READLIST_NAME);
		await clickAndWaitForPageReload(page, page.locator(RENAME_SAVE));
		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText(LONGEST_READLIST_NAME);

		const railAfter = await measuredBox(page, RAIL);
		const wrapped = await measuredBox(page, `${RAIL} ${ACTIVE_READLIST_LINK}`);
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

test.describe("Readlist move-or-delete dialog at the reflow minimum", () => {
	test.use({ timezoneId: "UTC", viewport: WCAG_REFLOW_MINIMUM });

	test("keeps the move-or-delete dialog inside a 320px screen", async ({ page }, testInfo) => {
		const email = `readlist-delete-migrate-reflow-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const { first } = await openTwoReadlistsWithAFiledArticle(page, { email, openRail: openReadlistSwitcher });
		await moveOrDeleteDialog({ first, openRail: openReadlistSwitcher }).settled(page);

		const dialog = openDeleteReadlistDialog(first);
		await neverScrollsSideways(page);
		const panel = await measuredBox(page, dialog);
		const field = await measuredBox(page, `${dialog} .form-input--select`);
		const cancel = await measuredBox(page, `${dialog} ${READLIST_DELETE_CANCEL}`);
		const commit = await measuredBox(page, `${dialog} ${READLIST_DELETE_CONFIRM}`);
		assert.ok(
			field.x + field.width <= panel.x + panel.width - 25 + 1,
			`the select must end inside the content edge, measured select=${JSON.stringify(field)} panel=${JSON.stringify(panel)}`,
		);
		assert.ok(
			near(cancel.y, commit.y + commit.height + 8),
			`Cancel must stack 8px under Delete readlist, measured cancel=${JSON.stringify(cancel)} commit=${JSON.stringify(commit)}`,
		);
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

const OFFLINE_DOWNLOAD_STATUS = "[data-test-offline-download-status]";
const OFFLINE_DOWNLOAD_START = "[data-test-offline-download-start]";
const OFFLINE_TAG = "[data-offline-tag]";
const OFFLINE_LISTING_FETCH = /\/queue\?.*utm_content=download-offline/;

function offlineDownloadCheckpoint(input: {
	name: string;
	status: string;
	tags: number;
	geometry: (page: Page) => Promise<void>;
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: async (page) => {
			await articlesPageSettled(page);
			await expect(page.locator(OFFLINE_DOWNLOAD_STATUS)).toHaveText(input.status);
			await expect(page.locator(OFFLINE_TAG)).toHaveCount(input.tags);
			await page.mouse.move(0, 0);
		},
		geometry: input.geometry,
		target: LISTING,
		capture: "element",
		pinnedText: [
			{ selector: `${FIRST_CARD} ${CARD_TIME}`, text: "3 days ago" },
			{ selector: `.readlist-list > .readlist-article:nth-of-type(2) ${CARD_TIME}`, text: "2 days ago" },
		],
	};
}

const OFFLINE_DOWNLOAD_STARTING = offlineDownloadCheckpoint({
	name: "readlist-offline-download-starting",
	status: "Downloading 0 of 2",
	tags: 0,
	geometry: railBesideMainBesideSide,
});

const OFFLINE_DOWNLOAD_RESUME = offlineDownloadCheckpoint({
	name: "readlist-offline-download-resume",
	status: "1 of 2 downloaded. Press to continue.",
	tags: 0,
	geometry: railBesideMainBesideSide,
});

const OFFLINE_DOWNLOAD_SIGNED_OUT = offlineDownloadCheckpoint({
	name: "readlist-offline-download-signed-out",
	status: "You were signed out. Sign in and press again to continue.",
	tags: 0,
	geometry: railBesideMainBesideSide,
});

const OFFLINE_DOWNLOAD_FINISHED = offlineDownloadCheckpoint({
	name: "readlist-offline-download-finished",
	status: "2 available offline",
	tags: 2,
	geometry: railBesideMainBesideSide,
});

const OFFLINE_DOWNLOAD_FINISHED_PHONE = offlineDownloadCheckpoint({
	name: "readlist-offline-download-finished-phone",
	status: "2 available offline",
	tags: 2,
	geometry: phonePageGeometry,
});

async function openSeededReadlist(page: Page, input: { label: string; theme: string; workerIndex: number }): Promise<void> {
	const email = `readlist-offline-${input.label}-${input.theme}-${input.workerIndex}-${Date.now()}@example.com`;
	const userId = await createVerifiedUser(page, email);
	await seedTwoArticles(page, userId, email);
	await loginAs(page, email);
	await gotoReadlistQueue(page, "");
	await page.waitForSelector(`${PAGINATION_PAGES} ${PAGINATION_PAGE}`);
}

async function storeCurrentCopiesOfEveryCard(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const cache = await window.caches.open("readplace-offline-v1");
		for (const link of document.querySelectorAll<HTMLAnchorElement>(".readlist-article__title[href]")) {
			const article = new URL(link.href);
			for (const name of Array.from(article.searchParams.keys())) {
				if (name.startsWith("utm_")) article.searchParams.delete(name);
			}
			const headers = new Headers({
				"Content-Type": "text/html",
				"Readplace-Offline-Saved-At": new Date().toISOString(),
				"Readplace-Offline-Source": article.href,
			});
			await cache.put(
				`${article.origin}${article.pathname}`,
				new Response("<main><div data-article-body><p>Kept</p></div></main>", { headers }),
			);
		}
	});
}

test.describe("Readlist offline download", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`shows the progress bar and 0 of the total the moment it is pressed (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openSeededReadlist(page, { label: "starting", theme, workerIndex: testInfo.workerIndex });
			await page.route(OFFLINE_LISTING_FETCH, () => {});

			await page.locator(OFFLINE_DOWNLOAD_START).click();

			await captureCheckpoint(page, withTheme(OFFLINE_DOWNLOAD_STARTING, theme));
		});

		test(`offers to continue an unfinished download on the next visit (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await page.addInitScript((origin) => {
				window.localStorage.setItem(
					"readplace:offline-download-run",
					JSON.stringify({ listing: `${origin}/queue`, kept: 1, total: 2 }),
				);
			}, BASE_URL);
			await openSeededReadlist(page, { label: "resume", theme, workerIndex: testInfo.workerIndex });

			await captureCheckpoint(page, withTheme(OFFLINE_DOWNLOAD_RESUME, theme));
		});

		test(`says the reader was signed out when the listing sends them to log in (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openSeededReadlist(page, { label: "signed-out", theme, workerIndex: testInfo.workerIndex });
			await page.route(OFFLINE_LISTING_FETCH, (route) =>
				route.fulfill({ status: 303, headers: { Location: "/login" } }),
			);

			await page.locator(OFFLINE_DOWNLOAD_START).click();

			await captureCheckpoint(page, withTheme(OFFLINE_DOWNLOAD_SIGNED_OUT, theme));
		});

		test(`tags every card available offline once the download finishes (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openSeededReadlist(page, { label: "finished", theme, workerIndex: testInfo.workerIndex });
			await storeCurrentCopiesOfEveryCard(page);

			await page.locator(OFFLINE_DOWNLOAD_START).click();

			await captureCheckpoint(page, withTheme(OFFLINE_DOWNLOAD_FINISHED, theme));
		});
	}
});

test.describe("Readlist offline download on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_TALL });

	test("tags every card available offline once the download finishes", async ({ page }, testInfo) => {
		await openSeededReadlist(page, { label: "finished-phone", theme: "light", workerIndex: testInfo.workerIndex });
		await storeCurrentCopiesOfEveryCard(page);

		await page.locator(OFFLINE_DOWNLOAD_START).click();

		await captureCheckpoint(page, OFFLINE_DOWNLOAD_FINISHED_PHONE);
	});
});
