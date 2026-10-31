import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { neutraliseVolatileChrome } from "./page-measurements.browser";
import {
	CONFIRM,
	MENU_DELETE,
	MENU_PANEL,
	MENU_TOGGLE,
	OPEN_CONFIRM,
	createReader,
	login,
	openMenu,
	openReader,
	seedArticle,
} from "./reader-delete-fixture";
import { MACOS_CHROME_USER_AGENT } from "./user-agents";

const PHONE = { width: 390, height: 844 };
const PHONE_320 = { width: 320, height: 568 };
const DESKTOP = { width: 1280, height: 900 };
const MENU_ROW_PX = 44;

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	"[data-test-reader-related]",
];

async function openReaderMenu(page: Page, input: { label: string; workerIndex: number; query?: string }): Promise<void> {
	const stamp = `${input.label}-${input.workerIndex}-${Date.now()}`;
	const reader = await createReader(page, stamp);
	const { articleId } = await seedArticle(page, { reader, slug: stamp });
	await login(page, reader);
	await openReader(page, { articleId, query: input.query });
	await page.waitForSelector("#reader-downloads-slot.article-body__downloads-slot--visible", { state: "attached" });
	await openMenu(page);
}

async function settled(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function menuItems(page: Page): Promise<{ label: string; x: number; y: number; width: number; height: number }[]> {
	return page.locator(`${MENU_PANEL} .menu__item`).evaluateAll((items) =>
		items
			.map((item) => ({ label: item.textContent?.trim() ?? "", box: item.getBoundingClientRect() }))
			.filter((item) => item.box.width > 0)
			.map((item) => ({ label: item.label, x: item.box.x, y: item.box.y, width: item.box.width, height: item.box.height })),
	);
}

async function panelHangsFromTheToggle(page: Page): Promise<void> {
	const toggle = await measuredBox(page, MENU_TOGGLE);
	const panel = await measuredBox(page, MENU_PANEL);
	assert.ok(
		Math.abs(panel.x + panel.width - (toggle.x + toggle.width)) <= 0.5,
		"the menu's trailing edge must line up with its toggle's",
	);
	assert.ok(Math.abs(panel.y - (toggle.y + toggle.height + 4)) <= 0.5, "the menu must hang 4px below its toggle");
	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	assert.equal(scrollWidth, page.viewportSize()?.width, "the open menu must not widen the page");
}

async function wideMenuGeometry(page: Page): Promise<void> {
	await panelHangsFromTheToggle(page);
	const items = await menuItems(page);
	assert.deepEqual(
		items.map((item) => item.label),
		["Delete"],
		"a wide toolbar keeps Share and Download on the row, so its menu holds only Delete",
	);
}

async function compactMenuGeometry(page: Page): Promise<void> {
	await panelHangsFromTheToggle(page);
	const items = await menuItems(page);
	assert.deepEqual(
		items.map((item) => item.label),
		["Share", "Download EPUB", "Delete"],
		"a compact toolbar moves Share and Download into its menu, ahead of Delete",
	);
	for (const item of items) {
		assert.ok(item.height >= MENU_ROW_PX, `"${item.label}" must be a ${MENU_ROW_PX}px row, measured ${item.height}`);
	}
}

async function confirmGeometry(page: Page): Promise<void> {
	await page.waitForSelector(OPEN_CONFIRM);
	const panel = await measuredBox(page, OPEN_CONFIRM);
	const viewport = page.viewportSize();
	assert.ok(viewport, "the confirmation checkpoint must run with an explicit viewport");
	assert.ok(panel.x >= 0 && panel.x + panel.width <= viewport.width, "the confirmation must fit the viewport");
	assert.equal(
		await page.evaluate(() => document.activeElement?.getAttribute("data-test-action")),
		"delete-confirm",
		"the confirmation opens on Delete article",
	);
}

function menuCheckpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return { name, settled, geometry, target: MENU_PANEL, capture: "page-from-top", pinnedText: [] };
}

function confirmCheckpoint(name: string): VisualCheckpoint {
	return { name, settled, geometry: confirmGeometry, target: CONFIRM, capture: "element", pinnedText: [] };
}

async function openConfirm(page: Page): Promise<void> {
	await page.click(MENU_DELETE);
	await page.waitForSelector(OPEN_CONFIRM);
}

test.describe("Reader menu above the breakpoint", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, userAgent: MACOS_CHROME_USER_AGENT });

	for (const theme of ["light", "dark"] as const) {
		test(`holds only Delete and asks before deleting (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openReaderMenu(page, { label: `desktop-${theme}`, workerIndex: testInfo.workerIndex });
			await captureCheckpoint(page, menuCheckpoint(`reader-menu-desktop-${theme}`, wideMenuGeometry));
			await openConfirm(page);
			await captureCheckpoint(page, confirmCheckpoint(`reader-delete-confirm-desktop-${theme}`));
		});
	}
});

test.describe("Reader menu on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE, userAgent: MACOS_CHROME_USER_AGENT });

	test("holds Share and Download ahead of Delete", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReaderMenu(page, { label: "phone", workerIndex: testInfo.workerIndex });
		await captureCheckpoint(page, menuCheckpoint("reader-menu-phone", compactMenuGeometry));
	});

	test("holds the same items in the chromeless app reader", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReaderMenu(page, { label: "chromeless", workerIndex: testInfo.workerIndex, query: "?shell=app" });
		await page.waitForSelector("body.page-reader--chromeless");
		await captureCheckpoint(page, menuCheckpoint("reader-menu-chromeless-phone", compactMenuGeometry));
		await openConfirm(page);
		await captureCheckpoint(page, confirmCheckpoint("reader-delete-confirm-chromeless-phone"));
	});
});

test.describe("Reader menu on a 320px phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_320, userAgent: MACOS_CHROME_USER_AGENT });

	test("fits the menu and its confirmation inside the narrowest phone", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReaderMenu(page, { label: "phone-320", workerIndex: testInfo.workerIndex });
		await captureCheckpoint(page, menuCheckpoint("reader-menu-phone-320", compactMenuGeometry));
		await openConfirm(page);
		await captureCheckpoint(page, confirmCheckpoint("reader-delete-confirm-phone-320"));
	});
});
