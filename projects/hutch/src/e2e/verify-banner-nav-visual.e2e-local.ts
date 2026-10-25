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
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { E2E_CHANGELOG_BANNER_HEADER } from "./changelog-banner-fixture";
import { openAddLink } from "./page-interactions";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const CONTENT_FETCHED_AT = "2026-03-26T14:32:00.000Z";
const ARTICLE_URL = "https://example.com/verify-banner-nav-visual";
const CANONICAL_PATH = "example.com/verify-banner-nav-visual";
const PASSWORD = "Sup3r-Secret-Pw!";
const SEEDED_BODY =
	"<p>Seeded article body for the verify-banner-nav visual regression test.</p>";

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
				content: SEEDED_BODY,
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
// the shell renders the countdown banner — and a
// just-registered user is deterministically 7 days out.
async function signUpUnverified(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	// The bot gate rejects forms submitted implausibly fast; stamp it as loaded
	// a few seconds ago, exactly like the readlist-flow auth helper does.
	await page.locator('input[name="loadedAt"]').evaluate((el: HTMLInputElement) => {
		el.value = String(Date.now() - 5000);
	});
	await page.locator('[data-test-action="signup"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openQueueAsUnverified(page: Page, email: string): Promise<void> {
	await signUpUnverified(page, email);
	await waitForBrandFonts(page, ["Inter"]);
	// Confirms we are authenticated-but-unverified before we measure or capture:
	// this copy only renders for a counting-down verification state.
	await expect(page.locator("[data-test-verify-banner]")).toContainText(
		"to keep your account active",
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

type ColourScheme = "light" | "dark";

const TEXT_FIT_VIEWPORTS = [
	{ label: "desktop", size: WIDE },
	{ label: "mobile", size: NARROW },
] as const;

interface ViewportPlacement {
	name: string;
	left: number;
	right: number;
	top: number;
}

interface VerifyBannerElementBox extends ViewportPlacement {
	scrollWidth: number;
	clientWidth: number;
}

interface VerifyBannerTextRun extends ViewportPlacement {
	contentLeft: number;
	contentRight: number;
}

interface VerifyBannerTextMeasurement {
	viewportWidth: number;
	elements: VerifyBannerElementBox[];
	textRun: VerifyBannerTextRun;
}

async function measureVerifyBannerText(page: Page): Promise<VerifyBannerTextMeasurement> {
	return page.evaluate(() => {
		const banner = document.querySelector<HTMLElement>("[data-test-verify-banner]");
		if (banner === null) {
			throw new Error("the verify banner must be rendered");
		}
		const elements = [banner, ...Array.from(banner.querySelectorAll<HTMLElement>("*"))].map(
			(element) => {
				const rect = element.getBoundingClientRect();
				return {
					name: `<${element.tagName.toLowerCase()} class="${element.className}">`,
					scrollWidth: element.scrollWidth,
					clientWidth: element.clientWidth,
					left: rect.left,
					right: rect.right,
					top: rect.top,
				};
			},
		);
		const range = document.createRange();
		range.selectNodeContents(banner);
		const textRect = range.getBoundingClientRect();
		const bannerRect = banner.getBoundingClientRect();
		const style = getComputedStyle(banner);
		return {
			viewportWidth: document.documentElement.clientWidth,
			elements,
			textRun: {
				name: "banner text run",
				left: textRect.left,
				right: textRect.right,
				top: textRect.top,
				contentLeft: bannerRect.left + Number.parseFloat(style.paddingLeft),
				contentRight: bannerRect.right - Number.parseFloat(style.paddingRight),
			},
		};
	});
}

function assertInsideViewport(
	placement: ViewportPlacement,
	viewportWidth: number,
	combination: string,
): void {
	assert.ok(
		placement.left >= -1,
		`[${combination}] ${placement.name} starts left of the viewport: left ${placement.left} < -1`,
	);
	assert.ok(
		placement.right <= viewportWidth + 1,
		`[${combination}] ${placement.name} runs past the viewport: right ${placement.right} > viewport width ${viewportWidth} + 1`,
	);
	assert.ok(
		placement.top >= -1,
		`[${combination}] ${placement.name} starts above the viewport: top ${placement.top} < -1`,
	);
}

function assertVerifyBannerTextFits(
	measurement: VerifyBannerTextMeasurement,
	combination: string,
): void {
	for (const element of measurement.elements) {
		assert.ok(
			element.scrollWidth <= element.clientWidth + 1,
			`[${combination}] ${element.name} overflows horizontally: scrollWidth ${element.scrollWidth} > clientWidth ${element.clientWidth} + 1`,
		);
		assertInsideViewport(element, measurement.viewportWidth, combination);
	}
	const { textRun } = measurement;
	assert.ok(
		textRun.left >= textRun.contentLeft - 1 && textRun.right <= textRun.contentRight + 1,
		`[${combination}] ${textRun.name} spills out of the banner: text ${textRun.left}..${textRun.right}, content box ${textRun.contentLeft}..${textRun.contentRight}`,
	);
	assertInsideViewport(textRun, measurement.viewportWidth, combination);
}

async function resizeAndSettleBanner(page: Page, size: { width: number; height: number }) {
	await page.setViewportSize(size);
	await waitForBrandFonts(page, ["Inter"]);
	await bannerAreaHeightSettled(page);
}

async function addLinkDialogFullyOpen(page: Page): Promise<void> {
	await openAddLink(page);
	await page.waitForFunction(
		() =>
			document
				.getAnimations()
				.filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
				.length === 0,
	);
}

async function closeAddLinkDialog(page: Page): Promise<void> {
	await page.keyboard.press("Escape");
	await expect(page.locator("#add-link:popover-open")).toHaveCount(0);
	await bannerAreaHeightSettled(page);
}

async function expectVerifyBannerTextFitsEveryLayout(
	page: Page,
	colourScheme: ColourScheme,
): Promise<void> {
	for (const viewport of TEXT_FIT_VIEWPORTS) {
		await resizeAndSettleBanner(page, viewport.size);
		const at = `${viewport.label} ${viewport.size.width}x${viewport.size.height}, ${colourScheme}`;
		assertVerifyBannerTextFits(await measureVerifyBannerText(page), `${at}, dialog closed`);
		await addLinkDialogFullyOpen(page);
		assertVerifyBannerTextFits(await measureVerifyBannerText(page), `${at}, dialog open`);
		await closeAddLinkDialog(page);
	}
}

const VOLATILE_CHROME = [".offline-banner", ".newer-version-banner"];

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
		await openQueueAsUnverified(
			page,
			`verify-nav-guard-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await page.setViewportSize(NARROW);
		await bannerNavSettled(page);
		await navClearsBannerGeometry(page);
	});

	test("the nav stays clear of the banner when a changelog announcement stacks above it", async ({
		page,
	}, testInfo) => {
		await page.setExtraHTTPHeaders({ [E2E_CHANGELOG_BANNER_HEADER]: "1" });
		await openQueueAsUnverified(
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
		await openQueueAsUnverified(
			page,
			`verify-nav-offline-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await narrowSoTheBannerGrows(page);
		await page.context().setOffline(true);
		await offlineNoticeFullyExpanded(page);
		await bannerNavSettledKeepingOfflineBanner(page);
		await navClearsBannerGeometry(page);
	});

	test("the public reader hides the nav, verify banner and changelog banner, and the queue shows them again", async ({
		page,
	}, testInfo) => {
		await page.setExtraHTTPHeaders({ [E2E_CHANGELOG_BANNER_HEADER]: "1" });
		await openQueueAsUnverified(
			page,
			`verify-nav-reader-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await seedArticle(page);
		await page.goto(`${BASE_URL}/view/${CANONICAL_PATH}`, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForSelector("body.page-view.page-distraction-free [data-article-body]");

		await expect(page.locator(".header")).toBeHidden();
		await expect(page.locator("[data-test-verify-banner]")).toBeHidden();
		await expect(page.locator("body > .banner-area [data-test-changelog-banner]")).toBeHidden();

		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-readlist");

		await expect(page.locator(".header")).toBeVisible();
		await expect(page.locator("[data-test-verify-banner]")).toBeVisible();
		await expect(page.locator("[data-test-changelog-banner]")).toHaveClass(/changelog-banner--visible/);
	});

	test("renders the banner above the nav (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openQueueAsUnverified(
			page,
			`verify-nav-light-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await page.setViewportSize(NARROW);
		await captureCheckpoint(page, VERIFY_BANNER_NAV_LIGHT);
	});

	test("renders the banner above the nav (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openQueueAsUnverified(
			page,
			`verify-nav-dark-${testInfo.workerIndex}-${Date.now()}@example.com`,
		);
		await page.setViewportSize(NARROW);
		await captureCheckpoint(page, VERIFY_BANNER_NAV_DARK);
	});

	for (const colourScheme of ["light", "dark"] as const) {
		test(`the banner text fits the viewport on desktop and mobile, with and without the add-link dialog (${colourScheme})`, async ({
			page,
		}, testInfo) => {
			await page.emulateMedia({ colorScheme: colourScheme });
			await page
				.context()
				.addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
			await openQueueAsUnverified(
				page,
				`verify-text-fit-${colourScheme}-${testInfo.workerIndex}-${Date.now()}@example.com`,
			);
			await expectVerifyBannerTextFitsEveryLayout(page, colourScheme);
		});
	}
});
