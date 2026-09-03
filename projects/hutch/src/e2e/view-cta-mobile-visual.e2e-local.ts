import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
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
const CTA_BUTTON = ".view__cta-btn";

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
	const clipped = await page.locator(`${CTA_BUTTON} .view__cta-label`).evaluateAll((elements) =>
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
	const shown = await page
		.locator(`${CTA_BUTTON} .view__cta-label`)
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

test.describe("Public view CTA row on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("save and paste read on one line each", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, { stamp: `phone-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, checkpoint("view-cta-phone", phoneGeometry));
	});

	test("the EPUB download joins them without squeezing the row to three lines", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, {
			stamp: `phone-epub-${testInfo.workerIndex}-${Date.now()}`,
			query: "?feature=epub",
		});
		await page.waitForSelector("#view-cta-download-epub");
		await captureCheckpoint(page, checkpoint("view-cta-phone-epub", phoneGeometry));
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
		await page.waitForSelector("#view-cta-download-epub");
		await captureCheckpoint(page, checkpoint("view-cta-desktop", desktopGeometry));
	});
});
