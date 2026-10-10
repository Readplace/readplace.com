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
import { clickAndWaitForPageReload, nameNewReadlist, openReadlistSwitcher, railIsOpen } from "./page-interactions";
import { neutraliseVolatileChrome } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const ARTICLE_TITLE = "Yes you can measure engineering | Jade Rubick";
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 320, height: 720 };
const COLUMN = ".reading-layout__main";
const DEEP_WORK = "Deep Work";
const WEEKEND = "Weekend";
const LONG_READLIST_NAME = "Weekend reads on flights";
const READER_PHONE = { width: 375, height: 800 };
const ARTICLE_HEADER = "#article-header";
const READLIST_TAG = "[data-test-readlist-tag]";
const UNASSIGN = "[data-test-unassign-readlist]";

const SLOT = "[data-test-readlists-slot]";
const TOOLBAR = ".article-body__toolbar";
const TRIGGER = `${SLOT} [data-test-readlists-trigger]`;
const MENU = "[data-test-readlists-menu]";
const OPTION_BUTTONS = `${MENU} [data-test-assign-readlist]`;
const ROW_ONE = `${MENU} li:nth-child(1)`;
const ROW_TWO = `${MENU} li:nth-child(2)`;
const ROW_CREATE = `${MENU} [data-test-readlists-row="create"]`;
const CREATE_INPUT = `${MENU} [data-test-readlist-create-name]`;
const CREATE_SUBMIT = `${MENU} [data-test-action="readlist-create-assign"]`;
const READLIST_TAB = "[data-test-readlist]";

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	"[data-test-reader-related]",
	".crawl-bookmark",
	".reader__float-stack",
	".article-body__progress",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openReaderWithReadlists(
	page: Page,
	input: { stamp: string; secondReadlist: string; openRail: (page: Page) => Promise<void> },
): Promise<string> {
	const { stamp, secondReadlist, openRail } = input;
	const email = `readlist-picker-visual-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/readlist-picker-visual-${stamp}`,
			title: ARTICLE_TITLE,
			content: "<p>Seeded body for the add-to-readlist picker baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			generatedSummary: {
				summary: "Seeded summary so the reader's summary poller settles before the capture.",
				excerpt: "Seeded summary.",
			},
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());

	await loginAs(page, email);

	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await expect(page.locator(READLIST_TAB)).toHaveCount(1);
	await openRail(page);
	await clickAndWaitForPageReload(page, await nameNewReadlist(page, DEEP_WORK));
	await expect(page.locator(READLIST_TAB)).toHaveCount(2);
	await openRail(page);
	await clickAndWaitForPageReload(page, await nameNewReadlist(page, secondReadlist));
	await expect(page.locator(READLIST_TAB)).toHaveCount(3);

	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-reader");
	return articleId;
}

async function openReadlistPicker(
	page: Page,
	input: { stamp: string; openRail: (page: Page) => Promise<void> },
): Promise<void> {
	await openReaderWithReadlists(page, { stamp: input.stamp, secondReadlist: WEEKEND, openRail: input.openRail });
	await page.click(TRIGGER);
}

async function assignReadlist(page: Page, label: string): Promise<void> {
	await page.click(TRIGGER);
	await page.locator(OPTION_BUTTONS, { hasText: label }).click();
	await expect(page.locator(READLIST_TAG)).toContainText(label);
}

async function pickerOpen(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	const viewport = page.viewportSize();
	assert.ok(viewport, "the picker checkpoints must run with an explicit viewport");
	await page.mouse.move(0, viewport.height - 1);
	await expect(page.locator(TOOLBAR)).toHaveCSS("transform", "none");
	await expect(page.locator(MENU)).toBeVisible();
	await expect(page.locator(OPTION_BUTTONS)).toHaveText([DEEP_WORK, WEEKEND]);
	await expect(page.locator(CREATE_INPUT)).toBeVisible();
	await expect(page.locator(OPTION_BUTTONS).first()).toHaveCSS(
		"background-color",
		"rgba(0, 0, 0, 0)",
	);
	await waitForBrandFonts(page, ["Inter"]);
}

async function bothReadlistsSitAboveTheRowThatNamesANewOne(page: Page): Promise<void> {
	const menu = await measuredBox(page, MENU);
	const trigger = await measuredBox(page, TRIGGER);
	assert.ok(
		Math.abs(menu.x + menu.width - (trigger.x + trigger.width)) <= 0.5,
		"the menu must hang from the trigger's right edge",
	);
	assert.ok(
		menu.y >= trigger.y + trigger.height,
		"the menu must open below the trigger, never over it",
	);

	const stacked = [
		["first readlist", await measuredBox(page, ROW_ONE)],
		["second readlist", await measuredBox(page, ROW_TWO)],
		["create row", await measuredBox(page, ROW_CREATE)],
	] as const;
	for (let i = 1; i < stacked.length; i++) {
		const [name, row] = stacked[i];
		const [aboveName, above] = stacked[i - 1];
		assert.ok(
			row.y >= above.y + above.height,
			`the ${name} must sit below the ${aboveName}, not beside it`,
		);
	}
	for (const [name, row] of stacked) {
		assert.ok(
			row.x >= menu.x && row.x + row.width <= menu.x + menu.width,
			`the ${name} must sit inside the menu horizontally`,
		);
		assert.ok(
			row.y >= menu.y && row.y + row.height <= menu.y + menu.height,
			`the ${name} must sit inside the menu vertically`,
		);
	}

	const field = await measuredBox(page, CREATE_INPUT);
	const submit = await measuredBox(page, CREATE_SUBMIT);
	assert.equal(
		Math.round(field.height),
		Math.round(submit.height),
		"the name field and its + must share one height, the way the menu's other rows do",
	);
	assert.ok(
		submit.x >= field.x + field.width,
		"the + must follow the name field on one line, not wrap below it",
	);
}

async function theMenuStaysInsideTheColumn(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the phone checkpoint must run with an explicit viewport");

	const menu = await measuredBox(page, MENU);
	const column = await measuredBox(page, COLUMN);
	assert.ok(
		menu.x >= column.x - 0.5,
		`the menu must not open past the column's left edge, measured ${menu.x} against ${column.x}`,
	);
	assert.ok(
		menu.x + menu.width <= column.x + column.width + 0.5,
		"the menu must not open past the column's right edge",
	);

	const field = await measuredBox(page, CREATE_INPUT);
	assert.ok(
		field.x >= column.x - 0.5 && field.x + field.width <= column.x + column.width + 0.5,
		`the name field must sit inside the column, measured ${field.x}..${field.x + field.width}`,
	);

	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	assert.equal(
		scrollWidth,
		viewport.width,
		`an open picker must not widen the page, measured ${scrollWidth}`,
	);
}

function checkpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return {
		name,
		settled: pickerOpen,
		geometry,
		target: MENU,
		capture: "element",
		pinnedText: [],
	};
}

const READLIST_PICKER_OPEN_LIGHT = checkpoint(
	"readlist-picker-open-light",
	bothReadlistsSitAboveTheRowThatNamesANewOne,
);
const READLIST_PICKER_OPEN_DARK = checkpoint(
	"readlist-picker-open-dark",
	bothReadlistsSitAboveTheRowThatNamesANewOne,
);
const READLIST_PICKER_OPEN_PHONE = checkpoint(
	"readlist-picker-open-phone",
	theMenuStaysInsideTheColumn,
);

test.describe("Add-to-readlist picker", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("offers every readlist the article is not in, then a row to name a new one (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReadlistPicker(page, { stamp: `light-${testInfo.workerIndex}-${Date.now()}`, openRail: railIsOpen });
		await captureCheckpoint(page, READLIST_PICKER_OPEN_LIGHT);
	});

	test("offers every readlist the article is not in, then a row to name a new one (dark)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReadlistPicker(page, { stamp: `dark-${testInfo.workerIndex}-${Date.now()}`, openRail: railIsOpen });
		await captureCheckpoint(page, READLIST_PICKER_OPEN_DARK);
	});
});

test.describe("Add-to-readlist picker on the narrowest phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("opens against the column's edge instead of running off the left of the screen", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReadlistPicker(page, { stamp: `phone-${testInfo.workerIndex}-${Date.now()}`, openRail: openReadlistSwitcher });
		await captureCheckpoint(page, READLIST_PICKER_OPEN_PHONE);
	});
});

async function readlistTagSettled(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await page.mouse.move(0, 0);
	await expect(page.locator(READLIST_TAG)).toHaveCount(1);
	await waitForBrandFonts(page, ["Inter"]);
}

async function tagIsLargeWithASeparateRemoveTarget(page: Page): Promise<void> {
	const tag = await measuredBox(page, READLIST_TAG);
	assert.ok(Math.abs(tag.height - 34) <= 0.5, `the readlist tag must be 34px high, measured ${tag.height}px`);

	const target = await page.locator(UNASSIGN).evaluate((button) => {
		const box = button.getBoundingClientRect();
		const hitSlop = window.getComputedStyle(button, "::before");
		const hit = {
			left: box.left + Number.parseFloat(hitSlop.left),
			top: box.top + Number.parseFloat(hitSlop.top),
			right: box.right - Number.parseFloat(hitSlop.right),
			bottom: box.bottom - Number.parseFloat(hitSlop.bottom),
		};
		const corners = [
			[hit.left + 0.5, hit.top + 0.5],
			[hit.right - 0.5, hit.top + 0.5],
			[hit.left + 0.5, hit.bottom - 0.5],
			[hit.right - 0.5, hit.bottom - 0.5],
		];
		const label = document.createRange();
		const labelText = button.closest("[data-test-readlist-tag]")?.firstChild;
		if (!labelText) throw new Error("the readlist tag must open with its label text");
		label.selectNode(labelText);
		return {
			width: hit.right - hit.left,
			height: hit.bottom - hit.top,
			left: hit.left,
			cornersReachTheButton: corners.every(([x, y]) => button.contains(document.elementFromPoint(x, y))),
			labelRight: label.getBoundingClientRect().right,
		};
	});
	assert.ok(target.width >= 36 && target.height >= 36, `the remove target must be at least 36x36, measured ${target.width}x${target.height}`);
	assert.ok(target.cornersReachTheButton, "every corner of the remove target must land on the remove button");
	assert.ok(
		target.labelRight <= target.left + 0.5,
		`the remove target must stop at the label, measured label right ${target.labelRight} against target left ${target.left}`,
	);
}

async function tagWrapsInsideThePhone(page: Page): Promise<void> {
	const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
	assert.ok(fits, "a long readlist tag must never widen the page");
	const tag = await measuredBox(page, READLIST_TAG);
	const header = await measuredBox(page, ARTICLE_HEADER);
	assert.ok(tag.x + tag.width <= header.x + header.width + 0.5, "the readlist tag must stay inside the article header");
}

function readlistTagCheckpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return {
		name,
		settled: readlistTagSettled,
		geometry,
		target: ARTICLE_HEADER,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Reader readlist tag", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("shows an assigned readlist as a removable accent tag, and the x takes it off (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReaderWithReadlists(page, {
			stamp: `tag-light-${testInfo.workerIndex}-${Date.now()}`,
			secondReadlist: WEEKEND,
			openRail: railIsOpen,
		});
		await assignReadlist(page, WEEKEND);
		await captureCheckpoint(
			page,
			readlistTagCheckpoint("reader-readlist-tag-assigned-light", tagIsLargeWithASeparateRemoveTarget),
		);

		await page.click(UNASSIGN);
		await expect(page.locator(READLIST_TAG)).toHaveCount(0);
	});

	test("shows an assigned readlist as a removable accent tag (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReaderWithReadlists(page, {
			stamp: `tag-dark-${testInfo.workerIndex}-${Date.now()}`,
			secondReadlist: WEEKEND,
			openRail: railIsOpen,
		});
		await assignReadlist(page, WEEKEND);
		await captureCheckpoint(
			page,
			readlistTagCheckpoint("reader-readlist-tag-assigned-dark", tagIsLargeWithASeparateRemoveTarget),
		);
	});
});

test.describe("Reader readlist tag on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: READER_PHONE });

	test("keeps a cap-length readlist tag inside the page", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReaderWithReadlists(page, {
			stamp: `tag-phone-${testInfo.workerIndex}-${Date.now()}`,
			secondReadlist: LONG_READLIST_NAME,
			openRail: openReadlistSwitcher,
		});
		await assignReadlist(page, LONG_READLIST_NAME);
		await captureCheckpoint(
			page,
			readlistTagCheckpoint("reader-readlist-tag-assigned-phone", async (current) => {
				await tagIsLargeWithASeparateRemoveTarget(current);
				await tagWrapsInsideThePhone(current);
			}),
		);
	});

	test("styles the tag in the chromeless reader the iOS and Android apps load", async ({ page }, testInfo) => {
		const articleId = await openReaderWithReadlists(page, {
			stamp: `tag-chromeless-${testInfo.workerIndex}-${Date.now()}`,
			secondReadlist: WEEKEND,
			openRail: openReadlistSwitcher,
		});
		await assignReadlist(page, WEEKEND);

		await page.goto(`${BASE_URL}/queue/${articleId}/view?platform=ios`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-reader--chromeless");
		const tag = await measuredBox(page, READLIST_TAG);
		assert.ok(Math.abs(tag.height - 34) <= 0.5, `the chromeless readlist tag must be 34px high, measured ${tag.height}px`);
	});
});
