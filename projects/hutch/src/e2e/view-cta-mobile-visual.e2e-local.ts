import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { neutraliseVolatileChrome } from "./readlist-nav.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const CTA = "[data-test-view-cta]";
const CTA_BUTTON = ".view__cta-btn, .view__downloads-trigger";
const CTA_LABEL = `${CTA} .view__cta-label, ${CTA} .view__downloads-label`;
const DOWNLOADS = "[data-test-view-downloads]";
const DOWNLOADS_TRIGGER = "[data-test-view-downloads-trigger]";
const DOWNLOADS_MENU = "[data-test-view-downloads-menu]";

const VOLATILE_CHROME = [
	".trial-countdown",
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	".crawl-bookmark",
	".view__share-row",
];

async function openPublicView(page: Page, params: { stamp: string; query: string }): Promise<void> {
	const slug = `view-cta-${params.stamp}`;
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/${slug}`,
			title: "How Google Sold Its Engineers on Management",
			content: "<p>Seeded body for the public view CTA baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	await page.goto(`${BASE_URL}/view/example.com/${slug}${params.query}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector(CTA);
}

async function ctaSettled(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await waitForBrandFonts(page, ["Inter"]);
}

async function everyLabelOnOneLine(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the CTA checkpoints must run with an explicit viewport");

	const row = await measuredBox(page, CTA);
	const buttons = await page.locator(CTA_BUTTON).evaluateAll((elements) =>
		elements.map((element) => {
			const rect = element.getBoundingClientRect();
			const visible = Array.from(element.children).find(
				(child) => getComputedStyle(child).display !== "none",
			);
			return {
				label: visible?.textContent ?? "",
				height: rect.height,
				lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
				top: rect.y,
			};
		}),
	);
	assert.ok(buttons.length >= 2, "the public view must offer at least save and paste-another-link");

	for (const button of buttons) {
		assert.ok(
			button.height <= 48,
			`"${button.label}" must read on one line — a wrapped label grows the button to ${button.height}px`,
		);
		assert.ok(
			Math.abs(button.top - buttons[0].top) <= 1,
			`"${button.label}" must share the row, not wrap below it`,
		);
	}

	assert.ok(
		row.height <= 80,
		`the sticky CTA bar must stay a single 44px row plus its padding, measured ${row.height}px`,
	);

	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	assert.equal(scrollWidth, viewport.width, `the CTA row must not widen the page, got ${scrollWidth}`);
}

async function phoneGeometry(page: Page): Promise<void> {
	await everyLabelOnOneLine(page);
	const clipped = await page.locator(CTA_LABEL).evaluateAll((elements) =>
		elements.map((element) => ({
			text: element.textContent ?? "",
			display: getComputedStyle(element).display,
			width: element.getBoundingClientRect().width,
		})),
	);
	for (const label of clipped) {
		assert.notEqual(label.display, "none", `"${label.text}" must stay in the accessibility tree`);
		assert.ok(label.width <= 1, `"${label.text}" must be clipped, not laid out, on a phone`);
	}
}

async function desktopGeometry(page: Page): Promise<void> {
	await everyLabelOnOneLine(page);
	assert.equal(
		(await page.locator(`${DOWNLOADS_TRIGGER} .view__downloads-label`).textContent())?.trim(),
		"Download",
		"the public download control must use singular copy",
	);
	const shown = await page
		.locator(CTA_LABEL)
		.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
	for (const width of shown) {
		assert.ok(width > 1, "the full label is the visible text above the breakpoint");
	}
}

function checkpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return {
		name,
		settled: ctaSettled,
		geometry,
		target: CTA,
		capture: "element",
		pinnedText: [],
	};
}

async function downloadsMenuOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${DOWNLOADS}[open]`);
	await page.waitForSelector(DOWNLOADS_MENU);
	await ctaSettled(page);
}

async function downloadsMenuGeometry(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the Download popup checkpoint must run with an explicit viewport");

	const trigger = await measuredBox(page, DOWNLOADS_TRIGGER);
	const menu = await measuredBox(page, DOWNLOADS_MENU);
	assert.ok(
		menu.y + menu.height <= trigger.y - 3,
		"the public Download popup must open above its sticky CTA trigger",
	);
	assert.ok(menu.x >= 0 && menu.x + menu.width <= viewport.width, "the popup must stay inside the viewport");
	assert.deepEqual(
		await page.locator(`${DOWNLOADS_MENU} [data-test-view-download]`).allTextContents(),
		["EPUB", "AZW3"],
		"the popup must preserve the EPUB then AZW3 order",
	);
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth),
		viewport.width,
		"an open Download popup must not widen the page",
	);
}

const DOWNLOADS_MENU_OPEN_PHONE: VisualCheckpoint = {
	name: "view-download-menu-open-phone",
	settled: downloadsMenuOpen,
	geometry: downloadsMenuGeometry,
	target: DOWNLOADS_MENU,
	capture: "element",
	pinnedText: [],
};

test.describe("Public view CTA row on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("save and paste share one row while Download stays hidden by default", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, { stamp: `phone-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await expect(page.locator("[data-test-view-downloads-slot]")).toHaveClass(
			"view__downloads-slot view__downloads-slot--hidden",
		);
		await captureCheckpoint(page, checkpoint("view-cta-phone", phoneGeometry));
	});

	test("Download remains in the row without squeezing it to three lines", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, {
			stamp: `phone-downloads-${testInfo.workerIndex}-${Date.now()}`,
			query: "?feature=epub",
		});
		await page.waitForSelector("#view-cta-downloads");
		await captureCheckpoint(page, checkpoint("view-cta-phone-epub", phoneGeometry));
	});

	test("Download opens an EPUB and AZW3 popup above the CTA", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, {
			stamp: `phone-download-open-${testInfo.workerIndex}-${Date.now()}`,
			query: "?feature=epub",
		});
		await page.locator(DOWNLOADS_TRIGGER).click();
		await captureCheckpoint(page, DOWNLOADS_MENU_OPEN_PHONE);
	});

	test("Download appears when content arrives and stays open as the summary settles", async ({ page }, testInfo) => {
		const slug = `download-pending-${testInfo.workerIndex}-${Date.now()}`;
		const article = {
			url: `https://example.com/${slug}`,
			title: "An article that finishes while its reader is open",
			content: "<p>The downloaded article is ready.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
		};
		await page.setExtraHTTPHeaders({ purpose: "prefetch" });
		await page.goto(`${BASE_URL}/view/example.com/${slug}?feature=epub`, { waitUntil: "domcontentloaded" });
		await page.setExtraHTTPHeaders({});
		await expect(page.locator("#view-cta-downloads-slot")).toBeHidden();
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, { data: article });
		assert.equal(seeded.status(), 201, "the article must become ready after the initial page render");
		await expect(page.locator(DOWNLOADS_TRIGGER)).toBeVisible();
		await page.locator(DOWNLOADS_TRIGGER).click();
		await expect(page.locator(DOWNLOADS)).toHaveAttribute("open", "");

		const summarized = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: { ...article, generatedSummary: { summary: "A settled summary.", excerpt: "A settled summary." } },
		});
		assert.equal(summarized.status(), 201, "the summary must settle after the menu opens");
		await expect(page.locator("[data-test-reader-summary]")).toHaveAttribute("data-summary-status", "ready");
		await expect(page.locator(DOWNLOADS)).toHaveAttribute("open", "");
		await downloadsMenuGeometry(page);
	});
});

test.describe("Public view CTA row above the breakpoint", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps the full labels", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, {
			stamp: `desktop-${testInfo.workerIndex}-${Date.now()}`,
			query: "?feature=epub",
		});
		await page.waitForSelector("#view-cta-downloads");
		await captureCheckpoint(page, checkpoint("view-cta-desktop", desktopGeometry));
	});
});
