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
const CTA_BUTTON = ".view__cta-btn, .view__download";
const CTA_LABEL = `${CTA} .view__cta-label, ${CTA} .view__download-label`;
const DOWNLOAD = "[data-test-view-download]";

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
		(await page.locator(`${DOWNLOAD} .view__download-label`).textContent())?.trim(),
		"Download EPUB",
		"the public download control must name the format it delivers",
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

test.describe("Public view CTA row on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("save, paste and Download share one row without squeezing it to three lines", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, { stamp: `phone-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await expect(page.locator("[data-test-view-downloads-slot]")).toHaveClass(
			"view__cta-item view__downloads-slot view__downloads-slot--visible",
		);
		await page.waitForSelector(DOWNLOAD);
		await captureCheckpoint(page, checkpoint("view-cta-phone", phoneGeometry));
	});

	test("Download appears when content arrives and survives the summary settling", async ({ page }, testInfo) => {
		const slug = `download-pending-${testInfo.workerIndex}-${Date.now()}`;
		const article = {
			url: `https://example.com/${slug}`,
			title: "An article that finishes while its reader is open",
			content: "<p>The downloaded article is ready.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
		};
		await page.setExtraHTTPHeaders({ purpose: "prefetch" });
		await page.goto(`${BASE_URL}/view/example.com/${slug}`, { waitUntil: "domcontentloaded" });
		await page.setExtraHTTPHeaders({});
		await expect(page.locator("#view-cta-downloads-slot")).toBeHidden();
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, { data: article });
		assert.equal(seeded.status(), 201, "the article must become ready after the initial page render");
		await expect(page.locator(DOWNLOAD)).toBeVisible();

		// The summary poll re-swaps the slot out of band on every tick, so the
		// control has to survive a swap it did not cause — the invariant the
		// disclosure's hx-preserve used to carry.
		const summarized = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: { ...article, generatedSummary: { summary: "A settled summary.", excerpt: "A settled summary." } },
		});
		assert.equal(summarized.status(), 201, "the summary must settle after the download link appears");
		await expect(page.locator("[data-test-reader-summary]")).toHaveAttribute("data-summary-status", "ready");
		await expect(page.locator(DOWNLOAD)).toBeVisible();
		await expect(page.locator(DOWNLOAD)).toHaveAttribute("href", /format=epub/);
	});
});

test.describe("Public view CTA row above the breakpoint", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps the full labels", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, {
			stamp: `desktop-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
		});
		await page.waitForSelector(DOWNLOAD);
		await captureCheckpoint(page, checkpoint("view-cta-desktop", desktopGeometry));
	});
});
