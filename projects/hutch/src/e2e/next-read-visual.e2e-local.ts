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
const SOURCE_SAVED_AT = "2026-07-01T09:00:00.000Z";
const RELATED_SAVED_AT = "2026-07-07T09:00:00.000Z";
const SEEDED_PARAGRAPH =
	"<p>Reader view renders the article text in a clean, distraction-free column so the reading experience stays consistent across every site you save. This paragraph gives the seeded fixture enough height that scrolling to the end of the article is a real scroll.</p>";

const CARD = "[data-test-reader-related]";
/** The painted surface inside the slot wrapper. Geometry is measured here rather
 * than on the wrapper so a wrapper that stops hugging its card — leaving dead
 * space beside it and breaking the right-edge alignment with the balloon — fails
 * the checkpoint instead of passing on the wrapper's box. */
const CARD_SURFACE = ".next-read__card";
const SITE = ".next-read__site";
const STACK = "[data-test-reader-float-stack]";
const BALLOON = "[data-test-share-balloon-wrap]";
const DISMISS = '[data-test-action="next-read-dismiss"]';
const EYEBROW = ".next-read__eyebrow";
const READ_STATE = "[data-test-read-status]";
const OPEN_CARD = "[data-test-reader-related].next-read--open";

/** The saved-time phrase is wall-clock relative, so it is pinned to a fixed
 * string before every capture — otherwise the baseline rots a day after it is
 * generated. */
const PINNED_SAVED = [
	{ selector: "[data-test-reader-related] time", text: "3 days ago" },
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
	input: { url: string; title: string; userId: string; savedAt: string },
): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.url,
			title: input.title,
			content: Array.from({ length: 40 }, () => SEEDED_PARAGRAPH).join("\n"),
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: input.userId,
			savedAt: input.savedAt,
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
	await page.waitForSelector("body.page-queue");
}

/** Seeds an owner reader whose relations are already settled, so the 3s poll
 * never fires underneath a capture, then scrolls to the end of the article —
 * the only thing that reveals the card. */
async function openRevealedCard(
	page: Page,
	options: { stamp: string; suppressBalloon: boolean; markRelatedRead: boolean },
): Promise<void> {
	if (options.suppressBalloon) {
		await page.addInitScript(() => {
			window.localStorage.setItem("readplace.share-dismissed", "1");
		});
	}

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
	});
	const relatedId = await seedArticle(page, {
		url: relatedUrl,
		title: "The Attention Economy Runs On Your Unread Queue",
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
	await page.waitForSelector('[data-test-reader-related][data-related-status="ready"]', {
		state: "attached",
	});
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await page.waitForSelector(OPEN_CARD);
	await waitForBrandFonts(page, ["Inter"]);
}

async function openShareBalloon(page: Page): Promise<void> {
	await expect(async () => {
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.locator(BALLOON)).toHaveClass(/share-balloon__wrap--open/, {
			timeout: 2000,
		});
	}).toPass({ timeout: 10000 });
}

async function cardRevealed(page: Page): Promise<void> {
	await page.waitForSelector(OPEN_CARD);
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
		document.querySelector(".trial-countdown")?.remove();
	});
}

async function balloonOpenBelowCard(page: Page): Promise<void> {
	await cardRevealed(page);
	await openShareBalloon(page);
}

async function cardAnchoredBottomRight(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the next-read checkpoints must run with an explicit viewport");
	const card = await measuredBox(page, CARD_SURFACE);
	assert.ok(
		card.x >= 0 && card.x + card.width <= viewport.width,
		"the floated card must fit the viewport horizontally",
	);
	assert.ok(
		card.y >= 0 && card.y + card.height <= viewport.height,
		"the floated card must sit fully on screen",
	);

	const dismiss = await measuredBox(page, DISMISS);
	assert.ok(
		dismiss.y < card.y + card.height / 2,
		"the dismiss control must sit in the top half of the card",
	);
	assert.ok(
		dismiss.x + dismiss.width > card.x + card.width / 2,
		"the dismiss control must sit in the right half of the card",
	);

	const site = await page.locator(SITE).evaluate((el) => ({
		clipped: el.scrollWidth > el.clientWidth,
		wrapped: el.scrollHeight > el.clientHeight,
	}));
	assert.equal(site.wrapped, false, "the site name must stay on one line");
	assert.equal(
		site.clipped,
		true,
		"the seeded long host must be truncated rather than widening the card",
	);
}

async function cardStacksAboveBalloon(page: Page): Promise<void> {
	await cardAnchoredBottomRight(page);
	const balloon = await measuredBox(page, BALLOON);
	const card = await measuredBox(page, CARD_SURFACE);
	assert.ok(
		card.y + card.height <= balloon.y,
		"the next-read card must sit fully above the share balloon, never overlapping it",
	);
	assert.equal(
		balloon.x + balloon.width,
		card.x + card.width,
		"the balloon and the card must share the right edge of the float stack",
	);
}

async function stackFitsMobileViewport(page: Page): Promise<void> {
	await cardStacksAboveBalloon(page);
	const viewport = page.viewportSize();
	assert.ok(viewport, "the mobile checkpoint must run with an explicit viewport");
	const stack = await measuredBox(page, STACK);
	assert.ok(
		stack.x >= 0 && stack.x + stack.width <= viewport.width,
		"the float stack must fit the mobile viewport horizontally",
	);
	assert.ok(
		stack.y >= 0 && stack.y + stack.height <= viewport.height,
		"the float stack must stay on screen on mobile",
	);
}

const CARD_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "next-read-desktop-light",
	settled: cardRevealed,
	geometry: cardAnchoredBottomRight,
	target: CARD,
	capture: "element",
	pinnedText: PINNED_SAVED,
};

const CARD_PAST_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "next-read-past-desktop-light",
	settled: cardRevealed,
	geometry: cardAnchoredBottomRight,
	target: CARD,
	capture: "element",
	pinnedText: PINNED_READ,
};

const CARD_DESKTOP_DARK: VisualCheckpoint = {
	name: "next-read-desktop-dark",
	settled: cardRevealed,
	geometry: cardAnchoredBottomRight,
	target: CARD,
	capture: "element",
	pinnedText: PINNED_SAVED,
};

const STACK_DESKTOP_LIGHT: VisualCheckpoint = {
	name: "next-read-balloon-stack-desktop-light",
	settled: balloonOpenBelowCard,
	geometry: cardStacksAboveBalloon,
	target: STACK,
	capture: "element",
	pinnedText: PINNED_SAVED,
};

/** Captures the card rather than the whole stack. The stack's height is the sum
 * of two independently-wrapping text blocks, so it accumulates fractional line
 * heights and rounds to a different integer on the CI renderer than on the one
 * that generated the baseline — and `toHaveScreenshot` rejects a size mismatch
 * before any pixel threshold applies. The stacking itself is what
 * `stackFitsMobileViewport` asserts numerically. */
const CARD_MOBILE_LIGHT: VisualCheckpoint = {
	name: "next-read-mobile-light",
	settled: balloonOpenBelowCard,
	geometry: stackFitsMobileViewport,
	target: CARD,
	capture: "element",
	pinnedText: PINNED_SAVED,
};

test.describe("Next-read card (desktop)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("floats one unread suggestion once the reader reaches the end, and stays dismissed for the day (light)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openRevealedCard(page, {
			stamp: `desktop-light-${test.info().workerIndex}-${Date.now()}`,
			suppressBalloon: true,
			markRelatedRead: false,
		});
		await expect(page.locator(EYEBROW)).toHaveText("Next read");
		await expect(page.locator(READ_STATE)).toHaveAttribute(
			"data-test-read-status",
			"unread",
		);
		await captureCheckpoint(page, CARD_DESKTOP_LIGHT);

		await page.locator(DISMISS).click();
		await page.waitForSelector(`${CARD}.next-read--hidden`, { state: "attached" });

		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-reader");
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.locator(CARD)).toHaveClass(/next-read--hidden/);
	});

	test("floats one unread suggestion once the reader reaches the end (dark)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openRevealedCard(page, {
			stamp: `desktop-dark-${test.info().workerIndex}-${Date.now()}`,
			suppressBalloon: true,
			markRelatedRead: false,
		});
		await captureCheckpoint(page, CARD_DESKTOP_DARK);
	});

	test("falls back to a past read once nothing related is left unread (light)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openRevealedCard(page, {
			stamp: `past-desktop-light-${test.info().workerIndex}-${Date.now()}`,
			suppressBalloon: true,
			markRelatedRead: true,
		});
		await expect(page.locator(EYEBROW)).toHaveText("Similar past reads");
		await expect(page.locator(READ_STATE)).toHaveAttribute(
			"data-test-read-status",
			"read",
		);
		await captureCheckpoint(page, CARD_PAST_DESKTOP_LIGHT);
	});

	test("stacks above an opened share balloon without either covering the other", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openRevealedCard(page, {
			stamp: `stack-desktop-${test.info().workerIndex}-${Date.now()}`,
			suppressBalloon: false,
			markRelatedRead: false,
		});
		await captureCheckpoint(page, STACK_DESKTOP_LIGHT);
	});

	test("leaves the opened share balloon alone when the suggestion above it is dismissed", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openRevealedCard(page, {
			stamp: `dismiss-keeps-balloon-${test.info().workerIndex}-${Date.now()}`,
			suppressBalloon: false,
			markRelatedRead: false,
		});
		await openShareBalloon(page);

		await page.locator(DISMISS).click();
		await page.waitForSelector(`${CARD}.next-read--hidden`, { state: "attached" });

		await expect(page.locator(BALLOON)).toBeVisible();
		await expect(page.locator(BALLOON)).toHaveClass(/share-balloon__wrap--open/);
	});
});

test.describe("Next-read card (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 390, height: 844 } });

	test("keeps the card and the opened share balloon stacked and on screen", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openRevealedCard(page, {
			stamp: `stack-mobile-${test.info().workerIndex}-${Date.now()}`,
			suppressBalloon: false,
			markRelatedRead: false,
		});
		await captureCheckpoint(page, CARD_MOBILE_LIGHT);
	});
});
