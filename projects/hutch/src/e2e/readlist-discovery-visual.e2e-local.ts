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
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const DESKTOP = { width: 1280, height: 900 };
const DESKTOP_TALL = { width: 1280, height: 1700 };
const TABLET = { width: 768, height: 900 };
const PHONE = { width: 390, height: 844 };
const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };
const THEMES = ["light", "dark"] as const;

const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEARCH_WORD = "deep";
const NO_MATCH_QUERY = "?q=no-such-words-anywhere";
const FILTERED_QUERY = "?time=5-10&saved=month&topic=Personal+finance";
const PINNED_SAVED_TIMES = ["2h ago", "3h ago", "4h ago"];

const MAIN = "main.readlist";
const BROWSE = ".readlist__browse";
const FILTER_TABS = "[data-test-filters]";
const DISCOVERY = "[data-test-discovery]";
const LISTING = "[data-test-listing]";
const LISTING_COUNT = "#readlist-count";
const ARTICLE = "[data-test-article]";
const SEARCH_FORM = '[data-test-form="readlist-search"]';
const SEARCH_INPUT = "#readlist-search-input";
const SEARCH_GLYPH = `${SEARCH_FORM} .readlist-search__icon svg`;
const FILTER_TRIGGER = '[data-test-action="open-discovery-filters"]';
const FILTER_GLYPH = `${FILTER_TRIGGER} svg`;
const DRAWER = "[data-test-discovery-drawer]";
const OPEN_DRAWER = `${DRAWER}:popover-open`;
const DRAWER_HEADER = `${DRAWER} .readlist-filters__header`;
const DRAWER_FOOTER = `${DRAWER} .readlist-filters__footer`;
const DRAWER_CHIP = `${DRAWER} .chip--filter`;
const DRAWER_CLEAR = `${DRAWER} [data-test-action="clear-discovery-filters"]`;
const DRAWER_APPLY = `${DRAWER} [data-test-action="apply-discovery-filters"]`;
const CLEAR_DISCOVERY = '[data-test-empty-readlist] [data-test-empty-action="clear-discovery"]';
const PAGE_READLIST = "body.page-readlist";

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const SEEDED_ARTICLES = [
	{
		slug: "deep-work",
		title: "Deep work in a distracted office",
		siteName: "Calm Notes",
		wordCount: 700,
		topics: ["Focus", "Productivity"],
	},
	{
		slug: "index-funds",
		title: "Index funds for the patient saver",
		siteName: "Money Weekly",
		wordCount: 1900,
		topics: ["Personal finance"],
	},
	{
		slug: "night-train",
		title: "The slow return of the night train",
		siteName: "Field Journal",
		wordCount: 5200,
		topics: ["Lifestyle", "Trends"],
	},
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function seedReader(page: Page, stamp: string): Promise<void> {
	const email = `readlist-discovery-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	for (const article of SEEDED_ARTICLES) {
		const excerpt = `A fixed excerpt for the discovery baseline about ${article.title.toLowerCase()}.`;
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/${article.slug}-${stamp}`,
				title: article.title,
				siteName: article.siteName,
				wordCount: article.wordCount,
				content: "<p>Seeded body for the readlist discovery baseline.</p>",
				contentFetchedAt: SEEDED_FETCHED_AT,
				savedByUserId: userId,
				excerpt,
				generatedSummary: {
					summary: "Seeded summary for the readlist discovery baseline.",
					excerpt,
					topics: article.topics,
				},
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	}
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector(PAGE_READLIST);
}

async function gotoReadlistQueue(page: Page, query: string): Promise<void> {
	const counts = page.waitForResponse((response) => response.url().includes("/queue/counts"));
	await page.goto(`${BASE_URL}/queue${query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(PAGE_READLIST);
	await counts;
}

async function neutralise(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: PINNED_SAVED_TIMES });
}

async function openDrawer(page: Page): Promise<void> {
	await page.locator(FILTER_TRIGGER).click();
	await expect(page.locator(OPEN_DRAWER)).toBeVisible();
}

function near(actual: number, expected: number): boolean {
	return Math.abs(actual - expected) <= 1;
}

async function neverScrollsSideways(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, `the queue page must never scroll sideways at ${page.viewportSize()?.width}px`);
}

async function discoveryRowGeometry(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	const tabs = await measuredBox(page, FILTER_TABS);
	const row = await measuredBox(page, DISCOVERY);
	const field = await measuredBox(page, SEARCH_INPUT);
	const trigger = await measuredBox(page, FILTER_TRIGGER);
	const listing = await measuredBox(page, LISTING);
	const searchGlyph = await measuredBox(page, SEARCH_GLYPH);
	const filterGlyph = await measuredBox(page, FILTER_GLYPH);
	assert.ok(near(row.height, 48), `the search row must be 48px high, measured ${row.height}px`);
	assert.ok(near(field.height, 48), `the search field must be 48px high, measured ${field.height}px`);
	assert.ok(
		near(trigger.width, 48) && near(trigger.height, 48),
		`the filter button must be 48x48, measured ${trigger.width}x${trigger.height}`,
	);
	assert.ok(
		near(field.width, row.width - 56),
		`the search field must fill the row less the button and its 8px gap, measured field=${field.width}px row=${row.width}px`,
	);
	assert.ok(near(trigger.x + trigger.width, row.x + row.width), "the filter button must close the row");
	assert.ok(near(row.y - (tabs.y + tabs.height), 32), "the search row must sit 32px below the tabs");
	assert.ok(near(listing.y - (row.y + row.height), 16), "the listing must sit 16px below the search row");
	assert.ok(
		near(searchGlyph.width, 20) && near(searchGlyph.height, 20),
		`the search glyph must be 20px, measured ${searchGlyph.width}x${searchGlyph.height}`,
	);
	assert.ok(
		near(filterGlyph.width, 24) && near(filterGlyph.height, 24),
		`the filter glyph must be 24px, measured ${filterGlyph.width}x${filterGlyph.height}`,
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

async function searchResultsGeometry(page: Page): Promise<void> {
	await discoveryRowGeometry(page);
	await pageFitsTheClip(page);
}

async function noResultsGeometry(page: Page): Promise<void> {
	await discoveryRowGeometry(page);
	const action = await measuredBox(page, CLEAR_DISCOVERY);
	assert.ok(near(action.height, 48), `Clear search must stay one 48px line, measured ${action.height}px`);
}

async function drawerGeometry(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the drawer geometry needs a fixed viewport");
	await neverScrollsSideways(page);
	const drawer = await measuredBox(page, OPEN_DRAWER);
	const header = await measuredBox(page, DRAWER_HEADER);
	const footer = await measuredBox(page, DRAWER_FOOTER);
	const clear = await measuredBox(page, DRAWER_CLEAR);
	const apply = await measuredBox(page, DRAWER_APPLY);
	const width = Math.min(600, viewport.width);
	assert.ok(near(drawer.width, width), `the drawer must be ${width}px wide at ${viewport.width}px, measured ${drawer.width}px`);
	assert.ok(near(drawer.x + drawer.width, viewport.width), "the drawer must sit flush with the right edge");
	assert.ok(near(drawer.y, 0) && near(drawer.height, viewport.height), "the drawer must run the viewport's full height");
	assert.ok(near(header.height, 73), `the drawer header must be 73px high, measured ${header.height}px`);
	assert.ok(
		near(footer.y + footer.height, viewport.height),
		`the drawer footer must end at the viewport's bottom edge, measured ${footer.y + footer.height}px`,
	);
	assert.ok(
		near(apply.x + apply.width, drawer.x + drawer.width - 24),
		"Apply filters must sit 24px inside the drawer's trailing edge",
	);
	assert.ok(clear.x >= drawer.x + 23, `Clear all must stay inside the footer's padding, measured x=${clear.x}px`);
	assert.ok(
		near(clear.height, 48) && near(apply.height, 48),
		`Clear all and Apply filters must each keep a one-line 48px label, measured ${clear.height}px and ${apply.height}px`,
	);
	const chips = await page.locator(DRAWER_CHIP).all();
	assert.ok(chips.length > 0, "the open drawer must offer filter chips");
	for (const chip of chips) {
		const box = await chip.boundingBox();
		assert.ok(box, "an offered filter chip must be laid out");
		assert.ok(near(box.height, 50), `a filter chip must be 50px high, measured ${box.height}px`);
	}
}

async function footerKeepsOneRow(page: Page): Promise<void> {
	const footer = await measuredBox(page, DRAWER_FOOTER);
	const clear = await measuredBox(page, DRAWER_CLEAR);
	const apply = await measuredBox(page, DRAWER_APPLY);
	assert.ok(near(footer.height, 81), `the drawer footer must be 81px high, measured ${footer.height}px`);
	assert.ok(near(clear.y, apply.y), "Clear all and Apply filters must share one row");
	assert.ok(near(apply.x - (clear.x + clear.width), 16), "Clear all must sit 16px before Apply filters");
}

async function footerStacksItsButtons(page: Page): Promise<void> {
	const clear = await measuredBox(page, DRAWER_CLEAR);
	const apply = await measuredBox(page, DRAWER_APPLY);
	assert.ok(
		near(clear.y - (apply.y + apply.height), 16),
		"a footer too narrow for one row must stack Apply filters 16px above Clear all",
	);
}

async function openDrawerGeometry(page: Page): Promise<void> {
	await drawerGeometry(page);
	await footerKeepsOneRow(page);
}

const DRAWER_WIDTHS = [
	{ viewport: WCAG_REFLOW_MINIMUM, footer: footerStacksItsButtons },
	{ viewport: PHONE, footer: footerKeepsOneRow },
	{ viewport: TABLET, footer: footerKeepsOneRow },
	{ viewport: DESKTOP, footer: footerKeepsOneRow },
];

async function searchResultsSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(DISCOVERY)).toHaveClass(/\breadlist-discovery--visible\b/);
	await expect(page.locator(SEARCH_INPUT)).toHaveValue(SEARCH_WORD);
	await expect(page.locator(ARTICLE)).toHaveCount(1);
	await expect(page.locator(LISTING_COUNT)).toHaveText("1 Saved Article");
	await page.mouse.move(0, 0);
}

async function noResultsSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(DISCOVERY)).toHaveClass(/\breadlist-discovery--visible\b/);
	await expect(page.locator(ARTICLE)).toHaveCount(0);
	await expect(page.locator(CLEAR_DISCOVERY)).toBeVisible();
	await page.mouse.move(0, 0);
}

async function drawerOpenSettled(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await expect(page.locator(ARTICLE)).toHaveCount(1);
	await expect(page.locator(LISTING_COUNT)).toHaveText("1 Saved Article");
	await openDrawer(page);
	await expect(page.locator(`${OPEN_DRAWER} input:checked`)).toHaveCount(3);
	await page.mouse.move(0, 0);
}

const SEARCH_RESULTS: VisualCheckpoint = {
	name: "readlist-search-results",
	settled: searchResultsSettled,
	geometry: searchResultsGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const SEARCH_RESULTS_PHONE: VisualCheckpoint = {
	...SEARCH_RESULTS,
	name: "readlist-search-results-phone",
	geometry: discoveryRowGeometry,
	target: BROWSE,
	capture: "element",
};

const SEARCH_NO_RESULTS: VisualCheckpoint = {
	name: "readlist-search-no-results",
	settled: noResultsSettled,
	geometry: noResultsGeometry,
	target: LISTING,
	capture: "element",
	pinnedText: [],
};

const FILTER_DRAWER: VisualCheckpoint = {
	name: "readlist-filter-drawer",
	settled: drawerOpenSettled,
	geometry: openDrawerGeometry,
	target: DRAWER,
	capture: "page-from-top",
	pinnedText: [],
};

const FILTER_DRAWER_PHONE: VisualCheckpoint = {
	...FILTER_DRAWER,
	name: "readlist-filter-drawer-phone",
};

function withTheme(checkpoint: VisualCheckpoint, theme: (typeof THEMES)[number]): VisualCheckpoint {
	return { ...checkpoint, name: `${checkpoint.name}-${theme}` };
}

test.describe("Readlist search results", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`narrows the listing to the articles a search names (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await seedReader(page, `results-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await gotoReadlistQueue(page, `?q=${SEARCH_WORD}`);

			await captureCheckpoint(page, withTheme(SEARCH_RESULTS, theme));
		});

		test(`says nothing matches and offers to clear the search (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await seedReader(page, `no-results-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await gotoReadlistQueue(page, NO_MATCH_QUERY);

			await captureCheckpoint(page, withTheme(SEARCH_NO_RESULTS, theme));
		});
	}
});

test.describe("Readlist search results (phone)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("keeps the search row one line beside its filter button", async ({ page }, testInfo) => {
		await seedReader(page, `results-phone-${testInfo.workerIndex}-${Date.now()}`);
		await gotoReadlistQueue(page, `?q=${SEARCH_WORD}`);

		await captureCheckpoint(page, SEARCH_RESULTS_PHONE);
	});
});

test.describe("Readlist filter drawer", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`slides in over a blurred scrim with the URL's filters ticked (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await seedReader(page, `drawer-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await gotoReadlistQueue(page, FILTERED_QUERY);

			await captureCheckpoint(page, withTheme(FILTER_DRAWER, theme));
		});
	}

	test("never scrolls the page sideways from 320px up to desktop", async ({ page }, testInfo) => {
		await seedReader(page, `drawer-widths-${testInfo.workerIndex}-${Date.now()}`);
		await gotoReadlistQueue(page, FILTERED_QUERY);
		await waitForBrandFonts(page, ["Inter"]);
		await openDrawer(page);

		for (const { viewport, footer } of DRAWER_WIDTHS) {
			await page.setViewportSize(viewport);
			await expect(page.locator(OPEN_DRAWER)).toBeVisible();
			await drawerGeometry(page);
			await footer(page);
		}
	});

	test("Escape and a scrim click close the drawer without navigating", async ({ page }, testInfo) => {
		await seedReader(page, `drawer-dismiss-${testInfo.workerIndex}-${Date.now()}`);
		await gotoReadlistQueue(page, FILTERED_QUERY);
		const filtered = page.url();

		await openDrawer(page);
		await page.keyboard.press("Escape");
		await expect(page.locator(OPEN_DRAWER)).toHaveCount(0);
		expect(page.url()).toBe(filtered);

		await openDrawer(page);
		await page.mouse.click(8, 450);
		await expect(page.locator(OPEN_DRAWER)).toHaveCount(0);
		expect(page.url()).toBe(filtered);
		await expect(page.locator(ARTICLE)).toHaveCount(1);
	});
});

test.describe("Readlist filter drawer (phone)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("covers the full width with its footer inside the viewport", async ({ page }, testInfo) => {
		await seedReader(page, `drawer-phone-${testInfo.workerIndex}-${Date.now()}`);
		await gotoReadlistQueue(page, FILTERED_QUERY);

		await captureCheckpoint(page, FILTER_DRAWER_PHONE);
	});
});

test.describe("Readlist search history", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("Enter keeps focus in the field, and Back returns to the unfiltered listing", async ({ page }, testInfo) => {
		await seedReader(page, `search-history-${testInfo.workerIndex}-${Date.now()}`);
		await gotoReadlistQueue(page, "");
		await expect(page.locator(ARTICLE)).toHaveCount(SEEDED_ARTICLES.length);

		const field = page.locator(SEARCH_INPUT);
		await field.fill(SEARCH_WORD);
		await field.press("Enter");
		await expect(page.locator(ARTICLE)).toHaveCount(1);
		await expect(field).toBeFocused();
		await expect(field).toHaveValue(SEARCH_WORD);
		await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(SEARCH_WORD);

		await page.goBack();
		await expect(page.locator(ARTICLE)).toHaveCount(SEEDED_ARTICLES.length);
		await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
	});
});
