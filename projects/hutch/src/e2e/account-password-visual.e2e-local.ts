import assert from "node:assert/strict";
import type { Page, Route } from "@playwright/test";
import { captureCheckpoint, expect, test, type VisualCheckpoint, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { measureBoxes, neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";
import { readScrollY } from "./readlist-reader-skeleton.browser";
import { maxScrollY, recordScrollAfterSwap, scrollUnderHeader } from "./readlist-scroll-stability.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const NEW_PASSWORD = "a-brand-new-password";
const WRONG_PASSWORD = "not-the-current-password";
const TOLERANCE_PX = 1;

const DESIGN_WIDTH = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const SECURITY_SECTION = '[data-test-account-section="security"]';
const SECURITY_CARD = "[data-test-account-security]";
const SECURITY_WELL = `${SECURITY_CARD} .account-row__icon`;
const CHANGE_ACTION = '[data-test-action="account-change-password"]';
const UPDATED = "[data-test-password-updated]";
const CHANGED_ALERT = '[data-test-alert="password-changed"]';
const CHANGE_CARD = "#change-password-card";
const CHANGE_FORM = '[data-test-form="change-password"]';
const CHANGE_SUBMIT = '[data-test-action="change-password"]';
const CURRENT_FIELD = "#currentPassword";
const NEW_FIELD = "#password";
const CONFIRM_FIELD = "#confirmPassword";
const PASSWORD_FIELDS = [CURRENT_FIELD, NEW_FIELD, CONFIRM_FIELD];
const CURRENT_ERROR = '[data-test-error="currentPassword"]';
const FAILURE_LINE = "[data-test-change-password-failure]";
const APP_BACK_LINK = "[data-test-account-back-link]";
const HTMX_IN_MOTION = ".htmx-request, .htmx-swapping, .htmx-settling";
const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];
const SIX_MONTHS_PINNED = [{ selector: UPDATED, text: "6 months ago" }];
const JUST_NOW_PINNED = [{ selector: UPDATED, text: "just now" }];

function assertNear(input: { actual: number; expected: number; tolerance?: number }, message: string): void {
	const tolerance = input.tolerance ?? TOLERANCE_PX;
	assert.ok(
		Math.abs(input.actual - input.expected) <= tolerance,
		`${message}, measured ${input.actual} against ${input.expected}`,
	);
}

async function signIn(page: Page, stamp: string): Promise<void> {
	const email = `account-password-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openAccount(page: Page, query = ""): Promise<void> {
	await page.goto(`${BASE_URL}/account${query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-account");
}

async function openChangePage(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/account/password`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-change-password");
}

async function restingPage(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function swapSettled(page: Page): Promise<void> {
	await expect(page.locator(HTMX_IN_MOTION)).toHaveCount(0);
}

async function clickCentre(page: Page, selector: string): Promise<void> {
	const box = await page.locator(selector).boundingBox();
	assert(box, `${selector} must be laid out to be clicked`);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

function changePosts(page: Page): string[] {
	const posted: string[] = [];
	page.on("request", (request) => {
		const { pathname } = new URL(request.url());
		if (request.method() === "POST" && pathname === "/account/password") posted.push(pathname);
	});
	return posted;
}

async function fillChange(page: Page, input: { current: string }): Promise<void> {
	await page.locator(CURRENT_FIELD).fill(input.current);
	await page.locator(NEW_FIELD).fill(NEW_PASSWORD);
	await page.locator(CONFIRM_FIELD).fill(NEW_PASSWORD);
}

async function refuseWrongCurrent(page: Page): Promise<void> {
	await fillChange(page, { current: WRONG_PASSWORD });
	await clickCentre(page, CHANGE_SUBMIT);
	await expect(page.locator(CURRENT_ERROR)).toHaveText("Current password is incorrect");
	await swapSettled(page);
}

async function openChangeFromAccount(page: Page): Promise<void> {
	await openAccount(page);
	await clickCentre(page, CHANGE_ACTION);
	await expect(page.locator(CHANGE_FORM)).toBeVisible();
	await swapSettled(page);
}

async function changeFromAccount(page: Page): Promise<void> {
	await clickCentre(page, CHANGE_ACTION);
	await expect(page.locator(CHANGE_FORM)).toBeVisible();
	await swapSettled(page);
	await fillChange(page, { current: PASSWORD });
	await clickCentre(page, CHANGE_SUBMIT);
	await expect(page.locator(CHANGED_ALERT)).toHaveClass(/alert--visible/);
}

async function desktopRowGeometry(page: Page): Promise<void> {
	const [card, well, action] = await page.evaluate(measureBoxes, [SECURITY_CARD, SECURITY_WELL, CHANGE_ACTION]);
	assertNear({ actual: card.height, expected: 98, tolerance: 0.5 }, "the Security card is a one-line row's 98px");
	assertNear({ actual: card.x + card.width, expected: 1160 }, "the Security card ends on the 880px column's right edge");
	assertNear({ actual: well.width, expected: 48, tolerance: 0.5 }, "the lock well is 48px wide");
	assertNear({ actual: well.height, expected: 48, tolerance: 0.5 }, "the lock well is 48px tall");
	assertNear({ actual: action.height, expected: 40, tolerance: 0.5 }, "Change password is an M button");
	assertNear({ actual: action.x + action.width, expected: card.x + card.width - 25 }, "Change password ends on the card's 24px inset");
}

async function phoneRowGeometry(page: Page): Promise<void> {
	const [card, action] = await page.evaluate(measureBoxes, [SECURITY_CARD, CHANGE_ACTION]);
	assert.ok(
		action.x >= card.x && action.x + action.width <= card.x + card.width,
		"on a phone Change password sits inside its card",
	);
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the account page must not scroll sideways on a phone");
}

async function changedGeometry(page: Page): Promise<void> {
	await desktopRowGeometry(page);
	const [alert, card] = await page.evaluate(measureBoxes, [CHANGED_ALERT, SECURITY_CARD]);
	assertNear({ actual: card.y - (alert.y + alert.height), expected: 12 }, "the confirmation sits 12px above the Security card");
}

async function changePageGeometry(page: Page): Promise<void> {
	const [card, ...inputs] = await page.evaluate(measureBoxes, [CHANGE_CARD, ...PASSWORD_FIELDS]);
	assert.ok(card.width <= 480, `the change card keeps the auth card's 480px cap, measured ${card.width}`);
	const [first] = inputs;
	for (const input of inputs) {
		assertNear({ actual: input.x, expected: first.x }, "the password fields share a left edge");
		assertNear({ actual: input.width, expected: first.width }, "the password fields share a width");
	}
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the change page must not scroll sideways");
}

async function errorGeometry(page: Page): Promise<void> {
	await changePageGeometry(page);
	await expect(page.locator(CURRENT_FIELD)).toHaveAttribute("aria-invalid", "true");
	const [field, error] = await page.evaluate(measureBoxes, [CURRENT_FIELD, CURRENT_ERROR]);
	assertNear({ actual: error.x, expected: field.x }, "the error starts on the current-password field's left edge");
	assertNear({ actual: error.y - (field.y + field.height), expected: 8 }, "the error sits 8px under the current-password field");
}

function securityCheckpoint(input: {
	name: string;
	geometry: (page: Page) => Promise<void>;
	pinnedText: VisualCheckpoint["pinnedText"];
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: restingPage,
		geometry: input.geometry,
		target: SECURITY_SECTION,
		capture: "element",
		pinnedText: input.pinnedText,
	};
}

function changeCardCheckpoint(input: { name: string; geometry: (page: Page) => Promise<void> }): VisualCheckpoint {
	return {
		name: input.name,
		settled: restingPage,
		geometry: input.geometry,
		target: CHANGE_CARD,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Account Security row at the design width", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH });

	for (const theme of ["light", "dark"] as const) {
		test(`shows the Password row with when it last changed and Change password on the right (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, `row-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await openAccount(page);
			await captureCheckpoint(
				page,
				securityCheckpoint({ name: `account-security-row-${theme}`, geometry: desktopRowGeometry, pinnedText: SIX_MONTHS_PINNED }),
			);
		});
	}

	test("confirms a change made through the page with a success alert over the row", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `changed-${testInfo.workerIndex}-${Date.now()}`);
		await openAccount(page);
		await restingPage(page);
		await changeFromAccount(page);
		await captureCheckpoint(
			page,
			securityCheckpoint({ name: "account-password-changed-light", geometry: changedGeometry, pinnedText: JUST_NOW_PINNED }),
		);
	});
});

test.describe("Account Security row on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("drops Change password under the row's text", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `row-phone-${testInfo.workerIndex}-${Date.now()}`);
		await openAccount(page);
		await captureCheckpoint(
			page,
			securityCheckpoint({ name: "account-security-row-phone", geometry: phoneRowGeometry, pinnedText: SIX_MONTHS_PINNED }),
		);
	});
});

test.describe("Change password page", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH });

	for (const theme of ["light", "dark"] as const) {
		test(`asks for the current password and the new one twice (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, `page-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await openChangePage(page);
			await captureCheckpoint(page, changeCardCheckpoint({ name: `change-password-page-${theme}`, geometry: changePageGeometry }));
		});
	}

	test("keeps Change password in flight and drops a second press until the account page lands", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `landing-${testInfo.workerIndex}-${Date.now()}`);
		await openChangePage(page);
		const posted = changePosts(page);
		let releaseLanding: (() => void) | undefined;
		const landingHeld = new Promise<void>((resolve) => {
			releaseLanding = resolve;
		});
		await page.route(
			(url) => url.pathname === "/account",
			async (route) => {
				await landingHeld;
				await route.continue();
			},
		);
		const landingRequested = page.waitForRequest((request) => new URL(request.url()).pathname === "/account");

		await fillChange(page, { current: PASSWORD });
		await clickCentre(page, CHANGE_SUBMIT);
		await landingRequested;

		await expect(page.locator(CHANGE_CARD)).toHaveClass(/htmx-request/);
		await expect(page.locator(`${CHANGE_SUBMIT} .auth-form__submit-label`)).toBeHidden();
		await expect(page.locator(`${CHANGE_SUBMIT} .auth-form__loader`)).toBeVisible();
		await expect(page.locator(CHANGE_SUBMIT)).toHaveCSS("cursor", "progress");
		await clickCentre(page, CHANGE_SUBMIT);
		assert(releaseLanding, "the held landing must expose its release");
		releaseLanding();

		await expect(page.locator(CHANGED_ALERT)).toHaveClass(/alert--visible/);
		expect(posted).toEqual(["/account/password"]);
	});

	const FAILED_ANSWERS = [
		{
			answer: "a 503",
			entry: "opened directly",
			open: openChangePage,
			fail: (route: Route) => route.fulfill({ status: 503, body: "" }),
		},
		{
			answer: "no answer",
			entry: "reached from the account page",
			open: openChangeFromAccount,
			fail: (route: Route) => route.abort("internetdisconnected"),
		},
	];
	for (const { answer, entry, open, fail } of FAILED_ANSWERS) {
		test(`shows a failure line and keeps the form when the change gets ${answer}, ${entry}`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: "light" });
			await signIn(page, `failure-${testInfo.workerIndex}-${Date.now()}`);
			await open(page);
			await page.route(
				(url) => url.pathname === "/account/password",
				(route) => (route.request().method() === "POST" ? fail(route) : route.continue()),
			);

			await fillChange(page, { current: PASSWORD });
			await clickCentre(page, CHANGE_SUBMIT);

			await expect(page.locator(FAILURE_LINE)).toHaveText("Couldn't change your password.");
			await swapSettled(page);
			await expect(page.locator(CHANGE_SUBMIT)).toBeEnabled();
			await expect(page.locator(NEW_FIELD)).toHaveValue(NEW_PASSWORD);
		});
	}

	test("refuses a wrong current password in place, under its field", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `error-${testInfo.workerIndex}-${Date.now()}`);
		await openChangePage(page);
		await restingPage(page);
		await refuseWrongCurrent(page);
		await captureCheckpoint(page, changeCardCheckpoint({ name: "change-password-error-light", geometry: errorGeometry }));
	});
});

test.describe("Change password page on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("fits the card inside the phone's gutters", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `page-phone-${testInfo.workerIndex}-${Date.now()}`);
		await openChangePage(page);
		await captureCheckpoint(page, changeCardCheckpoint({ name: "change-password-page-phone", geometry: changePageGeometry }));
	});

	test("changes the password inside the app sheet without leaving it", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `app-sheet-${testInfo.workerIndex}-${Date.now()}`);
		await openAccount(page, "?platform=ios&shell=app");
		await expect(page.locator("body")).toHaveClass(/page-account--chromeless/);

		await clickCentre(page, CHANGE_ACTION);
		await expect(page.locator(CHANGE_FORM)).toBeVisible();
		await swapSettled(page);
		await expect(page.locator("body")).toHaveClass(/page-account--chromeless/);
		await expect(page.locator(".header")).toHaveCount(0);

		await refuseWrongCurrent(page);
		await expect(page.locator("body")).toHaveClass(/page-account--chromeless/);

		await fillChange(page, { current: PASSWORD });
		await clickCentre(page, CHANGE_SUBMIT);
		await expect(page.locator(CHANGED_ALERT)).toHaveClass(/alert--visible/);
		await expect(page).toHaveURL(`${BASE_URL}/account?password=changed&platform=ios&shell=app`);
		await expect(page.locator(APP_BACK_LINK)).toBeVisible();
		await expect(page.locator(".header")).toHaveCount(0);
		await expect(page.locator("body")).toHaveClass(/page-account--chromeless/);
	});

	test("lands each step where the reader expects: the top for a new page, the refused field for an error", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `scroll-${testInfo.workerIndex}-${Date.now()}`);
		await openAccount(page);
		await restingPage(page);

		await page.evaluate(scrollUnderHeader, SECURITY_SECTION);
		expect(await page.evaluate(readScrollY)).toBeGreaterThan(0);
		await page.evaluate(recordScrollAfterSwap, CHANGE_ACTION);
		await clickCentre(page, CHANGE_ACTION);
		await expect(page.locator(CHANGE_FORM)).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-test-scroll-after-swap", "0");

		const bottom = await page.evaluate(maxScrollY);
		await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), bottom);
		await refuseWrongCurrent(page);
		await expect(page.locator(CURRENT_FIELD)).toBeFocused();
		await expect(page.locator(CURRENT_FIELD)).toBeInViewport();

		await fillChange(page, { current: PASSWORD });
		await page.evaluate(() => document.documentElement.removeAttribute("data-test-scroll-after-swap"));
		await page.evaluate(recordScrollAfterSwap, CHANGE_SUBMIT);
		await clickCentre(page, CHANGE_SUBMIT);
		await expect(page.locator(CHANGED_ALERT)).toHaveClass(/alert--visible/);
		await expect(page.locator("html")).toHaveAttribute("data-test-scroll-after-swap", "0");
	});
});
