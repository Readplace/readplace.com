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
import { pageOverflowsSideways } from "./page-measurements.browser";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const OWNER_PASSWORD = "correct-horse-battery-staple";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const COMPUTED_AT = "2026-07-10T09:20:00.000Z";
const SOURCE_SAVED_AT = "2026-07-01T09:00:00.000Z";
const RELATED_SAVED_AT = "2026-07-07T09:00:00.000Z";
const SEEDED_PARAGRAPH =
	"<p>Reader view renders the article text in a clean, distraction-free column so the reading experience stays consistent across every site you save. This paragraph gives the seeded fixture enough height that scrolling to the end of the article is a real scroll.</p>";
const SOURCE_SUMMARY = {
	summary: "A long read that ends by offering one more article from the reader's own saves.",
	excerpt: "A long read that ends by offering one more article.",
};

const CARD = "[data-test-reader-related]";
const CARD_SURFACE = ".next-read__card";
const SITE = ".next-read__site-name";
const DISMISS = '[data-test-action="next-read-dismiss"]';
const HEADING = ".next-read__heading";
const START = ".next-read__start";
const META = ".next-read__meta";
const ARTICLE_CARD = "[data-test-article-card]";
const READ_STATE = "[data-test-read-status]";
const DESKTOP_ROW_GAP = 32;
const PHONE_ROW_GAP = 24;
const CARD_INSET = 25;
const START_HEIGHT = 40;
const HALF_PIXEL = 0.5;

/** The saved-time phrase is wall-clock relative, so it is pinned to a fixed
 * string before every capture — otherwise the baseline rots a day after it is
 * generated. */
const PINNED_SAVED = [
	{ selector: "[data-test-reader-related] time", text: "3d ago" },
];

const PINNED_READ = [
	{ selector: "[data-test-reader-related] time", text: "2 hours ago" },
];

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
	input: {
		url: string;
		title: string;
		userId: string;
		savedAt: string;
		generatedSummary?: { summary: string; excerpt: string };
	},
): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.url,
			title: input.title,
			content: Array.from({ length: 40 }, () => SEEDED_PARAGRAPH).join("\n"),
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: input.userId,
			savedAt: input.savedAt,
			generatedSummary: input.generatedSummary,
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

async function openCard(
	page: Page,
	options: { stamp: string; markRelatedRead: boolean },
): Promise<void> {
	const email = `next-read-${options.stamp}@example.com`;
	const userId = await createOwner(page, email);
	const sourceUrl = `https://example.com/next-read-source-${options.stamp}`;
	/** A deliberately long host: the site line is the one field with no natural
	 * bound, so the fixture drives it past the card's width to keep the
	 * single-line truncation under test. */
	const relatedUrl = `https://an-extremely-long-publication-hostname.example.com/next-read-related-${options.stamp}`;

	const articleId = await seedArticle(page, {
		url: sourceUrl,
		title: "The Long Read That Earns Its Next Suggestion",
		userId,
		savedAt: SOURCE_SAVED_AT,
		generatedSummary: SOURCE_SUMMARY,
	});
	const relatedId = await seedArticle(page, {
		url: relatedUrl,
		title: "The Attention Economy Runs On Your Unread Readlist",
		userId,
		savedAt: RELATED_SAVED_AT,
	});

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-related-articles`, {
		data: {
			userId,
			sourceUrl,
			related: [
				{ url: relatedUrl, reason: "Also argues attention is the scarce resource" },
			],
			computedAt: COMPUTED_AT,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must settle the relations");

	await loginAs(page, email);
	if (options.markRelatedRead) {
		const marked = await page.request.post(`${BASE_URL}/queue/${relatedId}/status`, {
			form: { status: "read" },
		});
		assert.equal(marked.status(), 200, "marking the relation read must be accepted");
	}
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
	await page.waitForSelector('[data-test-reader-related][data-related-status="ready"]');
	await page.locator(CARD).scrollIntoViewIfNeeded();
	await waitForBrandFonts(page, ["Inter"]);
}

async function cardSettled(page: Page): Promise<void> {
	await page.mouse.move(5, 5);
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
		document.querySelector(".newer-version-banner")?.remove();
	});
}

function assertNear(measured: { actual: number; expected: number }, message: string): void {
	assert.ok(
		Math.abs(measured.actual - measured.expected) <= HALF_PIXEL,
		`${message}: expected ${measured.expected} ± ${HALF_PIXEL}, measured ${measured.actual}`,
	);
}

async function siteLine(page: Page): Promise<{ clipped: boolean; wrapped: boolean }> {
	return page.locator(SITE).evaluate((el) => ({
		clipped: el.scrollWidth > el.clientWidth,
		wrapped: el.scrollHeight > el.clientHeight,
	}));
}

async function cardInFlowUnderArticle(page: Page): Promise<void> {
	const article = await measuredBox(page, ARTICLE_CARD);
	const card = await measuredBox(page, CARD_SURFACE);
	assertNear({ actual: card.x, expected: article.x }, "the card shares the article card's left edge");
	assertNear({ actual: card.width, expected: article.width }, "the card is as wide as the article card");
	assertNear(
		{ actual: card.y, expected: article.y + article.height + DESKTOP_ROW_GAP },
		"the card sits one 32px row gap under the article card",
	);
	assert.equal(
		await page.locator(CARD).evaluate((slot) => getComputedStyle(slot).position),
		"static",
		"the card sits in the page's flow, never sticky or fixed",
	);

	const glyph = await measuredBox(page, `${DISMISS} svg`);
	assertNear(
		{ actual: glyph.x + glyph.width, expected: card.x + card.width - CARD_INSET },
		"the dismiss glyph's right edge sits on the card's padding edge",
	);
	assertNear({ actual: glyph.y, expected: card.y + CARD_INSET }, "the dismiss glyph's top sits on the card's padding edge");

	const start = await measuredBox(page, START);
	const meta = await measuredBox(page, META);
	assertNear({ actual: start.height, expected: START_HEIGHT }, "Start is an M button, 40px tall");
	assertNear(
		{ actual: start.x + start.width, expected: card.x + card.width - CARD_INSET },
		"Start ends on the card's padding edge",
	);
	const startCentre = start.y + start.height / 2;
	assert.ok(
		startCentre >= meta.y && startCentre <= meta.y + meta.height,
		`Start sits on the facts row: its centre ${startCentre} must fall inside ${meta.y}–${meta.y + meta.height}`,
	);
	assert.equal((await siteLine(page)).wrapped, false, "the site name stays on one line");
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the reader must not scroll sideways");
}

async function cardStacksFootOnPhone(page: Page): Promise<void> {
	const article = await measuredBox(page, ARTICLE_CARD);
	const card = await measuredBox(page, CARD_SURFACE);
	assertNear(
		{ actual: card.y, expected: article.y + article.height + PHONE_ROW_GAP },
		"the card sits one 24px row gap under the article card",
	);
	const start = await measuredBox(page, START);
	const meta = await measuredBox(page, META);
	assertNear({ actual: start.x, expected: card.x + CARD_INSET }, "Start takes its own line at the card's leading edge");
	assert.ok(
		start.y >= meta.y + meta.height,
		`Start sits under the facts row: its top ${start.y} must clear the row's end ${meta.y + meta.height}`,
	);
	assert.deepEqual(
		await siteLine(page),
		{ clipped: true, wrapped: false },
		"the seeded long host stays on one line and is truncated rather than widening the card",
	);
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the reader must not scroll sideways");
}

function cardCheckpoint(input: {
	name: string;
	geometry: (page: Page) => Promise<void>;
	pinnedText: VisualCheckpoint["pinnedText"];
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: cardSettled,
		geometry: input.geometry,
		target: CARD,
		capture: "element",
		pinnedText: input.pinnedText,
	};
}

test.describe("Next-read card (desktop)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("rests one unread suggestion under the article, and stays dismissed for the day (light)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openCard(page, {
			stamp: `desktop-light-${test.info().workerIndex}-${Date.now()}`,
			markRelatedRead: false,
		});
		await expect(page.locator(HEADING)).toHaveText("Next Read");
		await expect(page.locator(READ_STATE)).toHaveAttribute(
			"data-test-read-status",
			"unread",
		);
		await captureCheckpoint(
			page,
			cardCheckpoint({ name: "next-read-desktop-light", geometry: cardInFlowUnderArticle, pinnedText: PINNED_SAVED }),
		);

		await page.locator(DISMISS).click();
		await page.waitForSelector(`${CARD}.next-read--hidden`, { state: "attached" });

		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-reader");
		await expect(page.locator(CARD)).toHaveClass(/next-read--hidden/);
	});

	test("rests one unread suggestion under the article (dark)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openCard(page, {
			stamp: `desktop-dark-${test.info().workerIndex}-${Date.now()}`,
			markRelatedRead: false,
		});
		await expect(page.locator(HEADING)).toHaveText("Next Read");
		await captureCheckpoint(
			page,
			cardCheckpoint({ name: "next-read-desktop-dark", geometry: cardInFlowUnderArticle, pinnedText: PINNED_SAVED }),
		);
	});

	for (const theme of ["light", "dark"] as const) {
		test(`falls back to a past read once nothing related is left unread (${theme})`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: theme });
			await openCard(page, {
				stamp: `past-desktop-${theme}-${test.info().workerIndex}-${Date.now()}`,
				markRelatedRead: true,
			});
			await expect(page.locator(HEADING)).toHaveText("Similar past reads");
			await expect(page.locator(READ_STATE)).toHaveAttribute(
				"data-test-read-status",
				"read",
			);
			await captureCheckpoint(
				page,
				cardCheckpoint({
					name: `next-read-past-desktop-${theme}`,
					geometry: cardInFlowUnderArticle,
					pinnedText: PINNED_READ,
				}),
			);
		});
	}
});

test.describe("Next-read card (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 390, height: 844 } });

	for (const theme of ["light", "dark"] as const) {
		test(`stacks Start under the facts on a phone (${theme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: theme });
			await openCard(page, {
				stamp: `mobile-${theme}-${test.info().workerIndex}-${Date.now()}`,
				markRelatedRead: false,
			});
			await captureCheckpoint(
				page,
				cardCheckpoint({ name: `next-read-mobile-${theme}`, geometry: cardStacksFootOnPhone, pinnedText: PINNED_SAVED }),
			);
		});
	}
});

test.describe("Next-read card (narrowest phone)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 320, height: 640 } });

	test("stacks Start under the facts without scrolling sideways", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openCard(page, {
			stamp: `narrow-${test.info().workerIndex}-${Date.now()}`,
			markRelatedRead: false,
		});
		await cardSettled(page);
		await cardStacksFootOnPhone(page);
	});
});
