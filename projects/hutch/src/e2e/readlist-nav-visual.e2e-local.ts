import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
	waitForImagePixels,
} from "@packages/e2e-harness";
import { formatTabCountLabel } from "@packages/web-shell";
import { requireEnv } from "@packages/require-env";
import { clickAndWaitForPageReload } from "./page-interactions";
import {
	type MeasuredBox,
	measureBackgrounds,
	measureBoxes,
	measureInks,
	measureNameSize,
	measureRenameRing,
	neutraliseVolatileChrome,
	pageOverflowsSideways,
} from "./readlist-nav.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const READLIST_NAV = "main.readlist .readlist-nav";
const READLIST_NAV_LIST = "main.readlist .readlist-nav__list";
const READLIST_NAV_LINK = '[data-test-readlist="default"]';
const READLIST_CONTENT = "main.readlist .readlist__content";
const READLIST_LIST = "[data-test-article-list]";
const READLIST_FILTERS = "main.readlist .readlist__filters";
const READLIST_LISTING = "main.readlist .readlist__listing";
const READLIST_SAVE_FORM = "main.readlist .readlist__save-form";
const READLIST_DELETE_TRIGGER = 'main.readlist [data-test-action="readlist-delete"]';
const READLIST_EMPTY = "main.readlist [data-test-empty-readlist]";
const OPEN_FILTER_TAB = "main.readlist .readlist__filter-link--active";
const UNREAD_FILTER_TAB = 'main.readlist [data-test-filter="unread"]';
const UNREAD_FILTER_LABEL = 'main.readlist [data-test-filter="unread"] span[id]';
const READ_FILTER_TAB = 'main.readlist [data-test-filter="read"]';

/* A name at the 24-character cap with nothing to break at — the hardest case
 * the rail has to render in full, so it exercises the wrap and the cap at once. */
const LONGEST_READLIST_NAME = "Longestpossiblereadlist";
const RENAMEABLE_TAB = "[data-readlist-rename]";
const EDITING_TAB = "main.readlist .readlist-nav__link--editing";
const ACTIVE_READLIST_TAB = "main.readlist .readlist-nav__link--active";
const ACTIVE_READLIST_LABEL = "main.readlist .readlist-nav__link--active .readlist-nav__label";
const OWNED_READLIST_ITEM = "main.readlist .readlist-nav__item--deletable";
const ACTIVE_OWNED_ITEM = `${OWNED_READLIST_ITEM}.readlist-nav__item--active`;
const INACTIVE_OWNED_ITEM = `${OWNED_READLIST_ITEM}:not(.readlist-nav__item--active)`;
const INACTIVE_OWNED_TAB = `${INACTIVE_OWNED_ITEM} .readlist-nav__link`;
const ACTIVE_OWNED_TRIGGER = `${ACTIVE_OWNED_ITEM} [data-test-action="readlist-delete"]`;
const INACTIVE_OWNED_TRIGGER = `${INACTIVE_OWNED_ITEM} [data-test-action="readlist-delete"]`;
const READLIST_DELETE_TRIGGER_IN_ITEM = '[data-test-action="readlist-delete"]';
const EDITING_LABEL = "main.readlist .readlist-nav__link--editing .readlist-nav__label";
const ACTIVE_READLIST_PENCIL = "main.readlist .readlist-nav__link--active svg";
const READLIST_TAB = "main.readlist [data-test-readlist]";
const READLIST_DELETE_CONFIRM = '[data-test-confirm-popover="readlist-delete"]';
const RAIL_TAB_INLINE_PADDING_PX = 10;
const RAIL_TAB_GAP_PX = 6;
const RENAME_RING_REACH_PX = 4;

const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };
const PHONE = { width: 390, height: 844 };
const BREAKPOINT = { width: 768, height: 900 };
const DESKTOP = { width: 1280, height: 900 };
/* Tall enough that the listing's bottom edge — the clip the whole-page capture
 * runs to — stays inside the viewport, which is as far as a clip can reach. */
const DESKTOP_TALL = { width: 1280, height: 1700 };
const PHONE_TALL = { width: 390, height: 2000 };

/* The card list, the empty state and the pagination row are measured against
 * this width by the readlist-flow visual checkpoints, so the rail and the panel's
 * own border and padding have to come out of the page cap rather than out of
 * the listing. */
const DESKTOP_LISTING_WIDTH = 712;
const MINIMUM_TOUCH_TARGET = 44;
/* The tab's base edge deliberately sits on the panel's 1px border so the two
 * read as one piece — the join is the only overlap the layout may have. */
const TAB_PANEL_JOIN_PX = 1;
/* The filter strip is inset from the frame's corner by the same 12px the readlists
 * rail uses, so the first tab lands on the frame's straight edge, not its arc. */
const TAB_STRIP_INSET_PX = 12;

const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEEDED_ARTICLES = [
	{
		url: "https://example.com/whole-page-readlist-second",
		title: "The second article in the readlist",
		savedAt: "2026-07-11T09:14:00.000Z",
		excerpt:
			"A fixed excerpt, long enough to occupy the two lines a real card excerpt occupies on both the phone and the desktop layout.",
	},
	{
		url: "https://example.com/whole-page-readlist-first",
		title: "The article at the top of the readlist",
		savedAt: "2026-07-12T09:14:00.000Z",
		excerpt:
			"A fixed excerpt, long enough to occupy the two lines a real card excerpt occupies on both the phone and the desktop layout.",
	},
];

/* Wall-clock-relative and host-state-driven chrome is neutralised rather than
 * waited on: a saved-time phrase, a live trial timer and the offline notice all
 * rot a committed baseline on a schedule no test controls. */
const PINNED_SAVED_TIMES = ["2 days ago", "3 days ago"];
const VOLATILE_CHROME = [
	".trial-countdown",
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createUser(page: Page, email: string): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	CreatedUser.parse(await response.json());
}

async function createVerifiedUserWithReadlist(page: Page, email: string): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	for (const article of SEEDED_ARTICLES) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: article.url,
				title: article.title,
				content: "<p>Seeded body for the whole-page readlist baseline.</p>",
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

/* A tap puts the caret where the reader touched, so replacing the whole name is
 * the reader's own select-all — the same keystroke they would use themselves. */
async function replaceOpenName(page: Page, name: string): Promise<void> {
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type(name);
}

async function openNewReadlist(page: Page): Promise<void> {
	await openReadlist(page);
	await page.click('[data-test-action="new-readlist"]');
	await page.waitForSelector(RENAMEABLE_TAB);
}

async function openReadlist(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-readlist");
}

async function openSecondReadlist(page: Page): Promise<void> {
	await page.click('[data-test-action="new-readlist"]');
	await expect(page.locator(READLIST_TAB)).toHaveCount(3);
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

type RenameRing = ReturnType<typeof measureRenameRing>;

async function renameRing(page: Page): Promise<RenameRing> {
	return await page.evaluate(measureRenameRing, {
		editing: EDITING_TAB,
		item: OWNED_READLIST_ITEM,
		trigger: READLIST_DELETE_TRIGGER_IN_ITEM,
		list: READLIST_NAV_LIST,
		reach: RENAME_RING_REACH_PX,
	});
}

function ringIsVisible(ring: RenameRing, width: number): void {
	assert.deepEqual(
		{
			left: ring.ring.left >= ring.scroller.left,
			top: ring.ring.top >= ring.scroller.top,
			right: ring.ring.right <= ring.scroller.right,
			bottom: ring.ring.bottom <= ring.scroller.bottom,
		},
		{ left: true, top: true, right: true, bottom: true },
		`at ${width}px the ring must fit inside the tab strip's box, or the strip's scroller clips it, measured ${JSON.stringify(ring.ring)} inside ${JSON.stringify(ring.scroller)}`,
	);
	assert.deepEqual(
		ring.legs.map((leg) => leg.paintedBy),
		["Readlists", "Readlists", "Readlists", "Readlists"],
		`at ${width}px every leg of the ring must be painted by the rail, never by the listing panel`,
	);
	assert.equal(
		ring.ringShadow,
		`${ring.pageBackground} 0px 0px 0px 2px, ${ring.ringColour} 0px 0px 0px 4px`,
		`at ${width}px the ring must be a page-colour gap inside an amber line`,
	);
}

async function ownedTabsColoured(page: Page, width: number): Promise<void> {
	const [defaultLink, activeItem] = await page.evaluate(measureBackgrounds, [
		READLIST_NAV_LINK,
		ACTIVE_OWNED_ITEM,
	]);
	await expect
		.poll(() => page.evaluate(measureBackgrounds, [INACTIVE_OWNED_ITEM]), {
			message: `at ${width}px a readlist the reader is not on must rest as muted as the default readlist's tab`,
		})
		.toEqual([defaultLink]);
	assert.notEqual(
		defaultLink,
		activeItem,
		`at ${width}px only the readlist the reader is on may carry the active colour`,
	);
}

async function railDeleteTakesTheTabFill(page: Page): Promise<void> {
	const [inactiveItem] = await page.evaluate(measureBackgrounds, [INACTIVE_OWNED_ITEM]);
	await expect
		.poll(() => page.evaluate(measureBackgrounds, [INACTIVE_OWNED_TRIGGER]), {
			message: "in the rail the delete control must take the fill of the tab it belongs to",
		})
		.toEqual([inactiveItem]);
}

async function railDeleteSharesTheTabInk(page: Page): Promise<void> {
	await page.locator(INACTIVE_OWNED_TRIGGER).hover();
	await expect(page.locator(INACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "1");
	const [tabInk, itemInk] = await page.evaluate(measureInks, [
		INACTIVE_OWNED_TAB,
		INACTIVE_OWNED_ITEM,
	]);
	assert.equal(
		tabInk,
		itemInk,
		"a tab whose delete control is under the pointer must carry the ink its fill was swapped for",
	);
}

/* Both boxes are read in one frame. The banner area re-measures itself through a
 * ResizeObserver as the viewport changes, and a page that shifts between two
 * separate reads reports the rail and the listing at heights they never held at
 * the same moment. */
async function measurePair(
	page: Page,
	selectors: [string, string],
): Promise<[MeasuredBox, MeasuredBox]> {
	const boxes = await page.evaluate(measureBoxes, selectors);
	const [first, second] = boxes;
	assert.ok(first && second, "both selectors must have matched something to measure");
	return [first, second];
}

async function measureTrio(
	page: Page,
	selectors: [string, string, string],
): Promise<[MeasuredBox, MeasuredBox, MeasuredBox]> {
	const boxes = await page.evaluate(measureBoxes, selectors);
	const [first, second, third] = boxes;
	assert.ok(first && second && third, "every selector must have matched something to measure");
	return [first, second, third];
}

async function nameSize(page: Page): Promise<{
	fontSize: string;
	width: number;
	height: number;
}> {
	return await page.evaluate(measureNameSize, {
		label: ACTIVE_READLIST_LABEL,
		tab: ACTIVE_READLIST_TAB,
	});
}

async function readlistNavSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator(READLIST_NAV_LINK)).toHaveText("All");
}

async function stacksAboveTheListing(page: Page): Promise<void> {
	const [nav, content] = await measurePair(page, [READLIST_NAV, READLIST_CONTENT]);
	assert.ok(
		nav.y + nav.height - TAB_PANEL_JOIN_PX <= content.y,
		"on a phone the readlist must sit above the listing it scopes, joined only at the tab's base",
	);
	const link = await measuredBox(page, READLIST_NAV_LINK);
	assert.ok(
		link.height >= MINIMUM_TOUCH_TARGET,
		`a readlist must be at least ${MINIMUM_TOUCH_TARGET}px tall to be tapped`,
	);
}

async function railBesideTheListing(page: Page): Promise<void> {
	const [nav, content] = await measurePair(page, [READLIST_NAV, READLIST_CONTENT]);
	assert.ok(
		nav.x + nav.width - TAB_PANEL_JOIN_PX <= content.x,
		"past the breakpoint the readlist must move left of the listing, joined only at the tab's base",
	);
	assert.equal(nav.y, content.y, "the rail and the listing must start on the same line");
	const listing = await measuredBox(page, READLIST_LISTING);
	assert.equal(
		listing.width,
		DESKTOP_LISTING_WIDTH,
		"the rail and the panel frame must come out of the page cap, leaving the listing the width it always had",
	);
}

async function seededReadlistSettled(page: Page): Promise<void> {
	await expect(page.locator("[data-test-article]")).toHaveCount(SEEDED_ARTICLES.length);
	await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
	await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText(
		`To Read (${SEEDED_ARTICLES.length})`,
	);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: PINNED_SAVED_TIMES,
	});
}

async function wholeReadlistSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator(READLIST_NAV_LINK)).toHaveText("All");
	await waitForImagePixels(page, "main.readlist .onboarding__avatar");
	await seededReadlistSettled(page);
}

async function madeRailSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist");
	await page.mouse.move(DESKTOP.width - 5, 5);
	await expect(page.locator(READLIST_DELETE_TRIGGER)).toHaveCSS("opacity", "0");
	await page.locator(ACTIVE_READLIST_TAB).hover();
	await expect(page.locator(READLIST_DELETE_TRIGGER)).toHaveCSS("opacity", "1");
}

async function railOffersDelete(page: Page): Promise<void> {
	await railBesideTheListing(page);
	const [tab, trigger] = await measurePair(page, [ACTIVE_READLIST_TAB, READLIST_DELETE_TRIGGER]);
	assert.ok(
		trigger.height >= MINIMUM_TOUCH_TARGET,
		`the delete control must be at least ${MINIMUM_TOUCH_TARGET}px tall to be tapped`,
	);
	assert.equal(
		trigger.y,
		tab.y,
		"the delete control must sit on the tab it deletes, never on a row of its own",
	);
	assert.equal(
		trigger.x + trigger.width,
		tab.x,
		"in the rail the delete control must meet the tab's leading edge from outside it",
	);

	await page.mouse.move(DESKTOP.width - 5, 5);
	await expect(page.locator(READLIST_DELETE_TRIGGER)).toHaveCSS("opacity", "0");
	const resting = await measuredBox(page, ACTIVE_READLIST_TAB);
	assert.deepEqual(
		{ x: resting.x, y: resting.y, width: resting.width, height: resting.height },
		{ x: tab.x, y: tab.y, width: tab.width, height: tab.height },
		"revealing the delete control must not resize the tab it belongs to",
	);
	await page.mouse.move(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2);
	await expect(page.locator(READLIST_DELETE_TRIGGER)).toHaveCSS("opacity", "1");
	await page.locator(ACTIVE_READLIST_TAB).hover();
	await expect(page.locator(READLIST_DELETE_TRIGGER)).toHaveCSS("opacity", "1");
}

async function madeRailEditingSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist");
	await page.click(RENAMEABLE_TAB);
	await expect(page.locator(EDITING_TAB)).toHaveCount(1);
	await expect(page.locator(EDITING_LABEL)).toBeFocused();
	await page.mouse.move(DESKTOP.width - 5, 5);
	await expect(page.locator(READLIST_DELETE_TRIGGER)).toHaveCSS("opacity", "1");
}

async function railShowsTheRenameRing(page: Page): Promise<void> {
	await railBesideTheListing(page);
	ringIsVisible(await renameRing(page), DESKTOP.width);
}

async function twoMadeRailSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist 2");
	await page.mouse.move(DESKTOP.width - 5, 5);
	await expect(page.locator(INACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "0");
	await expect(page.locator(ACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "0");
	await page.locator(INACTIVE_OWNED_TAB).hover();
	await expect(page.locator(INACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "1");
}

async function railRevealsTheInactiveDelete(page: Page): Promise<void> {
	await railBesideTheListing(page);
	const [tab, trigger] = await measurePair(page, [INACTIVE_OWNED_TAB, INACTIVE_OWNED_TRIGGER]);
	assert.equal(
		trigger.y,
		tab.y,
		"the delete control must sit on the tab it deletes, never on a row of its own",
	);
	assert.equal(
		trigger.x + trigger.width,
		tab.x,
		"in the rail the delete control must meet the tab's leading edge from outside it",
	);
	assert.ok(
		trigger.height >= MINIMUM_TOUCH_TARGET,
		`the delete control must be at least ${MINIMUM_TOUCH_TARGET}px tall to be tapped`,
	);
}

async function twoMadeRowSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist 2");
	await page.mouse.move(5, 5);
	await expect(page.locator(INACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "1");
	await expect(page.locator(ACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "1");
}

async function rowOffersEveryDelete(page: Page): Promise<void> {
	await stacksAboveTheListing(page);
	const [item, trigger] = await measurePair(page, [INACTIVE_OWNED_ITEM, INACTIVE_OWNED_TRIGGER]);
	assert.equal(
		trigger.x + trigger.width,
		item.x + item.width,
		"in the row the delete control must sit on the trailing edge of the tab it deletes",
	);
	assert.ok(
		trigger.height >= MINIMUM_TOUCH_TARGET,
		`the delete control must be at least ${MINIMUM_TOUCH_TARGET}px tall to be tapped`,
	);
}

async function madeReadlistSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await page.mouse.move(5, 5);
	await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist");
	await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText(formatTabCountLabel({ label: "To Read", count: 0 }));
	await expect(page.locator(READLIST_EMPTY)).toHaveCount(1);
	await waitForImagePixels(page, "main.readlist .onboarding__avatar");
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: PINNED_SAVED_TIMES,
	});
}

async function madeReadlistGeometry(page: Page): Promise<void> {
	await expect(page.locator(READLIST_SAVE_FORM)).toBeHidden();
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the readlist page must never scroll sideways");
	const viewport = page.viewportSize();
	assert.ok(viewport, "a whole-page capture needs a fixed viewport to size its clip");
	const listing = await measuredBox(page, READLIST_LISTING);
	assert.ok(
		listing.y + listing.height <= viewport.height,
		`the whole-page clip runs to ${Math.ceil(listing.y + listing.height)}px, past the ${viewport.height}px viewport a clip can reach`,
	);
}

async function wholeReadlistGeometry(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the readlist page must never scroll sideways");
	const viewport = page.viewportSize();
	assert.ok(viewport, "a whole-page capture needs a fixed viewport to size its clip");
	const listing = await measuredBox(page, READLIST_LIST);
	assert.ok(
		listing.y + listing.height <= viewport.height,
		`the whole-page clip runs to ${Math.ceil(listing.y + listing.height)}px, past the ${viewport.height}px viewport a clip can reach`,
	);
}

async function tabsJoinTheListing(page: Page): Promise<void> {
	const [strip, listing, openTab] = await measureTrio(page, [
		READLIST_FILTERS,
		READLIST_LISTING,
		OPEN_FILTER_TAB,
	]);
	assert.equal(
		strip.y + strip.height - listing.y,
		TAB_PANEL_JOIN_PX,
		"the status tabs must overlap the listing's border by the join, not float above it",
	);
	assert.equal(
		openTab.y + openTab.height - listing.y,
		TAB_PANEL_JOIN_PX,
		"the open tab's base must land on the listing's border, the way a file tab meets its folder",
	);
	assert.equal(
		openTab.x - listing.x,
		TAB_STRIP_INSET_PX,
		"the tab strip must start on the frame's straight edge, not on its corner",
	);
	assert.ok(
		openTab.height >= MINIMUM_TOUCH_TARGET,
		`a status tab must be at least ${MINIMUM_TOUCH_TARGET}px tall to be tapped`,
	);
}

const WHOLE_READLIST_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "readlist-page-desktop-light",
	settled: wholeReadlistSettled,
	geometry: wholeReadlistGeometry,
	target: READLIST_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

const WHOLE_READLIST_DESKTOP_DARK: VisualCheckpoint = {
	name: "readlist-page-desktop-dark",
	settled: wholeReadlistSettled,
	geometry: wholeReadlistGeometry,
	target: READLIST_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

const WHOLE_READLIST_MOBILE_LIGHT: VisualCheckpoint = {
	name: "readlist-page-mobile-light",
	settled: wholeReadlistSettled,
	geometry: wholeReadlistGeometry,
	target: READLIST_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

const RAIL_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "readlist-nav-rail-desktop-light",
	settled: readlistNavSettled,
	geometry: railBesideTheListing,
	target: READLIST_NAV,
	capture: "element",
	pinnedText: [],
};

const RAIL_DESKTOP_DARK: VisualCheckpoint = {
	name: "readlist-nav-rail-desktop-dark",
	settled: readlistNavSettled,
	geometry: railBesideTheListing,
	target: READLIST_NAV,
	capture: "element",
	pinnedText: [],
};

const ROW_MOBILE_LIGHT: VisualCheckpoint = {
	name: "readlist-nav-row-mobile-light",
	settled: readlistNavSettled,
	geometry: stacksAboveTheListing,
	target: READLIST_NAV,
	capture: "element",
	pinnedText: [],
};

const MADE_RAIL_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "readlist-nav-rail-made-desktop-light",
	settled: madeRailSettled,
	geometry: railOffersDelete,
	target: READLIST_NAV_LIST,
	capture: "element",
	pinnedText: [],
};

const MADE_RAIL_EDITING_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "readlist-nav-rail-editing-desktop-light",
	settled: madeRailEditingSettled,
	geometry: railShowsTheRenameRing,
	target: READLIST_NAV_LIST,
	capture: "element",
	pinnedText: [],
};

const MADE_RAIL_EDITING_DESKTOP_DARK: VisualCheckpoint = {
	name: "readlist-nav-rail-editing-desktop-dark",
	settled: madeRailEditingSettled,
	geometry: railShowsTheRenameRing,
	target: READLIST_NAV_LIST,
	capture: "element",
	pinnedText: [],
};

const TWO_MADE_RAIL_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "readlist-nav-rail-two-made-desktop-light",
	settled: twoMadeRailSettled,
	geometry: railRevealsTheInactiveDelete,
	target: READLIST_NAV_LIST,
	capture: "element",
	pinnedText: [],
};

const TWO_MADE_ROW_MOBILE_LIGHT: VisualCheckpoint = {
	name: "readlist-nav-row-two-made-mobile-light",
	settled: twoMadeRowSettled,
	geometry: rowOffersEveryDelete,
	target: READLIST_NAV,
	capture: "element",
	pinnedText: [],
};

const MADE_READLIST_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "readlist-page-made-desktop-light",
	settled: madeReadlistSettled,
	geometry: madeReadlistGeometry,
	target: READLIST_LISTING,
	capture: "page-from-top",
	pinnedText: [],
};

const MADE_READLIST_DESKTOP_DARK: VisualCheckpoint = {
	name: "readlist-page-made-desktop-dark",
	settled: madeReadlistSettled,
	geometry: madeReadlistGeometry,
	target: READLIST_LISTING,
	capture: "page-from-top",
	pinnedText: [],
};

const MADE_READLIST_MOBILE_LIGHT: VisualCheckpoint = {
	name: "readlist-page-made-mobile-light",
	settled: madeReadlistSettled,
	geometry: madeReadlistGeometry,
	target: READLIST_LISTING,
	capture: "page-from-top",
	pinnedText: [],
};

test.describe("Readlist nav", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("names the open readlist in a rail beside the listing (light)", async ({ page }, testInfo) => {
		const email = `readlist-nav-desktop-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await captureCheckpoint(page, RAIL_DESKTOP_LIGHT);
	});

	test("names the open readlist in a rail beside the listing (dark)", async ({ page }, testInfo) => {
		const email = `readlist-nav-desktop-dark-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.emulateMedia({ colorScheme: "dark" });
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await captureCheckpoint(page, RAIL_DESKTOP_DARK);
	});
});

test.describe("Readlist nav (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("stacks the open readlist above the listing", async ({ page }, testInfo) => {
		const email = `readlist-nav-mobile-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await captureCheckpoint(page, ROW_MOBILE_LIGHT);
	});
});

test.describe("Readlist page", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	test("renders the whole readlist beside its rail (light)", async ({ page }, testInfo) => {
		const email = `readlist-page-desktop-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await captureCheckpoint(page, WHOLE_READLIST_DESKTOP_LIGHT);
	});

	test("renders the whole readlist beside its rail (dark)", async ({ page }, testInfo) => {
		const email = `readlist-page-desktop-dark-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.emulateMedia({ colorScheme: "dark" });
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await captureCheckpoint(page, WHOLE_READLIST_DESKTOP_DARK);
	});
});

test.describe("Readlist page (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_TALL });

	test("renders the whole readlist under its readlist row", async ({ page }, testInfo) => {
		const email = `readlist-page-mobile-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await captureCheckpoint(page, WHOLE_READLIST_MOBILE_LIGHT);
	});
});

test.describe("Readlist the reader made, in the rail", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("offers the readlist it is on for deleting, on the tab's leading edge", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-made-rail-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);

		await captureCheckpoint(page, MADE_RAIL_DESKTOP_LIGHT);
	});

	test("pins the rename hint to the tab's trailing edge and centres the name beside it", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-made-rail-pencil-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);
		await waitForBrandFonts(page, ["Inter"]);

		const [chip, pencil, label] = await measureTrio(page, [
			OWNED_READLIST_ITEM,
			ACTIVE_READLIST_PENCIL,
			ACTIVE_READLIST_LABEL,
		]);
		assert.equal(
			pencil.x + pencil.width,
			chip.x + chip.width - RAIL_TAB_INLINE_PADDING_PX,
			"the rename hint must sit on the tab's trailing padding edge, not beside the name",
		);
		assert.equal(
			label.x,
			chip.x + RAIL_TAB_INLINE_PADDING_PX,
			"the name must start on the tab's leading padding edge",
		);
		assert.equal(
			label.x + label.width + RAIL_TAB_GAP_PX,
			pencil.x,
			"the name must own the whole space left of the rename hint, so it centres there",
		);
	});
});

test.describe("Readlist the reader made, being renamed in the rail", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("rings the tab being renamed, nub and all (light)", async ({ page }, testInfo) => {
		const email = `readlist-nav-editing-rail-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);

		await captureCheckpoint(page, MADE_RAIL_EDITING_DESKTOP_LIGHT);
	});

	test("rings the tab being renamed, nub and all (dark)", async ({ page }, testInfo) => {
		const email = `readlist-nav-editing-rail-dark-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.emulateMedia({ colorScheme: "dark" });
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);

		await captureCheckpoint(page, MADE_RAIL_EDITING_DESKTOP_DARK);
	});
});

test.describe("Readlists the reader made, in the rail", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("shows every readlist the reader made for deleting, muted until it is the open one", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-two-made-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);
		await openSecondReadlist(page);

		await expect(page.locator(READLIST_DELETE_TRIGGER)).toHaveCount(2);
		await expect(page.locator(READLIST_DELETE_CONFIRM)).toHaveCount(2);

		await page.mouse.move(DESKTOP.width - 5, 5);
		await expect(page.locator(INACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "0");
		await page.locator(INACTIVE_OWNED_TAB).hover();
		await expect(page.locator(INACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "1");
		await expect(page.locator(ACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "0");
		await page.mouse.move(DESKTOP.width - 5, 5);
		await ownedTabsColoured(page, DESKTOP.width);
		await railDeleteTakesTheTabFill(page);
		await railDeleteSharesTheTabInk(page);
		await page.mouse.move(DESKTOP.width - 5, 5);

		await page.setViewportSize(PHONE);
		await expect(page.locator(INACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "1");
		await expect(page.locator(ACTIVE_OWNED_TRIGGER)).toHaveCSS("opacity", "1");
		await ownedTabsColoured(page, PHONE.width);
	});

	test("stays on the readlist it was viewing after deleting another one", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-delete-other-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);
		await openSecondReadlist(page);

		const trigger = page.locator(INACTIVE_OWNED_TRIGGER);
		await expect(trigger).toHaveCount(1);
		const popoverId = await trigger.getAttribute("popovertarget");
		assert.ok(popoverId, "the delete trigger must reference its confirmation popover");
		const confirm = page.locator(`[id="${popoverId}"] [data-test-action="readlist-delete-confirm"]`);
		await trigger.click();
		await expect(confirm).toBeVisible();
		await clickAndWaitForPageReload(page, confirm);

		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist 2");
		await expect(page.locator(READLIST_TAB)).toHaveCount(2);
		await expect(page.locator(READLIST_DELETE_TRIGGER)).toHaveCount(1);
	});

	test("reveals the delete control of a readlist the reader is not on, from its tab", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-two-made-rail-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);
		await openSecondReadlist(page);

		await captureCheckpoint(page, TWO_MADE_RAIL_DESKTOP_LIGHT);
	});
});

test.describe("Readlists the reader made (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("offers every readlist the reader made for deleting, in the row", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-two-made-row-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);
		await openSecondReadlist(page);

		await captureCheckpoint(page, TWO_MADE_ROW_MOBILE_LIGHT);
	});
});

test.describe("Readlist the reader made", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	test("stands empty with no save bar, pointing back at the default readlist (light)", async ({
		page,
	}, testInfo) => {
		const email = `readlist-page-made-desktop-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);

		await captureCheckpoint(page, MADE_READLIST_DESKTOP_LIGHT);
	});

	test("stands empty with no save bar, pointing back at the default readlist (dark)", async ({
		page,
	}, testInfo) => {
		const email = `readlist-page-made-desktop-dark-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.emulateMedia({ colorScheme: "dark" });
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);

		await captureCheckpoint(page, MADE_READLIST_DESKTOP_DARK);
	});
});

test.describe("Readlist the reader made (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_TALL });

	test("stands empty with no save bar, pointing back at the default readlist", async ({
		page,
	}, testInfo) => {
		const email = `readlist-page-made-mobile-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);

		await captureCheckpoint(page, MADE_READLIST_MOBILE_LIGHT);
	});
});

test.describe("Readlist nav reflow", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("never makes the page scroll sideways, at any width the rail has to survive", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-reflow-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		for (const viewport of [WCAG_REFLOW_MINIMUM, PHONE, BREAKPOINT, DESKTOP]) {
			await page.setViewportSize(viewport);
			await expect(page.locator(READLIST_NAV_LINK)).toBeVisible();
			const overflows = await page.evaluate(pageOverflowsSideways);
			expect({ width: viewport.width, overflows }).toEqual({
				width: viewport.width,
				overflows: false,
			});
		}
	});
});

test.describe("Readlist nav with a long readlist name", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("renders a name at the cap in full, wrapping inside the rail it never widens", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-wrap-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		const singleLine = await measuredBox(page, READLIST_NAV_LINK);

		await page.click('[data-test-action="new-readlist"]');
		await page.waitForSelector(RENAMEABLE_TAB);
		await page.click(RENAMEABLE_TAB);
		await expect(page.locator(EDITING_TAB)).toHaveCount(1);
		await replaceOpenName(page, LONGEST_READLIST_NAME);
		await page.keyboard.press("Enter");

		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText(LONGEST_READLIST_NAME);
		const wrapped = await measuredBox(page, ACTIVE_READLIST_TAB);
		assert.ok(
			wrapped.height > singleLine.height,
			"a name too wide for one line must wrap rather than be clipped",
		);
		assert.ok(
			wrapped.height >= MINIMUM_TOUCH_TARGET,
			`a readlist must be at least ${MINIMUM_TOUCH_TARGET}px tall to be tapped`,
		);
		await railBesideTheListing(page);

		for (const viewport of [WCAG_REFLOW_MINIMUM, PHONE, BREAKPOINT, DESKTOP]) {
			await page.setViewportSize(viewport);
			await expect(page.locator(ACTIVE_READLIST_TAB)).toBeVisible();
			const overflows = await page.evaluate(pageOverflowsSideways);
			expect({ width: viewport.width, overflows }).toEqual({
				width: viewport.width,
				overflows: false,
			});
		}
	});
});

test.describe("Naming a readlist the reader just made", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps the default name when the reader backs out, and does not ask again", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-name-esc-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await page.click('[data-test-action="new-readlist"]');
		await page.waitForSelector(RENAMEABLE_TAB);
		await page.click(RENAMEABLE_TAB);
		await replaceOpenName(page, LONGEST_READLIST_NAME);
		await page.keyboard.press("Escape");

		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist");
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("New Readlist");
		await expect(page.locator(RENAMEABLE_TAB)).toHaveCount(1);
	});

	test("lets the reader rename the same readlist again without a page load", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-rename-twice-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await page.click('[data-test-action="new-readlist"]');
		await page.waitForSelector(RENAMEABLE_TAB);

		await page.click(RENAMEABLE_TAB);
		await replaceOpenName(page, "Work Reading");
		await page.keyboard.press("Enter");
		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("Work Reading");

		await page.click(RENAMEABLE_TAB);
		await replaceOpenName(page, "Deep Work");
		await page.keyboard.press("Enter");

		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("Deep Work");
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("Deep Work");
	});

	test("opens the name for editing at the size it already renders", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-rename-size-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);
		await page.click(RENAMEABLE_TAB);
		await replaceOpenName(page, "Work Reading");
		await page.keyboard.press("Enter");
		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("Work Reading");
		await expect(page.locator(EDITING_TAB)).toHaveCount(0);
		await waitForBrandFonts(page, ["Inter"]);

		for (const viewport of [DESKTOP, PHONE]) {
			await page.setViewportSize(viewport);
			const resting = await nameSize(page);

			await page.click(RENAMEABLE_TAB);
			await expect(page.locator(EDITING_TAB)).toHaveCount(1);
			const editing = await nameSize(page);

			await page.keyboard.press("Escape");
			await expect(page.locator(EDITING_TAB)).toHaveCount(0);

			assert.deepEqual(
				editing,
				resting,
				`at ${viewport.width}px the name must open for editing at the size it already renders, measured ${JSON.stringify(resting)} then ${JSON.stringify(editing)}`,
			);
		}
	});

	test("keeps the rename ring where the reader can see it, on the rail and in the row", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-rename-ring-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openNewReadlist(page);

		for (const viewport of [DESKTOP, PHONE]) {
			await page.setViewportSize(viewport);
			await page.click(RENAMEABLE_TAB);
			await expect(page.locator(EDITING_TAB)).toHaveCount(1);
			const ring = await renameRing(page);

			await page.keyboard.press("Escape");
			await expect(page.locator(EDITING_TAB)).toHaveCount(0);

			ringIsVisible(ring, viewport.width);
		}
	});

	test("keeps the rename working after the listing has been swapped", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-rename-swap-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await page.click('[data-test-action="new-readlist"]');
		await page.waitForSelector(RENAMEABLE_TAB);

		await page.click(READ_FILTER_TAB);
		await expect(page.locator(RENAMEABLE_TAB)).toHaveCount(1);
		await page.click(RENAMEABLE_TAB);
		await replaceOpenName(page, "Work Reading");
		await page.keyboard.press("Enter");

		await expect(page.locator(ACTIVE_READLIST_LABEL)).toHaveText("Work Reading");
	});

	test("never offers the readlist every reader is given for renaming", async ({
		page,
	}, testInfo) => {
		const email = `readlist-nav-rename-default-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openReadlist(page);

		await expect(page.locator(RENAMEABLE_TAB)).toHaveCount(0);

		await page.click('[data-test-action="new-readlist"]');

		await expect(page.locator(RENAMEABLE_TAB)).toHaveCount(1);
	});
});

test.describe("Readlist status tabs", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("joins the tabs to the listing they scope", async ({ page }, testInfo) => {
		const email = `readlist-filter-tabs-join-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);
		await tabsJoinTheListing(page);
	});

	test("keeps the unread count on the tab while the counts request is in flight", async ({
		page,
	}, testInfo) => {
		const email = `readlist-filter-tabs-count-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);

		await page.route("**/queue/counts*", (route) => route.abort());

		await page.locator(READ_FILTER_TAB).click();
		await expect(page.locator(READ_FILTER_TAB)).toHaveClass(/readlist__filter-link--active/);
		await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText(
			`To Read (${SEEDED_ARTICLES.length})`,
		);

		await page.locator(UNREAD_FILTER_TAB).click();
		await expect(page.locator(UNREAD_FILTER_TAB)).toHaveClass(/readlist__filter-link--active/);
		await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText(
			`To Read (${SEEDED_ARTICLES.length})`,
		);
	});

	test("never carries the previous queue's count into the queue the reader switched to", async ({
		page,
	}, testInfo) => {
		const email = `readlist-filter-tabs-switch-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);
		const holdNextCounts = await holdCounts(page);

		const releaseMade = holdNextCounts();
		await page.click('[data-test-action="new-readlist"]');
		await page.waitForSelector(RENAMEABLE_TAB);
		await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText("To Read (0)");
		releaseMade();
		await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText("To Read (0)");

		const releaseDefault = holdNextCounts();
		await page.click(READLIST_NAV_LINK);
		await expect(page.locator(READLIST_NAV_LINK)).toHaveClass(/readlist-nav__link--active/);
		await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText(
			`To Read (${SEEDED_ARTICLES.length})`,
		);
		releaseDefault();
	});

	test("reserves the unread tab's widest count from first paint", async ({ page }, testInfo) => {
		const email = `readlist-filter-tabs-reserve-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithReadlist(page, email);
		await loginAs(page, email);
		await openReadlist(page);
		await seededReadlistSettled(page);
		await waitForBrandFonts(page, ["Inter"]);
		const counted = await measuredBox(page, UNREAD_FILTER_TAB);

		await page.route("**/queue/counts*", (route) => route.abort());
		await openReadlist(page);
		await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText(
			`To Read (${SEEDED_ARTICLES.length})`,
		);
		await waitForBrandFonts(page, ["Inter"]);
		const cold = await measuredBox(page, UNREAD_FILTER_TAB);

		const widestLabel = formatTabCountLabel({ label: "To Read", count: Number.MAX_SAFE_INTEGER });
		await page.locator(UNREAD_FILTER_LABEL).evaluate((label, text) => {
			label.textContent = text;
		}, widestLabel);
		const widest = await measuredBox(page, UNREAD_FILTER_TAB);

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
});

