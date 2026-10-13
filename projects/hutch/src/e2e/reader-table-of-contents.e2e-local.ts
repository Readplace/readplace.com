import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, measuredBox, test, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./admin-extend-trial/admin-e2e-user";
import { openAddLink } from "./page-interactions";
import { measureBoxes } from "./page-measurements.browser";
import { htmxIsLive, readScrollY } from "./readlist-reader-skeleton.browser";
import { maxScrollY, recordScrollAfterSwap } from "./readlist-scroll-stability.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SUMMARY = {
	summary: "A fixed summary, so no summary poll is live while the card is measured.",
	excerpt: "A fixed summary.",
};
const DESKTOP = { width: 1280, height: 900 };

const LISTED = '[data-test-table-of-contents="listed"]';
const EMPTY = '[data-test-table-of-contents="empty"]';
const HIDDEN = '[data-test-table-of-contents="hidden"]';
const CARD = "[data-test-toc-card]";
const HEADER = `${CARD} > summary`;
const ROW = `${CARD} [data-test-toc-section]`;
const CURRENT_ROW = `${ROW}[aria-current="location"]`;
const EMPTY_BODY = `${CARD} [data-test-toc-empty]`;
const RAIL = "[data-test-reader-rail]";
const ADMIN_RAIL = ".admin-recrawl__rail";
const ARTICLE_HISTORY = "[data-test-article-history]";
const TOOLBAR = ".article-body__toolbar";
const TITLE = "[data-test-reader-title]";
const CONTENT = "[data-test-reader-content]";
const READER_SLOT = "#article-body-reader-slot";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const PENDING_SLOT = '[data-test-reader-slot][data-reader-status="pending"]';
const EXIT_CONFIRM = "#reader-exit-confirm";
const SAVED_CARD = "[data-test-article]";
const SAVED_CARD_TITLE = "[data-test-article-title]";
const SCROLL_STAMP = "data-test-scroll-after-swap";

const RAIL_TRACK = 340;
const HEADER_HEIGHT = 64;
const DIVIDER = 1;
const ROW_HEIGHT = 49;
const ROW_LINE = 21;
const EMPTY_BODY_MINIMUM = 240;
const SWITCHED_ROW = 2;
const DUPLICATE_ROW = 3;
const LONG_ROW = 4;

const PARAGRAPH =
	"<p>Every paragraph of this seeded article repeats one sentence about finding your place in a long read, so each section runs taller than the viewport and any of its headings can be brought to the top of the page.</p>";
const SECTION_BODY = Array.from({ length: 6 }, () => PARAGRAPH).join("");
const HEADINGS = [
	{ level: "h2", text: "Why a long read needs a map" },
	{ level: "h3", text: "Reading in order" },
	{ level: "h3", text: "Skipping to the part you came for" },
	{ level: "h3", text: "Reading in order" },
	{ level: "h3", text: "Coming back to a section days later, once the rest of the article has faded" },
] as const;
const SECTIONED_ARTICLE = HEADINGS.map(
	(heading) => `<${heading.level}>${heading.text}</${heading.level}>${SECTION_BODY}`,
).join("");
const UNSECTIONED_ARTICLE = SECTION_BODY;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

interface SeededReader {
	email: string;
	articleId: string;
	url: string;
}

interface RowTarget {
	anchorId: string | null;
	rowText: string;
	headingTag: string | null;
	headingText: string | null;
}

async function createReader(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await created.json()).userId;
}

async function signIn(page: Page, input: { email: string; password: string }): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(input.email);
	await page.locator("#password").fill(input.password);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function seedOwnerArticle(page: Page, input: { stamp: string; content: string }): Promise<SeededReader> {
	const email = `reader-toc-${input.stamp}@example.com`;
	const userId = await createReader(page, email);
	const url = `https://example.com/reader-toc-${input.stamp}`;
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url,
			title: "Finding Your Place in a Long Read",
			content: input.content,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			generatedSummary: SUMMARY,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	return { email, articleId: SeededArticle.parse(await seeded.json()).articleId, url };
}

async function seedCrawlStatus(page: Page, input: { url: string; status: "pending" | "ready" }): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawl-status`, { data: input });
	assert.equal(response.status(), 201, `the crawl-status seed must move the crawl to ${input.status}`);
}

async function openReader(page: Page, input: { reader: SeededReader; query: string }): Promise<void> {
	await signIn(page, { email: input.reader.email, password: PASSWORD });
	await page.goto(`${BASE_URL}/queue/${input.reader.articleId}/view${input.query}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
}

async function openSettledReader(page: Page, input: { stamp: string; content: string; query: string }): Promise<void> {
	const reader = await seedOwnerArticle(page, input);
	await openReader(page, { reader, query: input.query });
	await page.waitForSelector(READY_SLOT);
	await waitForBrandFonts(page, ["Inter"]);
}

async function openSectionedReader(page: Page, input: { stamp: string; query: string }): Promise<void> {
	await openSettledReader(page, { stamp: input.stamp, content: SECTIONED_ARTICLE, query: input.query });
	await expect(page.locator(CURRENT_ROW)).toHaveCount(1);
}

async function saveLoopbackPage(page: Page, input: { stamp: string; url: string }): Promise<void> {
	const email = `reader-toc-${input.stamp}@example.com`;
	await createReader(page, email);
	await page.context().addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
	await signIn(page, { email, password: PASSWORD });
	const saveForm = await openAddLink(page);
	await saveForm.locator('input[name="url"]').fill(input.url);
	await saveForm.locator('button[type="submit"]').click();
	await expect(page.locator(SAVED_CARD)).toHaveCount(1);
	const href = await page.locator(SAVED_CARD_TITLE).getAttribute("href");
	assert.ok(href, "the saved card must link into the reader");
	await page.goto(new URL(href, BASE_URL).href, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-reader");
	await page.waitForSelector(READY_SLOT);
}

async function rowTargets(page: Page): Promise<RowTarget[]> {
	return page.locator(ROW).evaluateAll(
		(rows, content) =>
			rows.map((row) => {
				const heading = document.getElementById((row.getAttribute("href") ?? "").slice(1));
				const inContent = heading !== null && heading.closest(content) !== null;
				return {
					anchorId: row.getAttribute("data-test-toc-section"),
					rowText: row.textContent ?? "",
					headingTag: inContent ? heading.tagName.toLowerCase() : null,
					headingText: inContent ? heading.textContent : null,
				};
			}),
		CONTENT,
	);
}

async function rowAnchor(page: Page, index: number): Promise<string> {
	const anchorId = await page.locator(ROW).nth(index).getAttribute("data-test-toc-section");
	assert.ok(anchorId, `row ${index + 1} names the heading it links to`);
	return anchorId;
}

async function scrollPaddingTop(page: Page): Promise<number> {
	return page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
}

async function headingTop(page: Page, anchorId: string): Promise<number> {
	return page.evaluate((id) => {
		const heading = document.getElementById(id);
		if (!heading) throw new Error(`the reader content must hold #${id}`);
		return heading.getBoundingClientRect().top;
	}, anchorId);
}

async function scrollHeadingToTheLine(page: Page, anchorId: string): Promise<void> {
	const line = await scrollPaddingTop(page);
	const target = Math.round((await page.evaluate(readScrollY)) + (await headingTop(page, anchorId)) - line);
	await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), target);
	await expect.poll(() => page.evaluate(readScrollY)).toBe(target);
}

async function expectCurrentRow(page: Page, anchorId: string): Promise<void> {
	await expect(page.locator(CURRENT_ROW)).toHaveCount(1);
	await expect(page.locator(CURRENT_ROW)).toHaveAttribute("data-test-toc-section", anchorId);
}

async function displayOf(page: Page, selector: string): Promise<string> {
	return page.locator(selector).evaluate((element) => getComputedStyle(element).display);
}

test.describe("Table of contents in the reader's rail", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("lists each h2 and h3 as a row of the rail's first card, in document order, and leaves the card out below 1024px", async ({
		page,
	}, testInfo) => {
		await openSectionedReader(page, { stamp: `listed-${testInfo.workerIndex}-${Date.now()}`, query: "" });

		const targets = await rowTargets(page);
		assert.deepEqual(
			targets.map((target) => ({ rowText: target.rowText, headingTag: target.headingTag, headingText: target.headingText })),
			HEADINGS.map((heading) => ({ rowText: heading.text, headingTag: heading.level, headingText: heading.text })),
			"each row names its heading verbatim and links to that heading inside the article",
		);
		assert.equal(
			new Set(targets.map((target) => target.anchorId)).size,
			HEADINGS.length,
			"a repeated heading still gets an anchor of its own",
		);

		const [rail, card, header] = await page.evaluate(measureBoxes, [RAIL, CARD, HEADER]);
		assert.deepEqual(
			{ x: card.x, y: card.y, width: card.width },
			{ x: rail.x, y: rail.y, width: RAIL_TRACK },
			"the card opens the 340px rail",
		);
		assert.equal(header.height, HEADER_HEIGHT, "the card's header is 64px tall");
		const rows = await page.locator(ROW).evaluateAll((links) =>
			links.map((link) => {
				const box = link.getBoundingClientRect();
				return { y: box.y, height: box.height };
			}),
		);
		const [firstRow] = rows;
		assert.ok(firstRow, "the card lists at least one row");
		assert.equal(firstRow.y - header.y, HEADER_HEIGHT + DIVIDER, "the rows start under the header and its 1px divider");
		for (const [index, row] of rows.entries()) {
			const previous = rows[index - 1];
			if (previous) assert.equal(row.y, previous.y + previous.height, `row ${index + 1} follows row ${index} with no gap`);
			if (index !== LONG_ROW) assert.equal(row.height, ROW_HEIGHT, `row ${index + 1} is 49px tall`);
		}
		const longRow = rows[LONG_ROW];
		assert.ok(longRow, "the fixture lists its long heading");
		const extraLines = (longRow.height - ROW_HEIGHT) / ROW_LINE;
		assert.ok(
			Number.isInteger(extraLines) && extraLines >= 1,
			`the long heading wraps onto whole 21px lines inside its row, measured ${longRow.height}px`,
		);

		await page.locator(HEADER).click();
		await expect(page.locator(CARD)).toHaveJSProperty("open", false);
		await expect(page.locator(ROW).first()).toBeHidden();
		await page.locator(HEADER).click();
		await expect(page.locator(CARD)).toHaveJSProperty("open", true);
		await expect(page.locator(ROW).first()).toBeVisible();

		for (const [width, display] of [
			[1024, "block"],
			[1023, "none"],
			[390, "none"],
		] as const) {
			await page.setViewportSize({ width, height: DESKTOP.height });
			await expect.poll(() => displayOf(page, LISTED), { message: `the card's display at ${width}px` }).toBe(display);
		}
	});

	test("a row brings its heading to the scroll padding without a request or an exit confirm, and the current row follows the scroll", async ({
		page,
	}, testInfo) => {
		await openSectionedReader(page, { stamp: `jump-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await expectCurrentRow(page, await rowAnchor(page, 0));

		const requested: string[] = [];
		page.on("request", (request) => {
			if (request.isNavigationRequest() || request.headers()["hx-boosted"] !== undefined) requested.push(request.url());
		});
		const switched = await rowAnchor(page, SWITCHED_ROW);
		await page.locator(ROW).nth(SWITCHED_ROW).click();
		await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${switched}`);
		const line = await scrollPaddingTop(page);
		const top = await headingTop(page, switched);
		assert.ok(Math.abs(top - line) <= 2, `the heading lands on the ${line}px scroll padding, measured ${top}px`);
		await expectCurrentRow(page, switched);
		await expect(page.locator(EXIT_CONFIRM)).toHaveCount(1);
		await expect(page.locator(EXIT_CONFIRM)).toBeHidden();
		assert.deepEqual(requested, [], "a row is an in-page jump: no navigation and no boosted request");

		const duplicate = await rowAnchor(page, DUPLICATE_ROW);
		await scrollHeadingToTheLine(page, duplicate);
		await expectCurrentRow(page, duplicate);
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
		await expectCurrentRow(page, await rowAnchor(page, 0));
	});

	test("shows the empty card at its full height when the article has no h2 or h3", async ({ page }, testInfo) => {
		await openSettledReader(page, {
			stamp: `empty-${testInfo.workerIndex}-${Date.now()}`,
			content: UNSECTIONED_ARTICLE,
			query: "",
		});
		await expect(page.locator(EMPTY)).toHaveCount(1);
		const [rail, card, header, body] = await page.evaluate(measureBoxes, [RAIL, CARD, HEADER, EMPTY_BODY]);
		assert.deepEqual({ x: card.x, width: card.width }, { x: rail.x, width: RAIL_TRACK }, "the empty card fills the rail's track");
		assert.equal(body.y - header.y, HEADER_HEIGHT, "the empty body starts under the 64px header");
		assert.ok(
			body.height - DIVIDER >= EMPTY_BODY_MINIMUM,
			`the empty body keeps at least 240px under its divider, measured ${body.height - DIVIDER}px`,
		);
	});
});

test.describe("Table of contents in the chromeless reader", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("marks the first row at the article's top and lands a jumped-to heading under the pinned toolbar", async ({
		page,
	}, testInfo) => {
		await openSectionedReader(page, { stamp: `chromeless-${testInfo.workerIndex}-${Date.now()}`, query: "?platform=ios" });
		await page.waitForSelector("body.page-reader--chromeless");
		await expectCurrentRow(page, await rowAnchor(page, 0));

		const switched = await rowAnchor(page, SWITCHED_ROW);
		await page.locator(ROW).nth(SWITCHED_ROW).click();
		await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${switched}`);
		const toolbar = await measuredBox(page, TOOLBAR);
		const top = await headingTop(page, switched);
		assert.ok(
			top >= toolbar.y + toolbar.height - 0.5,
			`the heading lands below the pinned toolbar's ${toolbar.y + toolbar.height}px edge, measured ${top}px`,
		);
		await expectCurrentRow(page, switched);
	});
});

test.describe("Table of contents while the reader view is pending", () => {
	test.use({ timezoneId: "UTC", viewport: { width: DESKTOP.width, height: 360 } });

	test("stays hidden until the crawl lands, then arrives listed without moving the page", async ({ page }, testInfo) => {
		const reader = await seedOwnerArticle(page, {
			stamp: `pending-${testInfo.workerIndex}-${Date.now()}`,
			content: SECTIONED_ARTICLE,
		});
		await seedCrawlStatus(page, { url: reader.url, status: "pending" });
		await openReader(page, { reader, query: "" });
		await page.waitForSelector(PENDING_SLOT);
		await expect(page.locator(HIDDEN)).toHaveCount(1);
		await expect.poll(() => page.evaluate(htmxIsLive)).toBe(true);
		await waitForBrandFonts(page, ["Inter"]);

		const title = await measuredBox(page, TITLE);
		const before = Math.round(title.y + 4);
		await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), before);
		await expect.poll(() => page.evaluate(readScrollY)).toBe(before);
		expect(before).toBeGreaterThan(0);
		expect(before).toBeLessThan(await page.evaluate(maxScrollY));

		await page.evaluate(recordScrollAfterSwap, READER_SLOT);
		await page.waitForFunction((stamp) => document.documentElement.hasAttribute(stamp), SCROLL_STAMP);
		await expect(page.locator(PENDING_SLOT)).toHaveCount(1);
		await page.evaluate((stamp) => document.documentElement.removeAttribute(stamp), SCROLL_STAMP);
		await seedCrawlStatus(page, { url: reader.url, status: "ready" });
		await page.evaluate(recordScrollAfterSwap, READER_SLOT);
		await page.waitForFunction((stamp) => document.documentElement.hasAttribute(stamp), SCROLL_STAMP);

		await expect(page.locator(READY_SLOT)).toHaveCount(1);
		await expect(page.locator(LISTED)).toHaveCount(1);
		await expect(page.locator(ROW)).toHaveCount(HEADINGS.length);
		await expectCurrentRow(page, await rowAnchor(page, 0));
		await expect(page.locator("html")).toHaveAttribute(SCROLL_STAMP, String(before));
	});
});

test.describe("Table of contents for an article with no version", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("names the rail from 1024px on the owner's reader and on /view, and gives the rail no row on a phone", async ({
		page,
	}, testInfo) => {
		const stamp = `no-version-${testInfo.workerIndex}-${Date.now()}`;
		await saveLoopbackPage(page, { stamp, url: `${BASE_URL}/privacy?reader-toc=${stamp}` });
		await expect(page.locator(ARTICLE_HISTORY)).toHaveCount(0);
		await expect(page.locator(LISTED)).toBeVisible();
		await expect(page.locator(`aside${RAIL}`)).toHaveAttribute("aria-label", "Article details");
		expect(await displayOf(page, RAIL)).toBe("flex");

		await page.setViewportSize({ width: 390, height: 844 });
		await expect.poll(() => displayOf(page, RAIL)).toBe("none");

		await page.setViewportSize(DESKTOP);
		await page.goto(`${BASE_URL}/view/${encodeURIComponent(`${BASE_URL}/privacy?reader-toc-view=${stamp}`)}`, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForSelector("body.page-view");
		await expect(page.locator(LISTED)).toBeVisible();
		await expect(page.locator(ARTICLE_HISTORY)).toHaveCount(0);
		expect(await displayOf(page, RAIL)).toBe("flex");
	});
});

test.describe("Table of contents in a pending admin recrawl", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("gives the recrawl's rail no column while it holds only the hidden card", async ({ page }, testInfo) => {
		const stamp = `recrawl-${testInfo.workerIndex}-${Date.now()}`;
		const articleUrl = `${BASE_URL}/privacy?reader-toc-recrawl=${stamp}`;
		await page.goto(`${BASE_URL}/view/${encodeURIComponent(articleUrl)}`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-view");
		await expect(page.locator(LISTED)).toBeVisible();
		await seedCrawlStatus(page, { url: articleUrl, status: "pending" });

		const admin = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD, verified: true },
		});
		assert.equal(admin.status(), 201, "the e2e user fixture must answer the admin create request");
		await signIn(page, { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD });
		await page.goto(`${BASE_URL}/admin/recrawl?url=${encodeURIComponent(articleUrl)}&started=1`, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForSelector(PENDING_SLOT);
		await expect(page.locator(`${ADMIN_RAIL} > ${HIDDEN}`)).toHaveCount(1);
		expect(await displayOf(page, ADMIN_RAIL)).toBe("none");
	});
});
