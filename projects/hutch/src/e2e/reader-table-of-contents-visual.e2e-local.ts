import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	snapToWholePixels,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { measureBoxes } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SUMMARY = {
	summary: "A fixed summary, so no summary poll is live while the card is captured.",
	excerpt: "A fixed summary.",
};
const CONTRAST_SENSITIVE = {
	stylePath: join(__dirname, "eink-greyscale.css"),
	threshold: 0.02,
} as const;

const RAIL = "[data-test-reader-rail]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const CARD = "[data-test-toc-card]";
const HEADER = `${CARD} > summary`;
const ROW = `${CARD} [data-test-toc-section]`;
const CURRENT_ROW = `${ROW}[aria-current="location"]`;
const EMPTY_BODY = `${CARD} [data-test-toc-empty]`;

const RAIL_TRACK = 340;
const CARD_EDGE = 1;
const HEADER_HEIGHT = 64;
const DIVIDER = 1;
const ROW_HEIGHT = 49;
const EMPTY_BODY_HEIGHT = 240;

const PARAGRAPH =
	"<p>Seeded body for the table of contents visual regression test, long enough that each section reads as a section.</p>";
const HEADINGS = [
	"<h2>The Best Blog Examples Of 2026</h2>",
	"<h3>Types of blogs</h3>",
	"<h3>Platforms They Use</h3>",
	"<h3>Design &amp; User Experience</h3>",
	"<h2>Blog Examples by Type</h2>",
	"<h3>Personal Blog Examples</h3>",
	"<h3>Business &amp; Company Blogs</h3>",
	"<h3>Ecommerce Blog Examples</h3>",
];
const SECTIONED_ARTICLE = HEADINGS.map((heading) => `${heading}${PARAGRAPH}`).join("");
const LISTED_ROWS = HEADINGS.length - 1;
const NESTED_ROWS = 3;

async function openPublicView(page: Page, input: { slug: string; content: string }): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/${input.slug}`,
			title: "The Best Blog Examples Of 2026",
			content: input.content,
			contentFetchedAt: CONTENT_FETCHED_AT,
			generatedSummary: SUMMARY,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	await page.goto(`${BASE_URL}/view/example.com/${input.slug}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-view");
	await page.waitForSelector(READY_SLOT);
	await waitForBrandFonts(page, ["Inter"]);
}

async function listedSettled(page: Page): Promise<void> {
	await expect(page.locator(ROW)).toHaveCount(LISTED_ROWS);
	await expect(page.locator(CURRENT_ROW)).toHaveCount(1);
	await expect(page.locator(ROW).first()).toHaveAttribute("aria-current", "location");
}

async function emptySettled(page: Page): Promise<void> {
	await expect(page.locator(EMPTY_BODY)).toHaveCount(1);
}

async function cardOpensTheRail(page: Page): Promise<{ height: number }> {
	const [rail, card, header] = await page.evaluate(measureBoxes, [RAIL, CARD, HEADER]);
	assert.deepEqual(
		{ x: card.x, y: card.y, width: card.width },
		{ x: rail.x, y: rail.y, width: RAIL_TRACK },
		"the card opens the 340px rail",
	);
	assert.equal(header.height, HEADER_HEIGHT, "the card's header is 64px tall");
	return card;
}

async function listedGeometry(page: Page): Promise<void> {
	const card = await cardOpensTheRail(page);
	const rows = await page.locator(ROW).evaluateAll((links) =>
		links.map((link) => ({ height: link.getBoundingClientRect().height, paddingLeft: getComputedStyle(link).paddingLeft })),
	);
	assert.deepEqual(
		rows,
		Array.from({ length: LISTED_ROWS }, (_, index) => ({
			height: ROW_HEIGHT,
			paddingLeft: index >= LISTED_ROWS - NESTED_ROWS ? "32px" : "16px",
		})),
		"every row is 49px tall, and the h3 rows under the last h2 indent 16px further",
	);
	assert.equal(
		card.height,
		2 * CARD_EDGE + HEADER_HEIGHT + DIVIDER + LISTED_ROWS * ROW_HEIGHT,
		"the card is its header, its divider and its rows inside the 1px border",
	);
}

async function emptyGeometry(page: Page): Promise<void> {
	const card = await cardOpensTheRail(page);
	assert.equal(
		card.height,
		2 * CARD_EDGE + HEADER_HEIGHT + DIVIDER + EMPTY_BODY_HEIGHT,
		"the empty card is its header, its divider and a 240px body inside the 1px border",
	);
}

function cardCheckpoint(input: {
	name: string;
	settled: (page: Page) => Promise<void>;
	geometry: (page: Page) => Promise<void>;
}): VisualCheckpoint {
	return { ...input, target: CARD, capture: "element", pinnedText: [] };
}

test.describe("Table of contents card visual regression", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	for (const theme of ["light", "dark"] as const) {
		test(`the listed card leaves out the title, nests h3 rows under their h2 and marks its first row as the current section (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			await openPublicView(page, {
				slug: `reader-toc-listed-${theme}-${testInfo.workerIndex}-${Date.now()}`,
				content: SECTIONED_ARTICLE,
			});
			await captureCheckpoint(
				page,
				cardCheckpoint({ name: `reader-toc-listed-desktop-${theme}`, settled: listedSettled, geometry: listedGeometry }),
			);
		});

		test(`the empty card says the article has no section links (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			await openPublicView(page, {
				slug: `reader-toc-empty-${theme}-${testInfo.workerIndex}-${Date.now()}`,
				content: PARAGRAPH,
			});
			await captureCheckpoint(
				page,
				cardCheckpoint({ name: `reader-toc-empty-desktop-${theme}`, settled: emptySettled, geometry: emptyGeometry }),
			);
		});
	}

	test("the listed card keeps its current row apart from the others in e-ink greyscale", async ({ page }, testInfo) => {
		await openPublicView(page, {
			slug: `reader-toc-eink-${testInfo.workerIndex}-${Date.now()}`,
			content: SECTIONED_ARTICLE,
		});
		await listedSettled(page);
		await listedGeometry(page);
		await snapToWholePixels(page, CARD);
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			await expect(page.locator(CARD)).toHaveScreenshot(`reader-toc-listed-eink-${theme}.png`, CONTRAST_SENSITIVE);
		}
	});
});
