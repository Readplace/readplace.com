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
import { measureBoxes, neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";
import { htmxIsLive, readScrollY } from "./readlist-reader-skeleton.browser";
import { maxScrollY, recordScrollAfterSwap } from "./readlist-scroll-stability.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const ARTICLE_TITLE = "Why Reading Columns Stop Growing Before the Screen Does";
const SUMMARY = {
	summary:
		"Reading columns stop growing at a comfortable measure, and the spare width goes to a rail of tools beside the article card.",
	excerpt: "Reading columns stop growing at a comfortable measure.",
};
const NOT_FOUND_REASON = JSON.stringify({ kind: "not-found", httpStatus: 404 });

const LAYOUT = ".reading-layout";
const MAIN = ".reading-layout__main";
const RAIL = "[data-test-reader-rail]";
const TOOLBAR = ".article-body__toolbar";
const CARD = "[data-test-article-card]";
const HEADER = "#article-header";
const TITLE = "[data-test-reader-title]";
const CONTENT = "[data-test-reader-content]";
const READER_SLOT = "#article-body-reader-slot";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const PENDING_SLOT = '[data-test-reader-slot][data-reader-status="pending"]';
const NOT_FOUND_MARKER = '[data-test-reader-slot][data-reader-status="not-found"]';
const VISIBLE_NOTICE = ".article-body__reader-notice--visible";
const NOT_FOUND_NOTICE = `${VISIBLE_NOTICE}[data-test-reader-notice][data-reader-status="not-found"]`;
const SUMMARY_READY = '[data-test-reader-summary][data-summary-status="ready"]';
const TOP = "[data-test-reader-top]";
const FLOAT_STACK = "[data-test-reader-float-stack]";
const SCROLL_STAMP = "data-test-scroll-after-swap";

const DESKTOP_MAIN_TRACK = 812;
const RAIL_TRACK = 340;
const SINGLE_COLUMN_BOTTOM_PADDING = 64;
const TOP_INSET = 32;
const FLOAT_STACK_INSET = 24;

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

const SHORT_ARTICLE = [
	"<p>A reading column is a promise about line length. Past a certain width the eye loses its place on the way back to the left edge, so the column stops growing long before the screen does.</p>",
	"<h2>The column keeps its measure</h2>",
	"<p>On a wide display the article card holds its width and the spare room goes to a rail beside it, where the page keeps its tools instead of stretching the text.</p>",
	"<h3>The rail answers to the toolbar</h3>",
	"<p>Both tracks start on the same line, so the first thing in the rail lines up with the toolbar above the card rather than floating at an arbitrary height.</p>",
	"<p>Below the breakpoint the rail steps aside and the card takes a single centred column, with the same padding rhythm inside it.</p>",
].join("");

const LONG_PARAGRAPH =
	"<p>Every paragraph of this seeded article repeats the same reading-surface sentence so the page runs several viewports tall. The reader keeps its card and its rail in place while the page scrolls underneath the fold.</p>";
const LONG_ARTICLE = Array.from({ length: 30 }, () => LONG_PARAGRAPH).join("");

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

interface SeededReader {
	email: string;
	articleId: string;
	url: string;
}

async function quietReader(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("readplace.share-dismissed", "1");
		window.localStorage.setItem("readplace.extension-suggestion-dismissed", "1");
	});
}

async function seedOwnerArticle(page: Page, input: { stamp: string; content: string }): Promise<SeededReader> {
	const email = `reader-layout-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const url = `https://example.com/reader-layout-${input.stamp}`;
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url,
			title: ARTICLE_TITLE,
			content: input.content,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			generatedSummary: SUMMARY,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());
	return { email, articleId, url };
}

async function seedCrawlStatus(
	page: Page,
	input: { url: string; status: "pending" } | { url: string; status: "failed"; reason: string },
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawl-status`, { data: input });
	assert.equal(response.status(), 201, `the crawl-status seed must move the crawl to ${input.status}`);
}

async function openReader(page: Page, input: { reader: SeededReader; query: string }): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(input.reader.email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");

	await page.goto(`${BASE_URL}/queue/${input.reader.articleId}/view${input.query}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
}

async function openSettledReader(page: Page, input: { stamp: string; content: string; query: string }): Promise<void> {
	const reader = await seedOwnerArticle(page, input);
	await openReader(page, { reader, query: input.query });
	await page.waitForSelector(READY_SLOT);
	await expect(page.locator(SUMMARY_READY)).toHaveCount(1);
	await waitForBrandFonts(page, ["Inter"]);
}

function assertNear(measured: { actual: number; expected: number; tolerance: number }, message: string): void {
	assert.ok(
		Math.abs(measured.actual - measured.expected) <= measured.tolerance,
		`${message}: expected ${measured.expected} ± ${measured.tolerance}, measured ${measured.actual}`,
	);
}

async function railDisplay(page: Page): Promise<string> {
	return page.locator(RAIL).evaluate((rail) => getComputedStyle(rail).display);
}

async function expectLayoutFitsViewport(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "a page-from-top capture needs an explicit viewport");
	const layout = await measuredBox(page, LAYOUT);
	assert.ok(
		layout.y + layout.height <= viewport.height,
		`the seeded page must fit the ${viewport.height}px viewport to be captured from the top, measured ${layout.y + layout.height}`,
	);
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the reader must not scroll sideways");
}

async function expectArticleTypography(page: Page): Promise<void> {
	const sizes = await page.locator(CONTENT).evaluate((content) =>
		["h2", "h3", "p"].map((tag) => {
			const element = content.querySelector(tag);
			if (!element) throw new Error(`the seeded article must render a <${tag}>`);
			return getComputedStyle(element).fontSize;
		}),
	);
	assert.deepEqual(sizes, ["20px", "18px", "16px"], "h2, h3 and body text follow the article scale");
	const title = await page.locator(TITLE).evaluate((element) => {
		const style = getComputedStyle(element);
		return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
	});
	assert.ok(title.family.startsWith("Inter"), `the article title is set in Inter, measured ${title.family}`);
	assert.deepEqual(
		{ size: title.size, weight: title.weight },
		{ size: "24px", weight: "700" },
		"the article title is 24px bold",
	);
}

async function desktopGeometry(page: Page): Promise<void> {
	await expectLayoutFitsViewport(page);
	const [main, rail, toolbar, card, header, body] = await page.evaluate(measureBoxes, [
		MAIN,
		RAIL,
		TOOLBAR,
		CARD,
		HEADER,
		READY_SLOT,
	]);
	assertNear({ actual: main.width, expected: DESKTOP_MAIN_TRACK, tolerance: 1 }, "the main track is the design's 812px column");
	assertNear({ actual: rail.width, expected: RAIL_TRACK, tolerance: 0.5 }, "the rail is 340px");
	assertNear({ actual: rail.x - (main.x + main.width), expected: 48, tolerance: 0.5 }, "the tracks sit a 48px column gap apart");
	assertNear({ actual: header.x - card.x, expected: 33, tolerance: 0.5 }, "the card pads its content 32px inside its 1px edge");
	assertNear({ actual: card.y, expected: toolbar.y + toolbar.height + 32, tolerance: 0.5 }, "the card starts 32px under the toolbar row");
	assertNear({ actual: rail.y, expected: toolbar.y, tolerance: 0.5 }, "the rail starts on the toolbar's line");
	assertNear({ actual: body.x, expected: card.x + 1, tolerance: 0.5 }, "the divider starts at the card's inner left edge");
	assertNear({ actual: body.width, expected: card.width - 2, tolerance: 0.5 }, "the divider spans the card's inner width");
	await expectArticleTypography(page);
}

async function phoneGeometry(page: Page): Promise<void> {
	await expectLayoutFitsViewport(page);
	const viewport = page.viewportSize();
	assert.ok(viewport, "the phone checkpoint must run with an explicit viewport");
	const [layout, main, card, header] = await page.evaluate(measureBoxes, [LAYOUT, MAIN, CARD, HEADER]);
	assertNear({ actual: main.x, expected: 20, tolerance: 0.5 }, "the column starts at the phone gutter");
	assertNear({ actual: main.width, expected: viewport.width - 40, tolerance: 0.5 }, "the column fills the phone between its gutters");
	assertNear({ actual: header.x - card.x, expected: 21, tolerance: 0.5 }, "the card pads its content 20px inside its 1px edge on a phone");
	assert.equal(await railDisplay(page), "none", "a phone hides the rail that holds only the Top link");
	assertNear(
		{ actual: layout.y + layout.height - SINGLE_COLUMN_BOTTOM_PADDING, expected: main.y + main.height, tolerance: 0.5 },
		"the page's bottom padding starts at the column's end, with no row gap left by a hidden rail",
	);
}

async function layoutSettled(page: Page): Promise<void> {
	await page.waitForSelector(READY_SLOT);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

function layoutCheckpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return {
		name,
		settled: layoutSettled,
		geometry,
		target: LAYOUT,
		capture: "page-from-top",
		pinnedText: [],
	};
}

async function expectTracks(page: Page, track: { width: number; main: number; gap: number }): Promise<void> {
	await page.setViewportSize({ width: track.width, height: 900 });
	const [main, rail] = await page.evaluate(measureBoxes, [MAIN, RAIL]);
	assertNear({ actual: main.width, expected: track.main, tolerance: 1 }, `at ${track.width}px the main track narrows`);
	assertNear({ actual: rail.width, expected: RAIL_TRACK, tolerance: 0.5 }, `at ${track.width}px the rail keeps 340px`);
	assertNear(
		{ actual: rail.x - (main.x + main.width), expected: track.gap, tolerance: 0.5 },
		`at ${track.width}px the tracks sit the column gap apart`,
	);
}

async function expectSingleColumn(page: Page, width: number): Promise<void> {
	await page.setViewportSize({ width, height: 900 });
	const [layout, main] = await page.evaluate(measureBoxes, [LAYOUT, MAIN]);
	assert.ok(main.width <= DESKTOP_MAIN_TRACK, `at ${width}px the one column stays within 812px, measured ${main.width}`);
	assertNear(
		{ actual: main.x - layout.x, expected: layout.x + layout.width - (main.x + main.width), tolerance: 0.5 },
		`at ${width}px the one column is centred in the frame`,
	);
	assert.equal(await railDisplay(page), "none", `at ${width}px the Top-only rail takes no row`);
	assertNear(
		{ actual: layout.y + layout.height - SINGLE_COLUMN_BOTTOM_PADDING, expected: main.y + main.height, tolerance: 0.5 },
		`at ${width}px the page's bottom padding starts at the column's end`,
	);
	assert.equal(await page.evaluate(pageOverflowsSideways), false, `at ${width}px the reader must not scroll sideways`);
}

async function scrollToY(page: Page, top: number): Promise<void> {
	await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), top);
	await expect.poll(() => page.evaluate(readScrollY)).toBe(top);
}

async function expectStripSpansSheet(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the chromeless checks must run with an explicit viewport");
	const [toolbar, main] = await page.evaluate(measureBoxes, [TOOLBAR, MAIN]);
	assertNear({ actual: toolbar.y, expected: 0, tolerance: 0.5 }, "the chromeless toolbar pins to the top of the sheet");
	assert.ok(
		main.x > 0 && main.x + main.width < viewport.width,
		"the fixture needs a capped column, so a strip clipped to the column would not reach the sheet's edges",
	);
	const edgesHitTheStrip = await page.locator(TOOLBAR).evaluate((bar, xs) => {
		const box = bar.getBoundingClientRect();
		return xs.map((x) => bar.contains(document.elementFromPoint(x, box.top + box.height / 2)));
	}, [1, viewport.width - 2]);
	assert.deepEqual(edgesHitTheStrip, [true, true], "the toolbar's strip spans the sheet from edge to edge");
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the full-bleed strip must not scroll the sheet sideways");
}

test.describe("Reader layout at 1440", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1440, height: 2200 } });

	for (const scheme of ["light", "dark"] as const) {
		test(`the article card and the rail share the frame (${scheme})`, async ({ page }, testInfo) => {
			await quietReader(page);
			await page.emulateMedia({ colorScheme: scheme });
			await openSettledReader(page, {
				stamp: `desktop-${scheme}-${testInfo.workerIndex}-${Date.now()}`,
				content: SHORT_ARTICLE,
				query: "",
			});
			await captureCheckpoint(page, layoutCheckpoint(`reader-layout-desktop-${scheme}`, desktopGeometry));
		});
	}
});

test.describe("Reader layout below the design width", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1440, height: 900 } });

	test("the tracks narrow to 1024 and fold into one centred column below it", async ({ page }, testInfo) => {
		await quietReader(page);
		await openSettledReader(page, {
			stamp: `widths-${testInfo.workerIndex}-${Date.now()}`,
			content: SHORT_ARTICLE,
			query: "",
		});
		await expectTracks(page, { width: 1200, main: 716, gap: 48 });
		await expectTracks(page, { width: 1024, main: 612, gap: 24 });
		await expectSingleColumn(page, 1023);
		await expectSingleColumn(page, 768);
	});
});

test.describe("Chromeless reader beside a capped column", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 900, height: 1200 } });

	test("the pinned toolbar's strip spans the whole sheet", async ({ page }, testInfo) => {
		await quietReader(page);
		await openSettledReader(page, {
			stamp: `chromeless-${testInfo.workerIndex}-${Date.now()}`,
			content: LONG_ARTICLE,
			query: "?shell=app",
		});
		await page.waitForSelector("body.page-reader--chromeless");
		await scrollToY(page, 600);
		await expectStripSpansSheet(page);
	});
});

test.describe("Reader layout on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 390, height: 1800 } });

	test("one column, the card padded 20px, and no rail", async ({ page }, testInfo) => {
		await quietReader(page);
		await page.emulateMedia({ colorScheme: "light" });
		await openSettledReader(page, {
			stamp: `phone-${testInfo.workerIndex}-${Date.now()}`,
			content: SHORT_ARTICLE,
			query: "",
		});
		await captureCheckpoint(page, layoutCheckpoint("reader-layout-phone-light", phoneGeometry));
	});
});

test.describe("The reader's Top button", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1440, height: 900 } });

	test("appears past one viewport, rides above the fold, rests above the column's end and returns to the top", async ({
		page,
	}, testInfo) => {
		await quietReader(page);
		await openSettledReader(page, {
			stamp: `top-${testInfo.workerIndex}-${Date.now()}`,
			content: LONG_ARTICLE,
			query: "",
		});
		const viewport = page.viewportSize();
		assert.ok(viewport, "the Top checks must run with an explicit viewport");
		await expect(page.locator(TOP)).toHaveCSS("visibility", "hidden");

		await scrollToY(page, viewport.height + 200);
		await expect(page.locator(TOP)).toHaveCSS("visibility", "visible");
		const [top, icon, stack, card] = await page.evaluate(measureBoxes, [TOP, `${TOP} svg`, FLOAT_STACK, CARD]);
		assertNear({ actual: top.y + top.height, expected: viewport.height - TOP_INSET, tolerance: 1 }, "Top rides 32px above the fold");
		assert.deepEqual({ width: icon.width, height: icon.height }, { width: 24, height: 24 }, "Top's arrow is 24px");
		assert.ok(card.y + card.height > viewport.height, "the fixture must leave the card's end below the fold");
		assertNear(
			{ actual: stack.y + stack.height, expected: viewport.height - FLOAT_STACK_INSET, tolerance: 1 },
			"the float stack still sticks 24px above the fold inside the main track",
		);

		await scrollToY(page, await page.evaluate(maxScrollY));
		const [restingTop, main] = await page.evaluate(measureBoxes, [TOP, MAIN]);
		assertNear(
			{ actual: restingTop.y + restingTop.height, expected: main.y + main.height - TOP_INSET, tolerance: 1 },
			"at the page's end Top rests 32px above the main track's end",
		);

		await page.locator(TOP).click();
		await expect.poll(() => page.evaluate(readScrollY)).toBe(0);
		await expect(page.locator(TOP)).toHaveCSS("visibility", "hidden");
	});
});

async function awaitScrollStamp(page: Page): Promise<void> {
	await page.waitForFunction((stamp) => document.documentElement.hasAttribute(stamp), SCROLL_STAMP);
}

async function noticeSettled(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 1200 });
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function noticeGeometry(page: Page): Promise<void> {
	const [card, notice] = await page.evaluate(measureBoxes, [CARD, NOT_FOUND_NOTICE]);
	assertNear(
		{ actual: notice.y, expected: card.y + card.height + 16, tolerance: 0.5 },
		"the notice card sits 16px under the article card",
	);
	const noticeFollowsCard = await page
		.locator(NOT_FOUND_NOTICE)
		.evaluate((element, cardSelector) => element.previousElementSibling?.matches(cardSelector) === true, CARD);
	assert.equal(noticeFollowsCard, true, "the notice is the card's next sibling, outside it");
}

const PENDING_TO_FAILED: VisualCheckpoint = {
	name: "reader-pending-to-failed-desktop-light",
	settled: noticeSettled,
	geometry: noticeGeometry,
	target: MAIN,
	capture: "element",
	pinnedText: [],
};

test.describe("A reader whose crawl fails while it is open", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1440, height: 360 } });

	test("the notice lands as its own card under the article and the page holds still", async ({ page }, testInfo) => {
		await quietReader(page);
		await page.emulateMedia({ colorScheme: "light" });
		const reader = await seedOwnerArticle(page, {
			stamp: `pending-to-failed-${testInfo.workerIndex}-${Date.now()}`,
			content: SHORT_ARTICLE,
		});
		await seedCrawlStatus(page, { url: reader.url, status: "pending" });
		await openReader(page, { reader, query: "" });
		await page.waitForSelector(PENDING_SLOT);
		await expect.poll(() => page.evaluate(htmxIsLive)).toBe(true);
		await waitForBrandFonts(page, ["Inter"]);
		const pendingInCard = await page
			.locator(PENDING_SLOT)
			.evaluate((slot, cardSelector) => slot.parentElement?.matches(cardSelector) === true, CARD);
		assert.equal(pendingInCard, true, "the pending panel sits inside the article card");

		const title = await measuredBox(page, TITLE);
		await scrollToY(page, Math.round(title.y + 4));
		const before = await page.evaluate(readScrollY);
		expect(before).toBeGreaterThan(0);
		expect(before).toBeLessThan(await page.evaluate(maxScrollY));

		await page.evaluate(recordScrollAfterSwap, READER_SLOT);
		await awaitScrollStamp(page);
		await expect(page.locator(PENDING_SLOT)).toHaveCount(1);
		await page.evaluate((stamp) => document.documentElement.removeAttribute(stamp), SCROLL_STAMP);
		await seedCrawlStatus(page, { url: reader.url, status: "failed", reason: NOT_FOUND_REASON });
		await page.evaluate(recordScrollAfterSwap, READER_SLOT);
		await awaitScrollStamp(page);

		await expect(page.locator(VISIBLE_NOTICE)).toHaveCount(1);
		await expect(page.locator(NOT_FOUND_NOTICE)).toHaveCount(1);
		await expect(page.locator('[data-reader-status="pending"]')).toHaveCount(0);
		await expect(page.locator(NOT_FOUND_MARKER)).toHaveCount(1);
		await expect(page.locator(NOT_FOUND_MARKER)).toHaveCSS("display", "none");
		await expect(page.locator("html")).toHaveAttribute(SCROLL_STAMP, String(before));

		await captureCheckpoint(page, PENDING_TO_FAILED);
	});
});
