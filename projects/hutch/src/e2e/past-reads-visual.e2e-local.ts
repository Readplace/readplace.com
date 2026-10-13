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
import { resolveColourTokens } from "./page-measurements.browser";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const OWNER_PASSWORD = "correct-horse-battery-staple";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const COMPUTED_AT = "2026-07-10T09:20:00.000Z";
const SEEDED_PARAGRAPH =
	"<p>Reader view renders the article text in a clean, distraction-free column so the reading experience stays consistent across every site you save.</p>";

const SECTION = "[data-test-reader-topic-reads]";
const INLINE_SECTION = "[data-test-reader-topic-reads-inline]";
const CARD = ".past-reads__card";
const TOGGLE = ".past-reads__card > .disclosure-card__header";
const PREVIEW = ".past-reads__preview";
const PREVIEW_TITLE = ".past-reads__preview-title";
const ROW = ".past-reads__row";
const LINK = ".past-reads__link";
const TITLE = `${ROW} .past-reads__title`;
const REASON = ".past-reads__reason";
const RAIL = "[data-test-reader-rail]";
const ARTICLE_HISTORY = "[data-test-article-history]";
const ARTICLE_CARD = "[data-test-article-card]";
const SUMMARY = "[data-test-reader-summary]";
const READER_SLOT = "[data-test-reader-slot]";
const ROW_GAP_PX = 0;
const RAIL_GAP_PX = 16;
const PHONE_HOLDING_THE_ARTICLE_HEAD_AND_PAST_READS = { width: 390, height: 1600 };

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

interface PastReadsPlacement {
	section: string;
	sitsInPlace: (page: Page) => Promise<void>;
}

function pinnedReadTimes(placement: PastReadsPlacement) {
	return PAST_READS.map((_, index) => ({
		selector: `${placement.section} ${ROW}:nth-child(${index + 1}) [data-test-topic-read-time] time`,
		text: "just now",
	}));
}

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
	options: { stamp: string; pastReads: "ready-on-load" | "pending" | "ready-after-load" },
): Promise<{ settlePastReads: () => Promise<void> }> {
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

	if (options.pastReads !== "pending") {
		for (const pastId of pastIds) {
			const marked = await page.request.post(`${BASE_URL}/queue/${pastId}/status`, {
				form: { status: "read" },
			});
			assert.equal(marked.status(), 200, "marking a past read as read must be accepted");
		}
	}

	const settlePastReads = async (): Promise<void> => {
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
	};

	if (options.pastReads === "ready-on-load") {
		await settlePastReads();
	}

	await page.goto(`${BASE_URL}/queue/${articleId}/view`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
	await waitForBrandFonts(page, ["Inter"]);
	return { settlePastReads };
}

async function sectionSettled(page: Page, placement: PastReadsPlacement): Promise<void> {
	await page.waitForSelector(`${placement.section}[data-topic-reads-status="ready"]`);
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
		document.querySelector(".newer-version-banner")?.remove();
		document.querySelector("[data-test-reader-related]")?.remove();
	});
}

async function sectionInRailBelowArticleHistory(page: Page): Promise<void> {
	await expect(page.locator(`${RAIL} > ${SECTION}`)).toHaveCount(1);
	const history = await measuredBox(page, ARTICLE_HISTORY);
	const section = await measuredBox(page, SECTION);
	const gap = section.y - (history.y + history.height);
	assert.ok(
		Math.abs(gap - RAIL_GAP_PX) <= 0.5,
		`the past-reads section must sit ${RAIL_GAP_PX}px under Article history, measured ${gap}px`,
	);
	assert.ok(
		Math.abs(section.x - history.x) <= 0.5 && Math.abs(section.width - history.width) <= 0.5,
		`the past-reads section must share Article history's left edge and width, measured ${section.x}/${section.width} against ${history.x}/${history.width}`,
	);
}

async function sectionInArticleCardBetweenSummaryAndText(page: Page): Promise<void> {
	await expect(page.locator(`${ARTICLE_CARD} > ${INLINE_SECTION}`)).toHaveCount(1);
	const card = await measuredBox(page, ARTICLE_CARD);
	const summary = await measuredBox(page, SUMMARY);
	const section = await measuredBox(page, INLINE_SECTION);
	const readerSlot = await measuredBox(page, READER_SLOT);
	const summaryBottom = summary.y + summary.height;
	const sectionBottom = section.y + section.height;
	assert.ok(
		section.y >= summaryBottom - 0.5,
		`the past-reads section must start below the summary, measured top ${section.y} against summary bottom ${summaryBottom}`,
	);
	assert.ok(
		sectionBottom <= readerSlot.y + 0.5,
		`the past-reads section must end above the article text, measured bottom ${sectionBottom} against text top ${readerSlot.y}`,
	);
	assert.ok(
		section.x >= card.x - 0.5 && section.x + section.width <= card.x + card.width + 0.5,
		`the past-reads section must sit inside the article card, measured ${section.x}/${section.width} against ${card.x}/${card.width}`,
	);
}

const RAIL_PLACEMENT: PastReadsPlacement = {
	section: SECTION,
	sitsInPlace: sectionInRailBelowArticleHistory,
};

const INLINE_PLACEMENT: PastReadsPlacement = {
	section: INLINE_SECTION,
	sitsInPlace: sectionInArticleCardBetweenSummaryAndText,
};

async function rowsCompactAndPlain(page: Page, placement: PastReadsPlacement): Promise<void> {
	await placement.sitsInPlace(page);

	const rows = page.locator(`${placement.section} ${ROW}`);
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

	const links = page.locator(`${placement.section} ${LINK}`);
	const surfaces = await links.evaluateAll((elements) =>
		elements.map((link) => {
			const style = window.getComputedStyle(link);
			return { background: style.backgroundColor, shadow: style.boxShadow };
		}),
	);
	for (const surface of surfaces) {
		assert.equal(surface.background, "rgba(0, 0, 0, 0)", "rows must not paint a card background");
		assert.equal(surface.shadow, "none", "rows must not cast a shadow");
	}

	const headings = await links.evaluateAll((elements) =>
		elements.map((link) => {
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
		.locator(`${placement.section} ${TITLE}`)
		.first()
		.evaluate(
			(el) =>
				el.getBoundingClientRect().height > Number.parseFloat(window.getComputedStyle(el).lineHeight) * 1.5,
		);
	assert.equal(longTitleWrapped, true, "a long title must wrap rather than widen the row");
	await expect(links.first()).toHaveAttribute("aria-label", new RegExp(LONG_TITLE));

	const reasonsClipped = await page
		.locator(`${placement.section} ${REASON}`)
		.evaluateAll((reasons) => reasons.some((el) => el.scrollWidth > el.clientWidth));
	assert.equal(reasonsClipped, false, "connection sentences must wrap rather than clip");

	const viewport = page.viewportSize();
	assert.ok(viewport, "past-reads checkpoints run with an explicit viewport");
	const section = await measuredBox(page, placement.section);
	assert.ok(
		section.x >= 0 && section.x + section.width <= viewport.width,
		"the section must fit the viewport horizontally",
	);
}

async function setCardOpen(page: Page, input: { placement: PastReadsPlacement; open: boolean }): Promise<void> {
	await page.locator(`${input.placement.section} ${CARD}`).evaluate((el, shouldOpen) => {
		if (shouldOpen) el.setAttribute("open", "");
		else el.removeAttribute("open");
	}, input.open);
	// Drop any hover tint the pointer left on the rounded toggle, so it never
	// bakes into a baseline (mirrors next-read-visual).
	await page.mouse.move(5, 5);
}

async function betaTagIsBadgeSize(page: Page, placement: PastReadsPlacement): Promise<void> {
	const beta = await measuredBox(page, `${placement.section} [data-test-past-reads-beta]`);
	assert.ok(Math.abs(beta.height - 22) <= 0.5, `the Beta tag must be 22px high, measured ${beta.height}px`);
}

async function cardCollapsed(page: Page, placement: PastReadsPlacement): Promise<void> {
	const card = page.locator(`${placement.section} ${CARD}`);
	const toggle = page.locator(`${placement.section} ${TOGGLE}`);
	await placement.sitsInPlace(page);
	await betaTagIsBadgeSize(page, placement);
	assert.equal(await card.getAttribute("open"), null, "the card starts collapsed");

	const [cardFill, borderInk] = await page.evaluate(resolveColourTokens, ["--card", "--border"]);
	assert.ok(cardFill && borderInk, "the card and border tokens must resolve to colours");
	await expect(card).toHaveCSS("background-color", cardFill);
	await expect(card).toHaveCSS("border-top-width", "1px");
	await expect(card).toHaveCSS("border-top-color", borderInk);
	await expect(card).toHaveCSS("border-top-left-radius", "16px");
	await expect(toggle).toHaveCSS("min-height", "64px");
	await expect(toggle).toHaveCSS("padding", "20px");

	const previewTitle = await page.locator(`${placement.section} ${PREVIEW_TITLE}`).evaluate((el) => ({
		clipped: el.scrollWidth > el.clientWidth,
		wrapped:
			el.getBoundingClientRect().height > Number.parseFloat(window.getComputedStyle(el).lineHeight) * 1.5,
	}));
	assert.equal(previewTitle.clipped, false, "a long preview title renders whole");
	assert.equal(previewTitle.wrapped, true, "a long preview title wraps rather than clipping");

	const cardBox = await measuredBox(page, `${placement.section} ${CARD}`);

	await expect(page.locator(`${placement.section} ${ROW}`).first()).toBeHidden();

	const cardOverflows = await card.evaluate((el) => el.scrollWidth > el.clientWidth);
	assert.equal(cardOverflows, false, "the collapsed card has no horizontal overflow");
	const viewport = page.viewportSize();
	assert.ok(viewport, "past-reads checkpoints run with an explicit viewport");
	assert.ok(
		cardBox.x >= 0 && cardBox.x + cardBox.width <= viewport.width,
		"the card fits the viewport horizontally",
	);
}

async function cardExpanded(page: Page, placement: PastReadsPlacement): Promise<void> {
	assert.equal(
		await page.locator(`${placement.section} ${CARD}`).getAttribute("open"),
		"",
		"the card is open",
	);
	await betaTagIsBadgeSize(page, placement);
	await expect(page.locator(`${placement.section} ${PREVIEW}`)).toBeHidden();
	await rowsCompactAndPlain(page, placement);

	const cardBox = await measuredBox(page, `${placement.section} ${CARD}`);
	const rowRights = await page
		.locator(`${placement.section} ${ROW}`)
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().right));
	for (const right of rowRights) {
		assert.ok(right <= cardBox.x + cardBox.width + 0.5, "each row sits inside the card");
	}
}

function collapsedSectionCheckpoint(name: string, placement: PastReadsPlacement): VisualCheckpoint {
	return {
		name,
		settled: async (page) => {
			await sectionSettled(page, placement);
			await setCardOpen(page, { placement, open: false });
		},
		geometry: (page) => cardCollapsed(page, placement),
		target: placement.section,
		capture: "element",
		pinnedText: [],
	};
}

function collapsedInReaderCheckpoint(name: string, placement: PastReadsPlacement): VisualCheckpoint {
	return {
		name,
		settled: async (page) => {
			await sectionSettled(page, placement);
			await setCardOpen(page, { placement, open: false });
		},
		geometry: async (page) => {
			await cardCollapsed(page, placement);
			const viewport = page.viewportSize();
			assert.ok(viewport, "past-reads checkpoints run with an explicit viewport");
			const section = await measuredBox(page, placement.section);
			assert.ok(
				section.y + section.height <= viewport.height,
				`the page down to the section must fit the ${viewport.height}px viewport to be captured from the top, measured ${section.y + section.height}`,
			);
		},
		target: placement.section,
		capture: "page-from-top",
		pinnedText: [{ selector: "[data-test-reader-saved]", text: "6h ago" }],
	};
}

function expandedSectionCheckpoint(name: string, placement: PastReadsPlacement): VisualCheckpoint {
	return {
		name,
		settled: async (page) => {
			await sectionSettled(page, placement);
			await setCardOpen(page, { placement, open: true });
		},
		geometry: (page) => cardExpanded(page, placement),
		target: placement.section,
		capture: "element",
		pinnedText: pinnedReadTimes(placement),
	};
}

test.describe("You've already seen this before (desktop)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("collapses past reads into a rail card under Article history (light)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReader(page, {
			stamp: `desktop-light-${test.info().workerIndex}-${Date.now()}`,
			pastReads: "ready-on-load",
		});
		await captureCheckpoint(
			page,
			collapsedInReaderCheckpoint("past-reads-in-reader-desktop-light", RAIL_PLACEMENT),
		);
		await captureCheckpoint(
			page,
			collapsedSectionCheckpoint("past-reads-section-desktop-light", RAIL_PLACEMENT),
		);
		await captureCheckpoint(
			page,
			expandedSectionCheckpoint("past-reads-section-expanded-desktop-light", RAIL_PLACEMENT),
		);

		const card = page.locator(`${SECTION} ${CARD}`);
		const toggle = page.locator(`${SECTION} ${TOGGLE}`);
		const firstLink = page.locator(`${SECTION} ${LINK}`).first();
		await toggle.focus();
		await expect(toggle).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(card).toHaveJSProperty("open", false);
		await page.keyboard.press("Enter");
		await expect(card).toHaveJSProperty("open", true);
		await firstLink.focus();
		await expect(firstLink).toBeFocused();
	});

	test("collapses past reads into a rail card under Article history (dark)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReader(page, {
			stamp: `desktop-dark-${test.info().workerIndex}-${Date.now()}`,
			pastReads: "ready-on-load",
		});
		await captureCheckpoint(
			page,
			collapsedSectionCheckpoint("past-reads-section-desktop-dark", RAIL_PLACEMENT),
		);
		await captureCheckpoint(
			page,
			expandedSectionCheckpoint("past-reads-section-expanded-desktop-dark", RAIL_PLACEMENT),
		);
	});

	test("reserves no space while nothing qualifies yet", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReader(page, {
			stamp: `pending-${test.info().workerIndex}-${Date.now()}`,
			pastReads: "pending",
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
			pastReads: "ready-on-load",
		});
		const phone = page.viewportSize();
		assert.ok(phone, "the phone checkpoints run with an explicit viewport");
		await page.setViewportSize(PHONE_HOLDING_THE_ARTICLE_HEAD_AND_PAST_READS);
		await captureCheckpoint(
			page,
			collapsedInReaderCheckpoint("past-reads-in-reader-mobile-light", INLINE_PLACEMENT),
		);
		await page.setViewportSize(phone);
		await captureCheckpoint(
			page,
			collapsedSectionCheckpoint("past-reads-section-mobile-light", INLINE_PLACEMENT),
		);
		await captureCheckpoint(
			page,
			expandedSectionCheckpoint("past-reads-section-expanded-mobile-light", INLINE_PLACEMENT),
		);
	});

	test("keeps the collapsed card and its rows readable on a phone (dark)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReader(page, {
			stamp: `mobile-dark-${test.info().workerIndex}-${Date.now()}`,
			pastReads: "ready-on-load",
		});
		await captureCheckpoint(
			page,
			collapsedSectionCheckpoint("past-reads-section-mobile-dark", INLINE_PLACEMENT),
		);
		await captureCheckpoint(
			page,
			expandedSectionCheckpoint("past-reads-section-expanded-mobile-dark", INLINE_PLACEMENT),
		);
	});

	test("sets past reads inside the article card between the summary and the article text, not in the rail", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReader(page, {
			stamp: `mobile-inline-${test.info().workerIndex}-${Date.now()}`,
			pastReads: "ready-on-load",
		});
		await sectionSettled(page, INLINE_PLACEMENT);

		await expect(page.locator(`${INLINE_SECTION} ${CARD}`)).toBeVisible();
		await sectionInArticleCardBetweenSummaryAndText(page);

		const rail = page.locator(SECTION);
		await expect(rail).toHaveCount(1);
		await expect(rail).toHaveClass(/past-reads--ready/);
		await expect(rail).toBeHidden();
		const railHeight = await rail.evaluate((el) => el.getBoundingClientRect().height);
		assert.equal(railHeight, 0, "the rail copy must take no vertical space on a phone");
	});

	test("reveals the in-article card once past reads settle after the page loaded", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		const { settlePastReads } = await openReader(page, {
			stamp: `mobile-settles-${test.info().workerIndex}-${Date.now()}`,
			pastReads: "ready-after-load",
		});
		const inline = page.locator(INLINE_SECTION);
		await expect(inline).toHaveCount(1);
		await expect(inline).toHaveClass(/past-reads--hidden/);
		await expect(inline).toHaveAttribute("data-topic-reads-status", "pending");

		await settlePastReads();

		await expect(inline).toHaveAttribute("data-topic-reads-status", "ready", { timeout: 10_000 });
		await expect(inline).toHaveClass(/past-reads--ready/);
		await expect(page.locator(`${INLINE_SECTION} ${CARD}`)).toBeVisible();
		await expect(page.locator(`${INLINE_SECTION} ${ROW}`)).toHaveCount(PAST_READS.length);
		await sectionInArticleCardBetweenSummaryAndText(page);
	});
});
