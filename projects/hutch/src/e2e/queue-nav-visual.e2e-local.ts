import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import {
	type MeasuredBox,
	measureBoxes,
	neutraliseVolatileChrome,
	pageOverflowsSideways,
} from "./queue-nav.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const QUEUE_NAV = "main.queue .queue-nav";
const QUEUE_NAV_LINK = '[data-test-queue="default"]';
const QUEUE_CONTENT = "main.queue .queue__content";
const QUEUE_PANEL_INNER = "main.queue .queue__save-form";
const QUEUE_LIST = "[data-test-article-list]";
const QUEUE_TITLE = "main.queue .queue__title";
const QUEUE_FILTERS = "main.queue .queue__filters";
const QUEUE_LISTING = "main.queue .queue__listing";
const OPEN_FILTER_TAB = "main.queue .queue__filter-link--active";

const DEFAULT_QUEUE = "";
const QUEUES_PANEL = "?feature=queues";

const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };
const PHONE = { width: 390, height: 844 };
const BREAKPOINT = { width: 768, height: 900 };
const DESKTOP = { width: 1280, height: 900 };
/* Tall enough that the listing's bottom edge — the clip the whole-page capture
 * runs to — stays inside the viewport, which is as far as a clip can reach. */
const DESKTOP_TALL = { width: 1280, height: 1700 };
const PHONE_TALL = { width: 390, height: 2000 };

/* The card list, the empty state and the pagination row are measured against
 * this width by the queue-flow visual checkpoints, so the rail and the panel's
 * own border and padding have to come out of the page cap rather than out of
 * the listing. */
const DESKTOP_LISTING_WIDTH = 712;
const MINIMUM_TOUCH_TARGET = 44;
/* The tab's base edge deliberately sits on the panel's 1px border so the two
 * read as one piece — the join is the only overlap the layout may have. */
const TAB_PANEL_JOIN_PX = 1;
/* The filter strip is inset from the frame's corner by the same 12px the queues
 * rail uses, so the first tab lands on the frame's straight edge, not its arc. */
const TAB_STRIP_INSET_PX = 12;

const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEEDED_ARTICLES = [
	{
		url: "https://example.com/whole-page-queue-second",
		title: "The second article in the queue",
		savedAt: "2026-07-11T09:14:00.000Z",
		excerpt:
			"A fixed excerpt, long enough to occupy the two lines a real card excerpt occupies on both the phone and the desktop layout.",
	},
	{
		url: "https://example.com/whole-page-queue-first",
		title: "The article at the top of the queue",
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

async function createVerifiedUserWithQueue(page: Page, email: string): Promise<void> {
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
				content: "<p>Seeded body for the whole-page queue baseline.</p>",
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
	await page.waitForSelector("body.page-queue");
}

async function openQueue(page: Page, search: string): Promise<void> {
	await page.goto(`${BASE_URL}/queue${search}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-queue");
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

async function queueNavSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-queue");
	await expect(page.locator(QUEUE_NAV_LINK)).toHaveText("My Queue");
}

async function stacksAboveTheListing(page: Page): Promise<void> {
	const [nav, content] = await measurePair(page, [QUEUE_NAV, QUEUE_CONTENT]);
	assert.ok(
		nav.y + nav.height - TAB_PANEL_JOIN_PX <= content.y,
		"on a phone the queue must sit above the listing it scopes, joined only at the tab's base",
	);
	const link = await measuredBox(page, QUEUE_NAV_LINK);
	assert.ok(
		link.height >= MINIMUM_TOUCH_TARGET,
		`a queue must be at least ${MINIMUM_TOUCH_TARGET}px tall to be tapped`,
	);
}

async function railBesideTheListing(page: Page): Promise<void> {
	const [nav, content] = await measurePair(page, [QUEUE_NAV, QUEUE_CONTENT]);
	assert.ok(
		nav.x + nav.width - TAB_PANEL_JOIN_PX <= content.x,
		"past the breakpoint the queue must move left of the listing, joined only at the tab's base",
	);
	assert.equal(nav.y, content.y, "the rail and the listing must start on the same line");
	const listing = await measuredBox(page, QUEUE_PANEL_INNER);
	assert.equal(
		listing.width,
		DESKTOP_LISTING_WIDTH,
		"the rail and the panel frame must come out of the page cap, leaving the listing the width it always had",
	);
}

/* The count lands out of band: the page ships the tab reading "To Read" and a
 * GET /queue/counts swaps in "To Read (2)" a round-trip later, widening it. A
 * capture or a measurement taken before that swap records a layout the page
 * holds for one frame. */
async function seededQueueSettled(page: Page): Promise<void> {
	await expect(page.locator("[data-test-article]")).toHaveCount(SEEDED_ARTICLES.length);
	await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
	await expect(page.locator("#queue-filter-unread")).toHaveText(
		`To Read (${SEEDED_ARTICLES.length})`,
	);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: PINNED_SAVED_TIMES,
	});
}

async function wholeQueueSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-queue");
	await expect(page.locator(QUEUE_NAV_LINK)).toHaveText("My Queue");
	await seededQueueSettled(page);
}

/* Without the flag there is no rail naming the open queue — the page renders the
 * heading the panel layout hides — so settling waits on that instead. */
async function defaultQueueSettled(page: Page): Promise<void> {
	await page.waitForSelector("body.page-queue");
	await expect(page.locator(QUEUE_TITLE)).toHaveText("My Queue");
	await seededQueueSettled(page);
}

async function wholeQueueGeometry(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the queue page must never scroll sideways");
	const viewport = page.viewportSize();
	assert.ok(viewport, "a whole-page capture needs a fixed viewport to size its clip");
	const listing = await measuredBox(page, QUEUE_LIST);
	assert.ok(
		listing.y + listing.height <= viewport.height,
		`the whole-page clip runs to ${Math.ceil(listing.y + listing.height)}px, past the ${viewport.height}px viewport a clip can reach`,
	);
}

async function tabsJoinTheListing(page: Page): Promise<void> {
	const [strip, listing, openTab] = await measureTrio(page, [
		QUEUE_FILTERS,
		QUEUE_LISTING,
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

const WHOLE_QUEUE_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "queue-page-desktop-light",
	settled: wholeQueueSettled,
	geometry: wholeQueueGeometry,
	target: QUEUE_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

const WHOLE_QUEUE_DESKTOP_DARK: VisualCheckpoint = {
	name: "queue-page-desktop-dark",
	settled: wholeQueueSettled,
	geometry: wholeQueueGeometry,
	target: QUEUE_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

const WHOLE_QUEUE_MOBILE_LIGHT: VisualCheckpoint = {
	name: "queue-page-mobile-light",
	settled: wholeQueueSettled,
	geometry: wholeQueueGeometry,
	target: QUEUE_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

const RAIL_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "queue-nav-rail-desktop-light",
	settled: queueNavSettled,
	geometry: railBesideTheListing,
	target: QUEUE_NAV,
	capture: "element",
	pinnedText: [],
};

const RAIL_DESKTOP_DARK: VisualCheckpoint = {
	name: "queue-nav-rail-desktop-dark",
	settled: queueNavSettled,
	geometry: railBesideTheListing,
	target: QUEUE_NAV,
	capture: "element",
	pinnedText: [],
};

const ROW_MOBILE_LIGHT: VisualCheckpoint = {
	name: "queue-nav-row-mobile-light",
	settled: queueNavSettled,
	geometry: stacksAboveTheListing,
	target: QUEUE_NAV,
	capture: "element",
	pinnedText: [],
};

const DEFAULT_QUEUE_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "queue-page-default-desktop-light",
	settled: defaultQueueSettled,
	geometry: wholeQueueGeometry,
	target: QUEUE_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

const DEFAULT_QUEUE_DESKTOP_DARK: VisualCheckpoint = {
	name: "queue-page-default-desktop-dark",
	settled: defaultQueueSettled,
	geometry: wholeQueueGeometry,
	target: QUEUE_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

const DEFAULT_QUEUE_MOBILE_LIGHT: VisualCheckpoint = {
	name: "queue-page-default-mobile-light",
	settled: defaultQueueSettled,
	geometry: wholeQueueGeometry,
	target: QUEUE_LIST,
	capture: "page-from-top",
	pinnedText: [],
};

/* The strip's own box ends on the listing's border row, because that is what the
 * -1px join means — so an element capture of the strip is the close-up of the
 * seam, the same way the rail's element capture frames its join. */
const FILTER_TABS_JOIN_LIGHT: VisualCheckpoint = {
	name: "queue-filter-tabs-join-light",
	settled: defaultQueueSettled,
	geometry: tabsJoinTheListing,
	target: QUEUE_FILTERS,
	capture: "element",
	pinnedText: [],
};

const FILTER_TABS_JOIN_DARK: VisualCheckpoint = {
	name: "queue-filter-tabs-join-dark",
	settled: defaultQueueSettled,
	geometry: tabsJoinTheListing,
	target: QUEUE_FILTERS,
	capture: "element",
	pinnedText: [],
};

test.describe("Queue nav", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("names the open queue in a rail beside the listing (light)", async ({ page }, testInfo) => {
		const email = `queue-nav-desktop-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openQueue(page, QUEUES_PANEL);

		await captureCheckpoint(page, RAIL_DESKTOP_LIGHT);
	});

	test("names the open queue in a rail beside the listing (dark)", async ({ page }, testInfo) => {
		const email = `queue-nav-desktop-dark-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.emulateMedia({ colorScheme: "dark" });
		await createUser(page, email);
		await loginAs(page, email);
		await openQueue(page, QUEUES_PANEL);

		await captureCheckpoint(page, RAIL_DESKTOP_DARK);
	});
});

test.describe("Queue nav (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("stacks the open queue above the listing", async ({ page }, testInfo) => {
		const email = `queue-nav-mobile-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openQueue(page, QUEUES_PANEL);

		await captureCheckpoint(page, ROW_MOBILE_LIGHT);
	});
});

test.describe("Queue page", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	test("renders the whole queue beside its rail (light)", async ({ page }, testInfo) => {
		const email = `queue-page-desktop-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);
		await openQueue(page, QUEUES_PANEL);

		await captureCheckpoint(page, WHOLE_QUEUE_DESKTOP_LIGHT);
	});

	test("renders the whole queue beside its rail (dark)", async ({ page }, testInfo) => {
		const email = `queue-page-desktop-dark-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.emulateMedia({ colorScheme: "dark" });
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);
		await openQueue(page, QUEUES_PANEL);

		await captureCheckpoint(page, WHOLE_QUEUE_DESKTOP_DARK);
	});
});

test.describe("Queue page (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_TALL });

	test("renders the whole queue under its queue row", async ({ page }, testInfo) => {
		const email = `queue-page-mobile-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);
		await openQueue(page, QUEUES_PANEL);

		await captureCheckpoint(page, WHOLE_QUEUE_MOBILE_LIGHT);
	});
});

test.describe("Queue nav reflow", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("never makes the page scroll sideways, at any width the rail has to survive", async ({
		page,
	}, testInfo) => {
		const email = `queue-nav-reflow-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createUser(page, email);
		await loginAs(page, email);
		await openQueue(page, QUEUES_PANEL);

		for (const viewport of [WCAG_REFLOW_MINIMUM, PHONE, BREAKPOINT, DESKTOP]) {
			await page.setViewportSize(viewport);
			await expect(page.locator(QUEUE_NAV_LINK)).toBeVisible();
			const overflows = await page.evaluate(pageOverflowsSideways);
			expect({ width: viewport.width, overflows }).toEqual({
				width: viewport.width,
				overflows: false,
			});
		}
	});
});

test.describe("Queue page (default)", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	test("renders the whole queue under its status tabs (light)", async ({ page }, testInfo) => {
		const email = `queue-page-default-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);
		await openQueue(page, DEFAULT_QUEUE);

		await captureCheckpoint(page, DEFAULT_QUEUE_DESKTOP_LIGHT);
	});

	test("renders the whole queue under its status tabs (dark)", async ({ page }, testInfo) => {
		const email = `queue-page-default-dark-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.emulateMedia({ colorScheme: "dark" });
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);
		await openQueue(page, DEFAULT_QUEUE);

		await captureCheckpoint(page, DEFAULT_QUEUE_DESKTOP_DARK);
	});
});

test.describe("Queue page (default, mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_TALL });

	test("renders the whole queue under its status tabs", async ({ page }, testInfo) => {
		const email = `queue-page-default-mobile-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);
		await openQueue(page, DEFAULT_QUEUE);

		await captureCheckpoint(page, DEFAULT_QUEUE_MOBILE_LIGHT);
	});
});

test.describe("Queue status tabs", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("joins the tabs to the listing they scope (light)", async ({ page }, testInfo) => {
		const email = `queue-filter-tabs-light-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);
		await openQueue(page, DEFAULT_QUEUE);

		await captureCheckpoint(page, FILTER_TABS_JOIN_LIGHT);
	});

	test("joins the tabs to the listing they scope (dark)", async ({ page }, testInfo) => {
		const email = `queue-filter-tabs-dark-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.emulateMedia({ colorScheme: "dark" });
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);
		await openQueue(page, DEFAULT_QUEUE);

		await captureCheckpoint(page, FILTER_TABS_JOIN_DARK);
	});

	test("holds the same join inside the queues panel", async ({ page }, testInfo) => {
		const email = `queue-filter-tabs-panel-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createVerifiedUserWithQueue(page, email);
		await loginAs(page, email);

		for (const search of [DEFAULT_QUEUE, QUEUES_PANEL]) {
			await openQueue(page, search);
			await seededQueueSettled(page);
			await tabsJoinTheListing(page);
		}
	});
});
