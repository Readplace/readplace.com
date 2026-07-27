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
import { E2E_CHANGELOG_BANNER_HEADER } from "./changelog-banner-fixture";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const CONTENT_FETCHED_AT = "2026-03-26T14:32:00.000Z";
const ARTICLE_URL = "https://example.com/verify-banner-nav-visual";
const CANONICAL_PATH = "example.com/verify-banner-nav-visual";
const PASSWORD = "Sup3r-Secret-Pw!";

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

const FOUNDING_SEATS_IN_THE_E2E_FIXTURE = [1, 2, 3];

async function fillFoundingSeatsSoSignupStartsATrial(page: Page, stamp: string): Promise<void> {
	for (const seat of FOUNDING_SEATS_IN_THE_E2E_FIXTURE) {
		const response = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email: `founding-seat-${seat}-${stamp}@example.com`, password: PASSWORD },
		});
		assert.equal(
			response.status(),
			201,
			"the e2e user fixture must seed a founding-seat filler",
		);
	}
}

// Sign up a fresh user through the real form. New accounts are unverified, so
// the shell renders the "N days left" countdown banner on every page — and a
// just-registered user is deterministically 7 days out.
async function signUpUnverified(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
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
	await waitForBrandFonts(page, ["Inter"]);
	// Confirms we are authenticated-but-unverified before we measure or capture:
	// this copy only renders for a counting-down verification state.
	await expect(page.locator("[data-test-verify-banner]")).toContainText(
		"before your account is locked",
	);
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

async function bannerAreaHeightSettled(page: Page): Promise<void> {
	let previousHeight = Number.NaN;
	await expect
		.poll(async () => {
			const { height } = await measuredBox(page, ".banner-area");
			const stable = height === previousHeight;
			previousHeight = height;
			return stable;
		})
		.toBe(true);
}

async function offlineNoticeFullyExpanded(page: Page): Promise<void> {
	await page.waitForFunction(
		() =>
			document.querySelector(".offline-banner.offline-banner--visible")?.getAnimations()
				.length === 0,
	);
}

async function narrowSoTheBannerGrows(page: Page): Promise<void> {
	await page.setViewportSize(NARROW);
	await waitForBrandFonts(page, ["Inter"]);
	await bannerAreaHeightSettled(page);
}

const VOLATILE_CHROME = [".trial-countdown", ".offline-banner"];

function initBannerNavSettled(keptUnderTest: readonly string[]) {
	const stripped = VOLATILE_CHROME.filter((selector) => !keptUnderTest.includes(selector));
	return async function settled(page: Page): Promise<void> {
		await page.evaluate((selectors) => {
			for (const selector of selectors) document.querySelector(selector)?.remove();
		}, stripped);
		await expectNavBelowBanner(page);
	};
}

const bannerNavSettled = initBannerNavSettled([]);
const bannerNavSettledKeepingTrialCountdown = initBannerNavSettled([".trial-countdown"]);
const bannerNavSettledKeepingOfflineBanner = initBannerNavSettled([".offline-banner"]);

async function navClearsBannerGeometry(page: Page): Promise<void> {
	const banner = await measuredBox(page, ".banner-area");
	const nav = await measuredBox(page, ".header");
	assert.equal(banner.y, 0, "the banner must start at the very top of the page");
	assert.ok(
		banner.y + banner.height - nav.y <= 1,
		"the banner's bottom edge must not overlap the nav's top edge",
	);
}

const VERIFY_BANNER_NAV_LIGHT: VisualCheckpoint = {
	name: "verify-banner-nav-light",
	settled: bannerNavSettled,
	geometry: navClearsBannerGeometry,
	target: ".header",
	capture: "page-from-top",
	pinnedText: [],
};

const VERIFY_BANNER_NAV_DARK: VisualCheckpoint = {
	name: "verify-banner-nav-dark",
	settled: bannerNavSettled,
	geometry: navClearsBannerGeometry,
	target: ".header",
	capture: "page-from-top",
	pinnedText: [],
};

test.describe("Verify banner never overlaps the nav", () => {
	test.use({ timezoneId: "UTC", viewport: WIDE });

	test.beforeEach(async ({ page }) => {
		// The extension-suggestion banner slides in on a client timer and animates
		// its height, which would race the capture. It opts out of showing when its
		// dismissed flag is set, so set it up front.
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
		await page.setViewportSize(NARROW);
		await bannerNavSettled(page);
		await navClearsBannerGeometry(page);
	});

	test("the nav stays clear of the banner while the trial countdown is live", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		await fillFoundingSeatsSoSignupStartsATrial(page, stamp);
		await openReaderAsUnverified(page, `verify-nav-trial-${stamp}@example.com`);
		await expect(page.locator("[data-test-trial-countdown]")).toHaveClass(
			/trial-countdown--visible/,
		);
		await narrowSoTheBannerGrows(page);
		await bannerNavSettledKeepingTrialCountdown(page);
		await navClearsBannerGeometry(page);
	});

	test("the nav stays clear of the banner when a changelog announcement stacks above it", async ({
		page,
	}, testInfo) => {
		await page.setExtraHTTPHeaders({ [E2E_CHANGELOG_BANNER_HEADER]: "1" });
		await openReaderAsUnverified(
			page,
			`verify-nav-changelog-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await expect(page.locator("[data-test-changelog-banner]")).toHaveClass(
			/changelog-banner--visible/,
		);
		await narrowSoTheBannerGrows(page);
		await bannerNavSettled(page);
		await navClearsBannerGeometry(page);
	});

	test("the nav stays clear of the banner when the offline notice expands", async ({
		page,
	}, testInfo) => {
		await openReaderAsUnverified(
			page,
			`verify-nav-offline-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await narrowSoTheBannerGrows(page);
		await page.context().setOffline(true);
		await offlineNoticeFullyExpanded(page);
		await bannerNavSettledKeepingOfflineBanner(page);
		await navClearsBannerGeometry(page);
	});

	test("renders the banner above the nav (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReaderAsUnverified(
			page,
			`verify-nav-light-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await page.setViewportSize(NARROW);
		await captureCheckpoint(page, VERIFY_BANNER_NAV_LIGHT);
	});

	test("renders the banner above the nav (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReaderAsUnverified(
			page,
			`verify-nav-dark-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await page.setViewportSize(NARROW);
		await captureCheckpoint(page, VERIFY_BANNER_NAV_DARK);
	});
});
