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
import { clickAndWaitForPageReload, openReadlistSwitcher, railIsOpen } from "./page-interactions";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };

const TAB_HEIGHT = 40;
const STRIP_HEIGHT = 41;
const HIT_AREA_OVERHANG = 2;
const READ_TAB_WIDTH = 88;
const TO_READ_TAB_WIDTH = 111;
const TAB_SIDE_PADDING = 24;

const READLIST_TABS = "[data-test-filters]";
const READLIST_TAB = `${READLIST_TABS} .underline-tabs__tab`;
const UNREAD_TAB = '[data-test-filter="unread"]';
const READ_TAB = '[data-test-filter="read"]';
const PREFERENCES_TAB = '[data-test-filter="preferences"]';
const OPEN_READLIST_TAB = `${READLIST_TABS} [aria-current="page"]`;
const READLIST_BROWSE = ".readlist__browse";
const PREFERENCES_PANEL = "[data-test-readlist-preferences]";
const NEW_READLIST_BUTTON = '[data-test-action="new-readlist"]';
const PAGE_READLIST = "body.page-readlist";
const LISTING_COUNT = "#readlist-count";

const IMPORT_TABS = "[data-test-import-tabs]";
const INSTALL_TABS = '[data-test-section="tabs"]';
const INSTALL_GROUP = "[data-test-group]";

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const THEMES = ["light", "dark"] as const;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

function near(input: { actual: number; expected: number }): boolean {
	return Math.abs(input.actual - input.expected) <= 1;
}

async function createVerifiedUser(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await created.json()).userId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector(PAGE_READLIST);
}

async function signIn(page: Page, email: string): Promise<void> {
	await createVerifiedUser(page, email);
	await loginAs(page, email);
}

async function gotoReadlistQueue(page: Page, query: string): Promise<void> {
	const counts = page.waitForResponse((response) => response.url().includes("/queue/counts"));
	await page.goto(`${BASE_URL}/queue${query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(PAGE_READLIST);
	await counts;
	await expect(page.locator(UNREAD_TAB)).toHaveText("To Read");
	await expect(page.locator(LISTING_COUNT)).toHaveText("0 Saved Articles");
}

async function createCustomReadlist(page: Page, openRail: (page: Page) => Promise<void>): Promise<string> {
	await page.goto(`${BASE_URL}/queue?feature=pref`, { waitUntil: "domcontentloaded" });
	await openRail(page);
	await clickAndWaitForPageReload(page, page.locator(NEW_READLIST_BUTTON));
	await page.waitForFunction(() => new URL(window.location.href).searchParams.has("queue"));
	const slug = new URL(page.url()).searchParams.get("queue");
	assert.ok(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function gotoCustomReadlist(page: Page, slug: string): Promise<void> {
	await gotoReadlistQueue(page, `?queue=${encodeURIComponent(slug)}&feature=pref`);
	await page.waitForSelector(PREFERENCES_TAB);
}

async function gotoCustomReadlistPreferences(page: Page, slug: string): Promise<void> {
	await page.goto(`${BASE_URL}/queue/queues/${encodeURIComponent(slug)}/preferences?feature=pref`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector(PREFERENCES_PANEL);
	await expect(page.locator(PREFERENCES_TAB)).toHaveAttribute("aria-current", "page");
}

async function gotoImport(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-import");
	await expect(page.locator('[data-test-import-tab="from-url"]')).toHaveAttribute("aria-current", "page");
}

async function gotoInstall(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/install?client=chrome`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-install");
	await expect(page.locator('[data-test-tab="chrome"]')).toHaveAttribute("aria-current", "page");
}

async function tabBoxes(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }[]> {
	const boxes = [];
	for (const tab of await page.locator(selector).all()) {
		const box = await tab.boundingBox();
		assert.ok(box, `every "${selector}" tab must be laid out with a measurable box`);
		boxes.push(box);
	}
	return boxes;
}

async function tabWidth(page: Page, selector: string): Promise<number> {
	return (await measuredBox(page, selector)).width;
}

async function tabHugsItsReservedLabel(page: Page, selector: string): Promise<number> {
	const width = await tabWidth(page, selector);
	const label = (await measuredBox(page, `${selector} .underline-tabs__label`)).width;
	assert.ok(
		Math.abs(width - (label + 2 * TAB_SIDE_PADDING)) <= 0.5,
		`the "${selector}" tab must be its reserved label plus ${TAB_SIDE_PADDING}px each side, measured tab=${width}px label=${label}px`,
	);
	return width;
}

async function neverScrollsSideways(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the page must never scroll sideways");
}

async function stripOfFortyPixelTabs(page: Page, input: { strip: string; tab: string }): Promise<void> {
	const tabs = await tabBoxes(page, input.tab);
	assert.deepEqual(
		tabs.map((tab) => near({ actual: tab.height, expected: TAB_HEIGHT })),
		tabs.map(() => true),
		`every tab must be ${TAB_HEIGHT}px tall, measured ${JSON.stringify(tabs.map((tab) => tab.height))}`,
	);
	for (let i = 1; i < tabs.length; i++) {
		const previous = tabs[i - 1];
		assert.ok(
			Math.abs(tabs[i].x - (previous.x + previous.width)) <= 0.5,
			`tabs must abut with no gap, measured ${JSON.stringify(tabs)}`,
		);
	}
	const strip = await measuredBox(page, input.strip);
	assert.ok(
		near({ actual: strip.height, expected: STRIP_HEIGHT }),
		`the strip must be ${STRIP_HEIGHT}px tall, measured ${strip.height}px`,
	);
}

async function openUnderlineSitsOnTheBaseline(page: Page): Promise<void> {
	const open = await measuredBox(page, OPEN_READLIST_TAB);
	const strip = await measuredBox(page, READLIST_TABS);
	assert.ok(
		Math.abs(open.y + open.height - (strip.y + strip.height - 1)) <= 0.5,
		`the open underline must end one pixel above the strip's bottom edge, measured tab=${JSON.stringify(open)} strip=${JSON.stringify(strip)}`,
	);
}

async function tabsShareOneRow(page: Page, selector: string): Promise<void> {
	const tabs = await tabBoxes(page, selector);
	assert.deepEqual(
		tabs.map((tab) => near({ actual: tab.y, expected: tabs[0].y })),
		tabs.map(() => true),
		`every tab must share one row, measured ${JSON.stringify(tabs)}`,
	);
}

async function tabsSplitTheColumn(page: Page, input: { tab: string; column: string }): Promise<void> {
	const tabs = await tabBoxes(page, input.tab);
	const column = await measuredBox(page, input.column);
	assert.deepEqual(
		tabs.map((tab) => near({ actual: tab.width, expected: tabs[0].width })),
		tabs.map(() => true),
		`the tabs must split the column equally, measured ${JSON.stringify(tabs.map((tab) => tab.width))}`,
	);
	const spanned = tabs.reduce((total, tab) => total + tab.width, 0);
	assert.ok(
		near({ actual: spanned, expected: column.width }),
		`the tabs must span the ${column.width}px column, measured ${spanned}px`,
	);
}

async function readlistStripGeometry(page: Page): Promise<void> {
	await stripOfFortyPixelTabs(page, { strip: READLIST_TABS, tab: READLIST_TAB });
	await openUnderlineSitsOnTheBaseline(page);
}

async function threeTabStripGeometry(page: Page): Promise<void> {
	await readlistStripGeometry(page);
	await tabsShareOneRow(page, READLIST_TAB);
	await tabHugsItsReservedLabel(page, PREFERENCES_TAB);
}

async function readlistPhoneGeometry(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	await tabsSplitTheColumn(page, { tab: READLIST_TAB, column: READLIST_BROWSE });
}

async function importStripGeometry(page: Page): Promise<void> {
	await stripOfFortyPixelTabs(page, { strip: IMPORT_TABS, tab: `${IMPORT_TABS} .underline-tabs__tab` });
}

async function importPhoneGeometry(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	await tabsSplitTheColumn(page, { tab: `${IMPORT_TABS} .underline-tabs__tab`, column: IMPORT_TABS });
}

async function neutralise(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function restingStrip(page: Page): Promise<void> {
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
}

async function transitionsFinished(page: Page, selector: string): Promise<void> {
	await page
		.locator(selector)
		.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
}

async function readTabHovered(page: Page): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.locator(READ_TAB).hover();
	await transitionsFinished(page, READ_TAB);
}

async function readTabFocused(page: Page): Promise<void> {
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
	await page.locator(UNREAD_TAB).focus();
	await page.keyboard.press("Tab");
	const read = page.locator(READ_TAB);
	await expect(read).toBeFocused();
	await expect.poll(() => read.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
}

function stripCheckpoint(input: {
	name: string;
	target: string;
	settled?: (page: Page) => Promise<void>;
	geometry: (page: Page) => Promise<void>;
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: input.settled ?? restingStrip,
		geometry: input.geometry,
		target: input.target,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Underline tabs geometry on the readlist at desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("draws 40px tabs that abut on a 41px strip with a 44px hit area", async ({ page }, testInfo) => {
		await signIn(page, `underline-tabs-desktop-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await gotoReadlistQueue(page, "");
		await waitForBrandFonts(page, ["Inter"]);

		await readlistStripGeometry(page);
		const hits = await page.locator(READLIST_TAB).evaluateAll(
			(tabs, overhang) =>
				tabs.map((tab) => {
					const box = tab.getBoundingClientRect();
					const hit = document.elementFromPoint(box.left + box.width / 2, box.top - overhang);
					return hit?.closest(".underline-tabs__tab") === tab;
				}),
			HIT_AREA_OVERHANG,
		);
		assert.deepEqual(hits, [true, true], `a point ${HIT_AREA_OVERHANG}px above each tab must still hit that tab`);
	});

	test("keeps the Read tab at 88px whether it is open or not", async ({ page }, testInfo) => {
		await signIn(page, `underline-tabs-read-width-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await gotoReadlistQueue(page, "");
		await waitForBrandFonts(page, ["Inter"]);
		const closed = await tabWidth(page, READ_TAB);

		await gotoReadlistQueue(page, "?tab=done");
		await expect(page.locator(READ_TAB)).toHaveAttribute("aria-current", "page");
		await waitForBrandFonts(page, ["Inter"]);
		const open = await tabWidth(page, READ_TAB);

		assert.deepEqual(
			[near({ actual: closed, expected: READ_TAB_WIDTH }), near({ actual: open, expected: READ_TAB_WIDTH })],
			[true, true],
			`the Read tab must be ${READ_TAB_WIDTH}px wide in both states, measured closed=${closed}px open=${open}px`,
		);
		await openUnderlineSitsOnTheBaseline(page);
	});

	test("keeps the To Read tab at 111px whether it is open or not", async ({ page }, testInfo) => {
		await signIn(page, `underline-tabs-to-read-width-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await gotoReadlistQueue(page, "");
		await waitForBrandFonts(page, ["Inter"]);
		const open = await tabWidth(page, UNREAD_TAB);

		await gotoReadlistQueue(page, "?tab=done");
		await expect(page.locator(READ_TAB)).toHaveAttribute("aria-current", "page");
		await waitForBrandFonts(page, ["Inter"]);
		const closed = await tabWidth(page, UNREAD_TAB);

		const slug = await createCustomReadlist(page, railIsOpen);
		await gotoCustomReadlistPreferences(page, slug);
		await waitForBrandFonts(page, ["Inter"]);
		const onPreferences = await tabWidth(page, UNREAD_TAB);

		assert.deepEqual(
			[open, closed, onPreferences].map((actual) => near({ actual, expected: TO_READ_TAB_WIDTH })),
			[true, true, true],
			`the To Read tab must be ${TO_READ_TAB_WIDTH}px wide everywhere, measured open=${open}px closed=${closed}px preferences=${onPreferences}px`,
		);
	});

	test("keeps the Preferences tab at one width whether it is open or not", async ({ page }, testInfo) => {
		await signIn(page, `underline-tabs-preferences-width-${testInfo.workerIndex}-${Date.now()}@example.com`);
		const slug = await createCustomReadlist(page, railIsOpen);
		await gotoCustomReadlist(page, slug);
		await waitForBrandFonts(page, ["Inter"]);
		const closed = await tabHugsItsReservedLabel(page, PREFERENCES_TAB);

		await gotoCustomReadlistPreferences(page, slug);
		await waitForBrandFonts(page, ["Inter"]);
		const open = await tabHugsItsReservedLabel(page, PREFERENCES_TAB);

		assert.equal(open, closed, `the Preferences tab must keep one width, measured closed=${closed}px open=${open}px`);
		await openUnderlineSitsOnTheBaseline(page);
	});
});

test.describe("Underline tabs geometry on the readlist on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("splits the two readlist tabs equally across the column", async ({ page }, testInfo) => {
		await signIn(page, `underline-tabs-phone-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await gotoReadlistQueue(page, "");
		await waitForBrandFonts(page, ["Inter"]);

		await expect(page.locator(READLIST_TAB)).toHaveCount(2);
		await readlistPhoneGeometry(page);
	});

	test("fits three tabs on one row on a custom readlist", async ({ page }, testInfo) => {
		await signIn(page, `underline-tabs-phone-three-${testInfo.workerIndex}-${Date.now()}@example.com`);
		const slug = await createCustomReadlist(page, openReadlistSwitcher);
		await gotoCustomReadlist(page, slug);
		await waitForBrandFonts(page, ["Inter"]);

		await expect(page.locator(READLIST_TAB)).toHaveCount(3);
		await tabsShareOneRow(page, READLIST_TAB);
	});
});

test.describe("Underline tabs geometry at the WCAG reflow width", () => {
	test.use({ timezoneId: "UTC", viewport: WCAG_REFLOW_MINIMUM });

	test("never scrolls the strip sideways at 320px", async ({ page }, testInfo) => {
		await signIn(page, `underline-tabs-reflow-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await gotoReadlistQueue(page, "");
		await waitForBrandFonts(page, ["Inter"]);

		await neverScrollsSideways(page);
		const strip = await page
			.locator(READLIST_TABS)
			.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
		assert.equal(strip.scrollWidth, strip.clientWidth, "the tab strip must wrap rather than scroll sideways");
	});
});

test.describe("Underline tabs geometry on the install page", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps both client groups on one row at desktop", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await gotoInstall(page);
		await waitForBrandFonts(page, ["Inter"]);

		const groups = await tabBoxes(page, INSTALL_GROUP);
		assert.equal(groups.length, 2, "the install page must render two client groups");
		assert.ok(
			near({ actual: groups[1].y, expected: groups[0].y }),
			`the two install groups must share a row, measured ${JSON.stringify(groups)}`,
		);
	});
});

test.describe("Underline tabs on the readlist at desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows three tabs with Preferences open on a custom readlist (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, `underline-tabs-three-${theme}-${testInfo.workerIndex}-${Date.now()}@example.com`);
			const slug = await createCustomReadlist(page, railIsOpen);
			await gotoCustomReadlistPreferences(page, slug);

			await captureCheckpoint(
				page,
				stripCheckpoint({
					name: `underline-tabs-readlist-three-${theme}`,
					target: READLIST_TABS,
					geometry: threeTabStripGeometry,
				}),
			);
		});
	}

	test("previews the underline on the hovered Read tab", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `underline-tabs-hover-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await gotoReadlistQueue(page, "");

		await captureCheckpoint(
			page,
			stripCheckpoint({
				name: "underline-tabs-readlist-hover-light",
				target: READLIST_TABS,
				settled: readTabHovered,
				geometry: readlistStripGeometry,
			}),
		);
	});

	test("rings the Read tab under keyboard focus", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `underline-tabs-focus-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await gotoReadlistQueue(page, "");

		await captureCheckpoint(
			page,
			stripCheckpoint({
				name: "underline-tabs-readlist-focus-light",
				target: READLIST_TABS,
				settled: readTabFocused,
				geometry: readlistStripGeometry,
			}),
		);
	});
});

test.describe("Underline tabs on the readlist on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("splits To Read and Read across the column", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `underline-tabs-readlist-phone-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await gotoReadlistQueue(page, "");

		await captureCheckpoint(
			page,
			stripCheckpoint({
				name: "underline-tabs-readlist-phone",
				target: READLIST_TABS,
				geometry: readlistPhoneGeometry,
			}),
		);
	});
});

test.describe("Underline tabs on the public pages at desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("shows Paste a link open on the import page", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await gotoImport(page);

		await captureCheckpoint(
			page,
			stripCheckpoint({ name: "underline-tabs-import-light", target: IMPORT_TABS, geometry: importStripGeometry }),
		);
	});

	test("shows Chrome open on the install page", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await gotoInstall(page);

		await captureCheckpoint(
			page,
			stripCheckpoint({ name: "underline-tabs-install-light", target: INSTALL_TABS, geometry: neverScrollsSideways }),
		);
	});
});

test.describe("Underline tabs on the public pages on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("splits the import tabs across the column", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await gotoImport(page);

		await captureCheckpoint(
			page,
			stripCheckpoint({ name: "underline-tabs-import-phone", target: IMPORT_TABS, geometry: importPhoneGeometry }),
		);
	});

	test("shows the install tabs", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await gotoInstall(page);

		await captureCheckpoint(
			page,
			stripCheckpoint({ name: "underline-tabs-install-phone", target: INSTALL_TABS, geometry: neverScrollsSideways }),
		);
	});
});
