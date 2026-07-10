import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test, waitForBrandFonts } from "./hermetic-cdn";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const CONTENT_FETCHED_AT = "2026-03-26T14:32:00.000Z";
const ARTICLE_URL = "https://example.com/verify-banner-nav-visual";
const CANONICAL_PATH = "example.com/verify-banner-nav-visual";
const PASSWORD = "Sup3r-Secret-Pw!";

const FONTS_READY = "document.fonts.ready.then(() => undefined)";

// A wide viewport keeps the long verify banner on one line; the narrow one
// wraps it to two lines. That rewrap is the trigger the bug depended on: the
// fixed banner grows but the sticky nav's `top` (var --banner-area-height) was
// measured once at load, so a stale value let the banner cover the top of the
// nav. The self-correcting measurement re-runs on resize, keeping them apart.
const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 390, height: 844 };

async function seedArticle(page: Page): Promise<void> {
	const response = await page.request.post(
		`${BASE_URL}/e2e/seed-crawled-article`,
		{
			data: {
				url: ARTICLE_URL,
				title: "Verify Banner Nav Visual",
				contentFetchedAt: CONTENT_FETCHED_AT,
			},
		},
	);
	assert.equal(
		response.status(),
		201,
		"seed endpoint must create the crawled article",
	);
}

// Sign up a fresh user through the real form. New accounts are unverified, so
// the shell renders the "N days left" countdown banner on every page — and a
// just-registered user is deterministically 7 days out.
async function signUpUnverified(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator("#confirmPassword").fill(PASSWORD);
	// The bot gate rejects forms submitted implausibly fast; stamp it as loaded
	// a few seconds ago, exactly like the queue-flow auth helper does.
	await page.locator('input[name="loadedAt"]').evaluate((el: HTMLInputElement) => {
		el.value = String(Date.now() - 5000);
	});
	await page.locator('[data-test-action="signup"]').click();
	await page.waitForSelector("body.page-queue");
}

async function openReaderAsUnverified(page: Page, email: string): Promise<void> {
	await seedArticle(page);
	await signUpUnverified(page, email);
	await page.goto(`${BASE_URL}/view/${CANONICAL_PATH}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("[data-article-body]");
	await waitForBrandFonts(page, ["Inter", "Font Awesome 6 Free"]);
	// Confirms we are authenticated-but-unverified before we measure or capture:
	// this copy only renders for a counting-down verification state.
	await expect(page.locator("[data-test-verify-banner]")).toContainText(
		"before your account is locked",
	);
}

// Narrow the viewport so the verify banner wraps to two lines (the bug trigger),
// then settle the header for a deterministic capture: the trial countdown pill
// ("13d 23h left…") reveals asynchronously and its text ticks by the hour, so
// remove it — a detached node can't render whatever visibility class the client
// script later toggles. (The extension-suggestion banner is already suppressed
// via localStorage in beforeEach.)
async function settleNarrow(page: Page): Promise<void> {
	await page.setViewportSize(NARROW);
	await page.evaluate(() => {
		document.querySelector(".trial-countdown")?.remove();
		document.querySelector(".offline-banner")?.remove();
	});
	await page.evaluate(FONTS_READY);
}

// The regression guard, reused before every screenshot so the pixels are only
// captured once the layout has settled. A positive gap means the banner's
// bottom edge sits below the nav's top edge — i.e. they overlap.
async function expectNavBelowBanner(page: Page): Promise<void> {
	await expect
		.poll(async () => {
			const nav = await page.locator(".header").boundingBox();
			const banner = await page.locator(".banner-area").boundingBox();
			assert.ok(nav && banner, "nav and banner must be laid out");
			return banner.y + banner.height - nav.y;
		})
		.toBeLessThanOrEqual(1);
}

// Capture from the top of the page through the bottom of the nav — the verify
// banner plus the nav — and stop before the article body, whose summary and
// progress states are not deterministic. Polls until the nav's bottom is stable
// across two reads so an in-flight reflow can't size the clip mid-settle.
async function topClip(page: Page): Promise<{
	x: number;
	y: number;
	width: number;
	height: number;
}> {
	let previous = -1;
	let bottom = -1;
	await expect
		.poll(async () => {
			const nav = await page.locator(".header").boundingBox();
			assert.ok(nav, "nav must be laid out");
			bottom = Math.ceil(nav.y + nav.height);
			const stable = bottom === previous;
			previous = bottom;
			return stable;
		})
		.toBe(true);
	return { x: 0, y: 0, width: NARROW.width, height: bottom };
}

test.describe("Verify banner never overlaps the nav", () => {
	test.use({ timezoneId: "UTC", viewport: WIDE });

	test.beforeEach(async ({ page }) => {
		// The extension-suggestion banner slides in on a client timer and animates
		// its height, which would race the capture. It opts out of showing when its
		// dismissed flag is set, so set it up front. (The trial countdown is removed
		// per-capture in settleNarrow — a style tag can't reliably beat the client
		// script that reveals it, but a removed element can't render.)
		await page.addInitScript(() => {
			window.localStorage.setItem(
				"readplace.extension-suggestion-dismissed",
				"1",
			);
		});
	});

	test("the nav stays fully below the banner after it wraps to two lines", async ({
		page,
	}, testInfo) => {
		await openReaderAsUnverified(
			page,
			`verify-nav-guard-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await settleNarrow(page);
		await expectNavBelowBanner(page);
	});

	test("renders the banner above the nav (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReaderAsUnverified(
			page,
			`verify-nav-light-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await settleNarrow(page);
		await expectNavBelowBanner(page);
		await expect(page).toHaveScreenshot("verify-banner-nav-light.png", {
			clip: await topClip(page),
		});
	});

	test("renders the banner above the nav (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReaderAsUnverified(
			page,
			`verify-nav-dark-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await settleNarrow(page);
		await expectNavBelowBanner(page);
		await expect(page).toHaveScreenshot("verify-banner-nav-dark.png", {
			clip: await topClip(page),
		});
	});
});
