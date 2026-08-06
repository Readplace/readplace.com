import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const PAST_THE_ACCESS_WINDOW_DAYS = 10;
const EXPIRING_WORD_COUNT = 1500;
const SEEDED_PARAGRAPH =
	"<p>Reader view renders the article text in a clean, distraction-free column so the reading experience stays consistent across every site you save. This paragraph gives the seeded fixture enough height that scrolling past the reveal threshold is a real scroll.</p>";

const MODAL = ".view__paywall-modal";
const ORIGINAL_CTA = "[data-test-view-paywall-original]";
const SAVE_CTA = "[data-test-view-paywall-save]";
const STACK_GAP_PX = 12;

const DESKTOP_ARTICLE_URL = "https://example.com/paywall-visual-desktop";
const MOBILE_ARTICLE_URL = "https://example.com/paywall-visual-mobile";

async function seedExpiredArticle(page: Page, url: string): Promise<void> {
	const savedAt = new Date(
		Date.now() - PAST_THE_ACCESS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
	).toISOString();
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url,
			title: "The Long Read That Outlived Its Public Access Window",
			content: Array.from({ length: 40 }, () => SEEDED_PARAGRAPH).join("\n"),
			contentFetchedAt: CONTENT_FETCHED_AT,
			wordCount: EXPIRING_WORD_COUNT,
			savedAt,
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the expired article");
}

async function openRevealedPaywall(page: Page, url: string): Promise<void> {
	await seedExpiredArticle(page, url);
	const { host, pathname } = new URL(url);
	await page.goto(`${BASE_URL}/view/${host}${pathname}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-view");
	await page.waitForSelector('[data-test-view-expiry][data-expiry-state="expired"]');
	await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await page.waitForSelector('[data-view-paywall][data-paywall-active="true"]');
	await waitForBrandFonts(page, ["Inter"]);
}

async function paywallRevealed(page: Page): Promise<void> {
	await page.waitForSelector('[data-view-paywall][data-paywall-active="true"]');
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
		document.querySelector(".trial-countdown")?.remove();
		document.querySelector(".view__share-row")?.remove();
	});
}

async function ctasStackOriginalFirst(page: Page): Promise<void> {
	const original = await measuredBox(page, ORIGINAL_CTA);
	const save = await measuredBox(page, SAVE_CTA);
	assert.ok(
		save.y >= original.y + original.height,
		"the original-article CTA must sit above Save to My Queue",
	);
	assert.equal(
		save.y - (original.y + original.height),
		STACK_GAP_PX,
		"the stacked CTAs must keep the 0.75rem gap",
	);
	assert.equal(save.x, original.x, "the CTAs must stack in one column, not sit side by side");
	assert.equal(save.width, original.width, "the stacked CTAs must share the modal's full width");

	const modal = await measuredBox(page, MODAL);
	for (const [name, cta] of [
		["original-article", original],
		["save", save],
	] as const) {
		assert.ok(
			cta.x >= modal.x && cta.x + cta.width <= modal.x + modal.width,
			`the ${name} CTA must sit inside the modal horizontally`,
		);
		assert.ok(
			cta.y >= modal.y && cta.y + cta.height <= modal.y + modal.height,
			`the ${name} CTA must sit inside the modal vertically`,
		);
	}
}

async function arrowKeepsBreathingRoom(page: Page): Promise<void> {
	const labelToIconGap = await page.locator(ORIGINAL_CTA).evaluate((anchor) => {
		const icon = anchor.querySelector("svg");
		if (!icon) throw new Error("the original-article CTA must carry the arrow icon");
		const label = anchor.firstChild;
		if (!label || label.nodeType !== Node.TEXT_NODE) {
			throw new Error("the original-article CTA label must precede the arrow icon");
		}
		const range = document.createRange();
		range.selectNodeContents(label);
		return icon.getBoundingClientRect().left - range.getBoundingClientRect().right;
	});
	assert.ok(
		labelToIconGap >= 4,
		`the arrow icon must not sit flush against the label, measured ${labelToIconGap}px of breathing room`,
	);
}

async function modalLaidOut(page: Page): Promise<void> {
	await ctasStackOriginalFirst(page);
	await arrowKeepsBreathingRoom(page);
}

async function modalFitsMobileViewport(page: Page): Promise<void> {
	await modalLaidOut(page);
	const viewport = page.viewportSize();
	assert.ok(viewport, "the mobile checkpoints must run with an explicit viewport");
	const modal = await measuredBox(page, MODAL);
	assert.ok(
		modal.x >= 0 && modal.x + modal.width <= viewport.width,
		"the modal must fit the mobile viewport horizontally",
	);
	assert.ok(modal.y >= 0, "the modal must not clip past the top of the viewport");
	const stickyBar = await measuredBox(page, ".view__cta");
	assert.ok(
		modal.y + modal.height <= stickyBar.y,
		"the modal must clear the sticky CTA bar instead of crowding it",
	);
}

const DESKTOP_LIGHT: VisualCheckpoint = {
	name: "view-paywall-expired-desktop-light",
	settled: paywallRevealed,
	geometry: modalLaidOut,
	target: MODAL,
	capture: "element",
	pinnedText: [],
};

const DESKTOP_DARK: VisualCheckpoint = {
	name: "view-paywall-expired-desktop-dark",
	settled: paywallRevealed,
	geometry: modalLaidOut,
	target: MODAL,
	capture: "element",
	pinnedText: [],
};

const MOBILE_LIGHT: VisualCheckpoint = {
	name: "view-paywall-expired-mobile-light",
	settled: paywallRevealed,
	geometry: modalFitsMobileViewport,
	target: MODAL,
	capture: "element",
	pinnedText: [],
};

const MOBILE_DARK: VisualCheckpoint = {
	name: "view-paywall-expired-mobile-dark",
	settled: paywallRevealed,
	geometry: modalFitsMobileViewport,
	target: MODAL,
	capture: "element",
	pinnedText: [],
};

test.describe("Expired paywall modal (desktop)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("the original-article CTA leads the revealed modal (light)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openRevealedPaywall(page, DESKTOP_ARTICLE_URL);
		await captureCheckpoint(page, DESKTOP_LIGHT);
	});

	test("the original-article CTA leads the revealed modal (dark)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openRevealedPaywall(page, DESKTOP_ARTICLE_URL);
		await captureCheckpoint(page, DESKTOP_DARK);
	});
});

test.describe("Expired paywall modal (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 390, height: 844 } });

	test("the revealed modal keeps its stacked CTAs on screen and clear of the sticky bar (light)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openRevealedPaywall(page, MOBILE_ARTICLE_URL);
		await captureCheckpoint(page, MOBILE_LIGHT);
	});

	test("the revealed modal keeps its stacked CTAs on screen and clear of the sticky bar (dark)", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openRevealedPaywall(page, MOBILE_ARTICLE_URL);
		await captureCheckpoint(page, MOBILE_DARK);
	});
});
