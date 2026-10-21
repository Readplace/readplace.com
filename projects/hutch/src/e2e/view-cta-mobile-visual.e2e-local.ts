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
import { measureBoxes, neutraliseVolatileChrome } from "./page-measurements.browser";
import { MACOS_CHROME_USER_AGENT } from "./user-agents";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const DESKTOP_WIDTHS = [1024, 1200, 1440];
const WIDE_PAIR = { width: 1440, left: 316, right: 1124 };
const XL_BUTTON = { width: 400, height: 56, gap: 8 };
const DESKTOP_BAR_HEIGHT = 105;
const PHONE_BAR_HEIGHT = 89;
const BAR_SHADOW = {
	light: "rgba(0, 0, 0, 0.2) 0px -2px 12px 0px",
	dark: "rgba(0, 0, 0, 0.5) 0px -2px 12px 0px",
} as const;
const MAX_TABS_TO_THE_BAR = 40;

const CTA = "[data-test-view-cta]";
const CTA_BUTTON = ".view__cta-btn";
const CTA_LABEL = `${CTA} .view__cta-label`;
const CTA_SHORT_LABEL = `${CTA} .view__cta-label-short`;
const DOWNLOAD = "[data-test-download]";
const EPUB_DOWNLOAD = '[data-test-download="epub"]';
const COLUMN = ".reading-layout__main";
const CTA_CONTENT = ".view__cta-content";
const PASTE = "#view-cta-paste-another-link";
const SAVE = "#view-cta-save";

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	".article-history",
	".table-of-contents",
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

async function everyLabelOnOneLine(page: Page, barHeight: number): Promise<void> {
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
			Math.abs(button.height - XL_BUTTON.height) <= 1,
			`"${button.label}" must read on one line at the XL tier's ${XL_BUTTON.height}px — a wrapped label grows the button to ${button.height}px`,
		);
		assert.ok(
			Math.abs(button.top - buttons[0].top) <= 1,
			`"${button.label}" must share the row, not wrap below it`,
		);
		assert.ok(
			Math.abs(button.height - buttons[0].height) <= 1,
			`"${button.label}" must match the row's ${buttons[0].height}px button height, measured ${button.height}px`,
		);
	}

	assert.ok(
		Math.abs(row.height - barHeight) <= 1,
		`the sticky CTA bar must stay a single ${XL_BUTTON.height}px row plus its padding and top edge, ${barHeight}px, measured ${row.height}px`,
	);

	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	assert.equal(scrollWidth, viewport.width, `the CTA row must not widen the page, got ${scrollWidth}`);
}

async function phoneGeometry(page: Page): Promise<void> {
	await everyLabelOnOneLine(page, PHONE_BAR_HEIGHT);
	const [paste, save] = await page.evaluate(measureBoxes, [PASTE, SAVE]);
	assert.ok(
		Math.abs(paste.width - save.width) <= 1,
		`paste and save must share the row equally, measured ${paste.width}px and ${save.width}px`,
	);
	const shortLabels = await page
		.locator(CTA_SHORT_LABEL)
		.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
	assert.equal(shortLabels.length, 2, "each bar button must carry a short label");
	for (const width of shortLabels) {
		assert.ok(width > 1, "the short label is the visible text on a phone");
	}
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

async function ctaSharesTheColumn(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the shared-column check must run with an explicit viewport");
	const [column, content] = await page.evaluate(measureBoxes, [COLUMN, CTA_CONTENT]);
	const edges = [
		{ edge: "centre", column: column.x + column.width / 2, cta: content.x + content.width / 2 },
		{ edge: "left edge", column: column.x, cta: content.x },
		{ edge: "right edge", column: column.x + column.width, cta: content.x + content.width },
	];
	for (const { edge, column: expected, cta } of edges) {
		assert.ok(
			Math.abs(cta - expected) <= 1,
			`at ${viewport.width}px the CTA bar's ${edge} must line up with the card column's, column ${expected} against CTA ${cta}`,
		);
	}
}

async function barLiftsOffThePage(page: Page, shadow: string): Promise<void> {
	const drawn = await page.locator(CTA).evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			edges: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
			shadow: style.boxShadow,
		};
	});
	assert.deepEqual(drawn.edges, ["1px", "0px", "0px", "0px"], "the bar draws a 1px top edge and no other border");
	assert.equal(drawn.shadow, shadow, "the bar must lift off the page on its upward shadow");
}

async function pairCentredOnThePage(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the centring check must run with an explicit viewport");
	const [paste, save] = await page.evaluate(measureBoxes, [PASTE, SAVE]);
	for (const [name, button] of [["paste", paste], ["save", save]] as const) {
		assert.ok(
			Math.abs(button.width - XL_BUTTON.width) <= 1 && Math.abs(button.height - XL_BUTTON.height) <= 1,
			`${name} must be ${XL_BUTTON.width} by ${XL_BUTTON.height}, measured ${button.width} by ${button.height}`,
		);
	}
	const gap = save.x - (paste.x + paste.width);
	assert.ok(Math.abs(gap - XL_BUTTON.gap) <= 1, `save must trail paste by ${XL_BUTTON.gap}px, measured ${gap}px`);
	const leftGap = paste.x;
	const rightGap = viewport.width - (save.x + save.width);
	assert.ok(
		Math.abs(leftGap - rightGap) <= 1,
		`the pair must centre on the page at ${viewport.width}px, ${leftGap}px on the left against ${rightGap}px on the right`,
	);
}

async function pairSpans(page: Page, span: { left: number; right: number }): Promise<void> {
	const [paste, save] = await page.evaluate(measureBoxes, [PASTE, SAVE]);
	const measured = { left: paste.x, right: save.x + save.width };
	assert.ok(
		Math.abs(measured.left - span.left) <= 1 && Math.abs(measured.right - span.right) <= 1,
		`the pair must span ${span.left} to ${span.right}, measured ${measured.left} to ${measured.right}`,
	);
}

async function downloadEndsTheColumn(page: Page): Promise<void> {
	const [column, download] = await page.evaluate(measureBoxes, [COLUMN, EPUB_DOWNLOAD]);
	const columnRight = column.x + column.width;
	const downloadRight = download.x + download.width;
	assert.ok(
		Math.abs(downloadRight - columnRight) <= 1,
		`a guest's Download must end the toolbar at the column's right edge, column ${columnRight} against Download ${downloadRight}`,
	);
}

function desktopGeometry(theme: keyof typeof BAR_SHADOW): (page: Page) => Promise<void> {
	return async (page) => {
		await everyLabelOnOneLine(page, DESKTOP_BAR_HEIGHT);
		await ctaSharesTheColumn(page);
		await barLiftsOffThePage(page, BAR_SHADOW[theme]);
		await pairCentredOnThePage(page);
		const shown = await page
			.locator(CTA_LABEL)
			.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
		for (const width of shown) {
			assert.ok(width > 1, "the full label is the visible text above the breakpoint");
		}
	};
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
	test.use({ timezoneId: "UTC", viewport: PHONE, userAgent: MACOS_CHROME_USER_AGENT });

	test("paste and save share one row without squeezing it to three lines", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, { stamp: `phone-${testInfo.workerIndex}-${Date.now()}`, query: "" });
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
		await expect(page.locator("#reader-downloads-slot")).toBeHidden();
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
	test.use({ timezoneId: "UTC", viewport: DESKTOP, userAgent: MACOS_CHROME_USER_AGENT });

	test("keeps the full labels, with the bar's edges on the card column's on a page whose rail shows no card", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, {
			stamp: `desktop-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
		});
		await captureCheckpoint(page, checkpoint("view-cta-desktop", desktopGeometry("light")));
		await downloadEndsTheColumn(page);

		for (const width of DESKTOP_WIDTHS) {
			await page.setViewportSize({ width, height: DESKTOP.height });
			await ctaSharesTheColumn(page);
		}
		await page.setViewportSize({ width: WIDE_PAIR.width, height: DESKTOP.height });
		await pairSpans(page, WIDE_PAIR);
	});

	test("lays the bar on the dark card under its deeper halo", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openPublicView(page, {
			stamp: `desktop-dark-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
		});
		await captureCheckpoint(page, checkpoint("view-cta-desktop-dark", desktopGeometry("dark")));
	});

	test("reaches paste then save by keyboard after the toolbar, each ringed inside the bar", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, {
			stamp: `keyboard-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
		});
		await page.locator(EPUB_DOWNLOAD).focus();
		const ringed: { id: string; style: string; width: string; inside: boolean }[] = [];
		for (let press = 0; press < MAX_TABS_TO_THE_BAR && ringed.length < 2; press += 1) {
			await page.keyboard.press("Tab");
			const focused = await page.evaluate((bar) => {
				const element = document.activeElement;
				const frame = element?.closest(bar);
				if (!element || !frame) return null;
				const style = getComputedStyle(element);
				const reach = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
				const box = element.getBoundingClientRect();
				const edge = frame.getBoundingClientRect();
				return {
					id: element.id,
					style: style.outlineStyle,
					width: style.outlineWidth,
					inside:
						box.top - reach >= edge.top &&
						box.bottom + reach <= edge.bottom &&
						box.left - reach >= edge.left &&
						box.right + reach <= edge.right,
				};
			}, CTA);
			if (focused) ringed.push(focused);
		}
		assert.deepEqual(
			ringed.map((focus) => focus.id),
			["view-cta-paste-another-link", "view-cta-save"],
			"Tab must leave the toolbar and reach paste, then save",
		);
		for (const focus of ringed) {
			assert.deepEqual(
				[focus.style, focus.width, focus.inside],
				["solid", "2px", true],
				`${focus.id} must wear the 2px focus ring inside the bar`,
			);
		}
	});
});
