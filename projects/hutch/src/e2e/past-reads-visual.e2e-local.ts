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
import { z } from "zod";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const OWNER_PASSWORD = "correct-horse-battery-staple";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const COMPUTED_AT = "2026-07-10T09:20:00.000Z";
const SEEDED_PARAGRAPH =
	"<p>Reader view renders the article text in a clean, distraction-free column so the reading experience stays consistent across every site you save.</p>";

const SECTION = "[data-test-reader-topic-reads]";
const READY_SECTION = '[data-test-reader-topic-reads][data-topic-reads-status="ready"]';
const CARD = ".past-reads__card";
const TOGGLE = ".past-reads__toggle";
const PREVIEW = ".past-reads__preview";
const PREVIEW_TITLE = ".past-reads__preview-title";
const MORE = ".past-reads__more";
const ROW = ".past-reads__row";
const LINK = ".past-reads__link";
const TITLE = `${ROW} .past-reads__title`;
const REASON = ".past-reads__reason";
const SUMMARY_SLOT = "#article-body-summary-slot";
const SUMMARY_CARD = ".article-body__summary";
const SUMMARY_TOGGLE = ".article-body__summary-toggle";
const READER_SLOT = "#article-body-reader-slot";
const ROW_GAP_PX = 0;

const LONG_TITLE =
	"How the Postgres Query Planner Picks Between Sequential, Index and Bitmap Heap Scans Once Table Statistics Go Stale";

const PAST_READS = [
	{
		slug: "planner",
		host: "an-extremely-long-publication-hostname.example.com",
		title: LONG_TITLE,
		reason: "The same stale-statistics problem, traced through the planner's cost estimates.",
	},
	{
		slug: "autovacuum",
		host: "example.com",
		title: "Autovacuum Tuning for Write-Heavy Tables",
		reason:
			"Autovacuum settles the dead-tuple bloat that skews the row estimates this article blames for the sudden slowdown.",
	},
	{
		slug: "explain",
		host: "example.com",
		title: "Reading EXPLAIN ANALYZE Output",
		reason: "A walkthrough of the EXPLAIN output used here.",
	},
] as const;

const PINNED_READ_TIME = PAST_READS.map((_, index) => ({
	selector: `${SECTION} ${ROW}:nth-child(${index + 1}) [data-test-topic-read-time] time`,
	text: "just now",
}));

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await response.json()).userId;
}

async function seedArticle(
	page: Page,
	input: { url: string; title: string; userId: string; withSummary: boolean },
): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.url,
			title: input.title,
			content: Array.from({ length: 6 }, () => SEEDED_PARAGRAPH).join("\n"),
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: input.userId,
			...(input.withSummary
				? {
						generatedSummary: {
							summary:
								"A query that ran in milliseconds for months can suddenly take seconds when the planner's row estimates drift away from the real data.",
							excerpt: "Why a fast query suddenly slows down when planner statistics drift.",
						},
					}
				: {}),
		},
	});
	assert.equal(response.status(), 201, `the seed endpoint must create ${input.url}`);
	return SeededArticle.parse(await response.json()).articleId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openReader(
	page: Page,
	options: { stamp: string; seedPastReads: boolean },
): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("readplace.share-dismissed", "1");
	});

	const email = `past-reads-${options.stamp}@example.com`;
	const userId = await createOwner(page, email);
	const sourceUrl = `https://example.com/past-reads-source-${options.stamp}`;
	const articleId = await seedArticle(page, {
		url: sourceUrl,
		title: "Why Your Postgres Query Suddenly Got Slow",
		userId,
		withSummary: true,
	});

	const pastIds: string[] = [];
	for (const past of PAST_READS) {
		pastIds.push(
			await seedArticle(page, {
				url: `https://${past.host}/${past.slug}-${options.stamp}`,
				title: past.title,
				userId,
				withSummary: false,
			}),
		);
	}

	await loginAs(page, email);

	if (options.seedPastReads) {
		for (const pastId of pastIds) {
			const marked = await page.request.post(`${BASE_URL}/queue/${pastId}/status`, {
				form: { status: "read" },
			});
			assert.equal(marked.status(), 200, "marking a past read as read must be accepted");
		}
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-past-reads`, {
			data: {
				userId,
				sourceUrl,
				pastReads: PAST_READS.map((past) => ({
					url: `https://${past.host}/${past.slug}-${options.stamp}`,
					reason: past.reason,
				})),
				computedAt: COMPUTED_AT,
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must settle the past reads");
	}

	await page.goto(`${BASE_URL}/queue/${articleId}/view`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
	await waitForBrandFonts(page, ["Inter"]);
}

async function sectionSettled(page: Page): Promise<void> {
	await page.waitForSelector(READY_SECTION);
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
		document.querySelector(".trial-countdown")?.remove();
		document.querySelector("[data-test-reader-float-stack]")?.remove();
	});
}

async function sectionBetweenSummaryAndBody(page: Page): Promise<void> {
	const summary = await measuredBox(page, SUMMARY_SLOT);
	const section = await measuredBox(page, SECTION);
	const body = await measuredBox(page, READER_SLOT);
	assert.ok(
		section.y >= summary.y + summary.height - 0.5,
		"the past-reads section must start below the summary",
	);
	assert.ok(
		section.y + section.height <= body.y + 0.5,
		"the past-reads section must end above the article body",
	);
}

async function rowsCompactAndPlain(page: Page): Promise<void> {
	await sectionBetweenSummaryAndBody(page);

	const rows = page.locator(ROW);
	await expect(rows).toHaveCount(PAST_READS.length);
	const boxes = [];
	for (let index = 0; index < PAST_READS.length; index += 1) {
		const box = await rows.nth(index).boundingBox();
		assert.ok(box, "every past-read row must be laid out");
		boxes.push(box);
	}
	for (let index = 1; index < boxes.length; index += 1) {
		const previous = boxes[index - 1];
		const current = boxes[index];
		assert.ok(previous && current, "consecutive rows exist");
		const gap = current.y - (previous.y + previous.height);
		assert.ok(
			Math.abs(gap - ROW_GAP_PX) <= 0.5,
			`rows must stack flush, split only by a divider, got ${gap}px between rows ${index - 1} and ${index}`,
		);
	}

	const surfaces = await page.locator(LINK).evaluateAll((links) =>
		links.map((link) => {
			const style = window.getComputedStyle(link);
			return { background: style.backgroundColor, shadow: style.boxShadow };
		}),
	);
	for (const surface of surfaces) {
		assert.equal(surface.background, "rgba(0, 0, 0, 0)", "rows must not paint a card background");
		assert.equal(surface.shadow, "none", "rows must not cast a shadow");
	}

	const headings = await page.locator(LINK).evaluateAll((links) =>
		links.map((link) => {
			const title = link.querySelector(".past-reads__title");
			const site = link.querySelector(".past-reads__site");
			if (!title || !site) throw new Error("every past-read row renders a title and a site");
			const linkBox = link.getBoundingClientRect();
			const siteBox = site.getBoundingClientRect();
			return {
				linkRight: linkBox.right,
				titleClipped: title.scrollWidth > title.clientWidth,
				siteWidth: siteBox.width,
				siteRight: siteBox.right,
			};
		}),
	);
	for (const heading of headings) {
		assert.equal(heading.titleClipped, false, "a title must render whole rather than clip");
		assert.ok(heading.siteWidth > 0, "the site name must stay visible");
		assert.ok(
			heading.siteRight <= heading.linkRight + 0.5,
			"the site name must never overflow its row",
		);
	}

	const longTitleWrapped = await page
		.locator(TITLE)
		.first()
		.evaluate(
			(el) =>
				el.getBoundingClientRect().height > Number.parseFloat(window.getComputedStyle(el).lineHeight) * 1.5,
		);
	assert.equal(longTitleWrapped, true, "a long title must wrap rather than widen the row");
	await expect(page.locator(LINK).first()).toHaveAttribute("aria-label", new RegExp(LONG_TITLE));

	const reasonsClipped = await page
		.locator(REASON)
		.evaluateAll((reasons) => reasons.some((el) => el.scrollWidth > el.clientWidth));
	assert.equal(reasonsClipped, false, "connection sentences must wrap rather than clip");

	const viewport = page.viewportSize();
	assert.ok(viewport, "past-reads checkpoints run with an explicit viewport");
	const section = await measuredBox(page, SECTION);
	assert.ok(
		section.x >= 0 && section.x + section.width <= viewport.width,
		"the section must fit the viewport horizontally",
	);
}

async function setCardOpen(page: Page, open: boolean): Promise<void> {
	await page.locator(CARD).evaluate((el, shouldOpen) => {
		if (shouldOpen) el.setAttribute("open", "");
		else el.removeAttribute("open");
	}, open);
	// Drop any hover tint the pointer left on the rounded toggle, so it never
	// bakes into a baseline (mirrors next-read-visual).
	await page.mouse.move(5, 5);
}

async function collapsedSettled(page: Page): Promise<void> {
	await sectionSettled(page);
	await setCardOpen(page, false);
}

async function expandedSettled(page: Page): Promise<void> {
	await sectionSettled(page);
	await setCardOpen(page, true);
}

async function cardCollapsed(page: Page): Promise<void> {
	await sectionBetweenSummaryAndBody(page);
	assert.equal(await page.locator(CARD).getAttribute("open"), null, "the card starts collapsed");

	const summaryBackground = await page
		.locator(SUMMARY_CARD)
		.evaluate((el) => window.getComputedStyle(el).backgroundColor);
	const summaryBorderColor = await page
		.locator(SUMMARY_CARD)
		.evaluate((el) => window.getComputedStyle(el).borderTopColor);
	const summaryTogglePadding = await page
		.locator(SUMMARY_TOGGLE)
		.evaluate((el) => window.getComputedStyle(el).padding);

	assert.notEqual(summaryBackground, "rgba(0, 0, 0, 0)", "the summary card paints a surface");
	await expect(page.locator(CARD)).toHaveCSS("background-color", summaryBackground);
	await expect(page.locator(CARD)).toHaveCSS("border-top-width", "1px");
	await expect(page.locator(CARD)).toHaveCSS("border-top-color", summaryBorderColor);
	await expect(page.locator(CARD)).toHaveCSS("border-top-left-radius", "12px");
	await expect(page.locator(TOGGLE)).toHaveCSS("padding", summaryTogglePadding);

	const previewTitle = await page.locator(PREVIEW_TITLE).evaluate((el) => ({
		clipped: el.scrollWidth > el.clientWidth,
		wrapped:
			el.getBoundingClientRect().height > Number.parseFloat(window.getComputedStyle(el).lineHeight) * 1.5,
	}));
	assert.equal(previewTitle.clipped, false, "a long preview title renders whole");
	assert.equal(previewTitle.wrapped, true, "a long preview title wraps rather than clipping");

	const cardBox = await measuredBox(page, CARD);
	const more = await page.locator(MORE).evaluate((el) => {
		const box = el.getBoundingClientRect();
		return { clipped: el.scrollWidth > el.clientWidth, width: box.width, right: box.right };
	});
	assert.equal(more.clipped, false, "the see-more cue is not clipped");
	assert.ok(more.width > 0, "the see-more cue is visible");
	assert.ok(more.right <= cardBox.x + cardBox.width + 0.5, "the see-more cue stays inside the card");

	await expect(page.locator(ROW).first()).toBeHidden();

	const cardOverflows = await page.locator(CARD).evaluate((el) => el.scrollWidth > el.clientWidth);
	assert.equal(cardOverflows, false, "the collapsed card has no horizontal overflow");
	const viewport = page.viewportSize();
	assert.ok(viewport, "past-reads checkpoints run with an explicit viewport");
	assert.ok(
		cardBox.x >= 0 && cardBox.x + cardBox.width <= viewport.width,
		"the card fits the viewport horizontally",
	);
}

async function cardExpanded(page: Page): Promise<void> {
	assert.equal(await page.locator(CARD).getAttribute("open"), "", "the card is open");
	await expect(page.locator(PREVIEW)).toBeHidden();
	await rowsCompactAndPlain(page);

	const cardBox = await measuredBox(page, CARD);
	const rowRights = await page
		.locator(ROW)
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().right));
	for (const right of rowRights) {
		assert.ok(right <= cardBox.x + cardBox.width + 0.5, "each row sits inside the card");
	}
}

function collapsedSectionCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: collapsedSettled,
		geometry: cardCollapsed,
		target: SECTION,
		capture: "element",
		pinnedText: [],
	};
}

function collapsedInReaderCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: collapsedSettled,
		geometry: cardCollapsed,
		target: SECTION,
		capture: "page-from-top",
		pinnedText: [],
	};
}

function expandedSectionCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: expandedSettled,
		geometry: cardExpanded,
		target: SECTION,
		capture: "element",
		pinnedText: PINNED_READ_TIME,
	};
}

test.describe("You've already seen this before (desktop)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("collapses past reads into a card between the summary and the body (light)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReader(page, {
			stamp: `desktop-light-${test.info().workerIndex}-${Date.now()}`,
			seedPastReads: true,
		});
		await captureCheckpoint(page, collapsedInReaderCheckpoint("past-reads-in-reader-desktop-light"));
		await captureCheckpoint(page, collapsedSectionCheckpoint("past-reads-section-desktop-light"));
		await captureCheckpoint(
			page,
			expandedSectionCheckpoint("past-reads-section-expanded-desktop-light"),
		);

		await page.locator(TOGGLE).focus();
		await expect(page.locator(TOGGLE)).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page.locator(CARD)).toHaveJSProperty("open", false);
		await page.keyboard.press("Enter");
		await expect(page.locator(CARD)).toHaveJSProperty("open", true);
		await page.locator(LINK).first().focus();
		await expect(page.locator(LINK).first()).toBeFocused();
	});

	test("collapses past reads into a card between the summary and the body (dark)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReader(page, {
			stamp: `desktop-dark-${test.info().workerIndex}-${Date.now()}`,
			seedPastReads: true,
		});
		await captureCheckpoint(page, collapsedSectionCheckpoint("past-reads-section-desktop-dark"));
		await captureCheckpoint(
			page,
			expandedSectionCheckpoint("past-reads-section-expanded-desktop-dark"),
		);
	});

	test("reserves no space while nothing qualifies yet", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReader(page, {
			stamp: `pending-${test.info().workerIndex}-${Date.now()}`,
			seedPastReads: false,
		});
		const section = page.locator(SECTION);
		await expect(section).toHaveClass(/past-reads--hidden/);
		const height = await section.evaluate((el) => el.getBoundingClientRect().height);
		assert.equal(height, 0, "a pending section must take no vertical space");
	});
});

test.describe("You've already seen this before (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 390, height: 844 } });

	test("keeps the collapsed card and its rows readable on a phone (light)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReader(page, {
			stamp: `mobile-light-${test.info().workerIndex}-${Date.now()}`,
			seedPastReads: true,
		});
		await captureCheckpoint(page, collapsedInReaderCheckpoint("past-reads-in-reader-mobile-light"));
		await captureCheckpoint(page, collapsedSectionCheckpoint("past-reads-section-mobile-light"));
		await captureCheckpoint(
			page,
			expandedSectionCheckpoint("past-reads-section-expanded-mobile-light"),
		);
	});

	test("keeps the collapsed card and its rows readable on a phone (dark)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReader(page, {
			stamp: `mobile-dark-${test.info().workerIndex}-${Date.now()}`,
			seedPastReads: true,
		});
		await captureCheckpoint(page, collapsedSectionCheckpoint("past-reads-section-mobile-dark"));
		await captureCheckpoint(
			page,
			expandedSectionCheckpoint("past-reads-section-expanded-mobile-dark"),
		);
	});
});
