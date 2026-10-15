import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	snapToWholePixels,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { type MeasuredBox, measureBoxes, neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";
import { seedChromeGrant } from "./oauth-revoke/seed-grant";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TOLERANCE_PX = 1;

const DESIGN_WIDTH = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const NARROWEST_PHONE = { width: 320, height: 844 };
const EINK_VIEWPORT = { width: 758, height: 1024 };

const SECTION = "#connected-apps";
const CARD = `${SECTION} .account-section__card`;
const CHROME_ROW = `${SECTION} [data-test-connected-app-client="hutch-chrome-extension"]`;
const CHROME_WELL = `${CHROME_ROW} .account-row__icon`;
const CHROME_LOGO = `${CHROME_WELL} svg`;
const CHROME_TEXT = `${CHROME_ROW} .account-row__text`;
const DISCONNECT = `${CHROME_ROW} [data-test-action="disconnect-app-open"]`;
const EMPTY_ROW = `${SECTION} [data-test-connected-app="empty"]`;
const EMPTY_WELL = `${EMPTY_ROW} .account-row__icon`;
const SEE_WAYS_TO_SAVE = `${EMPTY_ROW} [data-test-connected-app-action="see-ways-to-save"]`;
const DIALOG = '[data-test-confirm-popover="disconnect-app"]';
const DIALOG_CANCEL = `${DIALOG} [data-test-action="disconnect-app-cancel"]`;
const DIALOG_COMMIT = `${DIALOG} [data-test-action="disconnect-app-confirm"]`;
const IDENTITY_PINNED = [
	{ selector: '[data-test-account-profile-line="email"]', text: "reader@example.com" },
	{ selector: "[data-test-account-profile-initials]", text: "RE" },
	{ selector: "[data-test-password-updated]", text: "6 months ago" },
];
const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];
const CONTRAST_SENSITIVE = {
	stylePath: join(__dirname, "eink-greyscale.css"),
	threshold: 0.02,
} as const;

function assertNear(input: { actual: number; expected: number; tolerance?: number }, message: string): void {
	const tolerance = input.tolerance ?? TOLERANCE_PX;
	assert.ok(
		Math.abs(input.actual - input.expected) <= tolerance,
		`${message}, measured ${input.actual} against ${input.expected}`,
	);
}

async function signIn(page: Page, input: { stamp: string; grants: "chrome" | "none" }): Promise<void> {
	const email = `account-connected-apps-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	if (input.grants === "chrome") await seedChromeGrant(page.request, BASE_URL);
}

async function openAccount(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-account");
}

async function restingPage(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function openDisconnectDialog(page: Page): Promise<void> {
	await restingPage(page);
	await page.locator(DISCONNECT).click();
	await page.waitForSelector(`${DIALOG}:popover-open`);
}

async function dialogOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${DIALOG}:popover-open`);
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function roundWell(page: Page, well: string): Promise<MeasuredBox> {
	const box = await measuredBox(page, well);
	assertNear({ actual: box.width, expected: 48 }, "the logo well is 48px wide");
	assertNear({ actual: box.height, expected: 48 }, "the logo well is 48px tall");
	await expect(page.locator(well)).toHaveCSS("border-radius", "50%");
	return box;
}

async function chromeRowGeometry(page: Page): Promise<{ card: MeasuredBox; well: MeasuredBox; text: MeasuredBox; disconnect: MeasuredBox }> {
	await expect(page.locator(SECTION)).toHaveAttribute("data-test-connected-apps-state", "listed");
	const well = await roundWell(page, CHROME_WELL);
	const [card, logo, text, disconnect] = await page.evaluate(measureBoxes, [CARD, CHROME_LOGO, CHROME_TEXT, DISCONNECT]);
	assertNear({ actual: logo.width, expected: 20 }, "the Chrome logo is 20px wide");
	assertNear({ actual: logo.height, expected: 20 }, "the Chrome logo is 20px tall");
	assertNear({ actual: logo.x + logo.width / 2, expected: well.x + well.width / 2 }, "the Chrome logo is centred across its well");
	assertNear({ actual: logo.y + logo.height / 2, expected: well.y + well.height / 2 }, "the Chrome logo is centred down its well");
	assertNear({ actual: disconnect.height, expected: 40 }, "Disconnect is an M button");
	return { card, well, text, disconnect };
}

function assertDesignColumn(card: MeasuredBox): void {
	assertNear({ actual: card.x, expected: 280 }, "the Connected apps card starts on the 880px column's left edge");
	assertNear({ actual: card.x + card.width, expected: 1160 }, "the Connected apps card ends on the 880px column's right edge");
}

async function desktopListedGeometry(page: Page): Promise<void> {
	const { card, well, text, disconnect } = await chromeRowGeometry(page);
	assertDesignColumn(card);
	assertNear({ actual: disconnect.x + disconnect.width, expected: card.x + card.width - 25 }, "Disconnect ends on the card's 24px inset");
	assertNear(
		{ actual: text.y + text.height / 2, expected: well.y + well.height / 2, tolerance: 2 },
		"the name and description are centred on the well",
	);
}

async function phoneListedGeometry(page: Page): Promise<void> {
	const { card, well, text, disconnect } = await chromeRowGeometry(page);
	assertNear({ actual: card.x, expected: 20 }, "on a phone the Connected apps card starts at the 20px gutter");
	assertNear({ actual: card.x + card.width, expected: PHONE.width - 20 }, "on a phone the Connected apps card ends at the 20px gutter");
	assertNear({ actual: disconnect.x, expected: card.x + 25 }, "on a phone Disconnect starts on the card's 24px inset");
	assertNear(
		{ actual: disconnect.y - Math.max(text.y + text.height, well.y + well.height), expected: 16 },
		"on a phone Disconnect drops 16px under the name and description",
	);
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the account page must not scroll sideways on a phone");
}

async function narrowestPhoneGeometry(page: Page): Promise<void> {
	const { card, disconnect } = await chromeRowGeometry(page);
	assertNear({ actual: card.x, expected: 20 }, "on the narrowest phone the Connected apps card starts at the 20px gutter");
	assertNear(
		{ actual: card.x + card.width, expected: NARROWEST_PHONE.width - 20 },
		"on the narrowest phone the Connected apps card ends at the 20px gutter",
	);
	assertNear({ actual: disconnect.x, expected: card.x + 25 }, "on the narrowest phone Disconnect starts on the card's 24px inset");
	assert.ok(disconnect.x + disconnect.width <= card.x + card.width - 25, "on the narrowest phone Disconnect stays inside the card");
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the account page must not scroll sideways on the narrowest phone");
}

async function emptyGeometry(page: Page): Promise<void> {
	await expect(page.locator(SECTION)).toHaveAttribute("data-test-connected-apps-state", "empty");
	await roundWell(page, EMPTY_WELL);
	const [card, link] = await page.evaluate(measureBoxes, [CARD, SEE_WAYS_TO_SAVE]);
	assertDesignColumn(card);
	assertNear({ actual: link.height, expected: 40 }, "See ways to save is an M button");
	assertNear({ actual: link.x + link.width, expected: card.x + card.width - 25 }, "See ways to save ends on the card's 24px inset");
}

async function dialogGeometry(page: Page, input: { width: number }): Promise<{ panel: MeasuredBox; cancel: MeasuredBox; commit: MeasuredBox }> {
	await expect(page.locator(`${DIALOG}:popover-open`)).toHaveAttribute("data-test-confirm-subject", "hutch-chrome-extension");
	const [panel, cancel, commit] = await page.evaluate(measureBoxes, [DIALOG, DIALOG_CANCEL, DIALOG_COMMIT]);
	assertNear({ actual: panel.width, expected: input.width }, "the Disconnect dialog takes the shared panel's width");
	for (const part of [cancel, commit]) {
		assert.ok(part.x >= panel.x && part.x + part.width <= panel.x + panel.width, "every part of the dialog sits inside its panel");
	}
	return { panel, cancel, commit };
}

async function desktopDialogGeometry(page: Page): Promise<void> {
	const { panel, cancel, commit } = await dialogGeometry(page, { width: 600 });
	assertNear({ actual: cancel.y, expected: commit.y }, "Cancel and Disconnect share one row");
	assertNear({ actual: commit.x - (cancel.x + cancel.width), expected: 8 }, "Cancel sits 8px before Disconnect");
	assertNear({ actual: commit.x + commit.width, expected: panel.x + panel.width - 33 }, "the buttons end on the panel's 32px padding");
}

async function phoneDialogGeometry(page: Page): Promise<void> {
	const { panel, cancel, commit } = await dialogGeometry(page, { width: PHONE.width - 32 });
	assert.ok(commit.y + commit.height <= cancel.y, "on a phone Disconnect stacks above Cancel");
	for (const button of [cancel, commit]) {
		assertNear({ actual: button.width, expected: panel.width - 50 }, "on a phone the dialog's buttons span the panel's padded width");
	}
}

function sectionCheckpoint(input: { name: string; geometry: (page: Page) => Promise<void> }): VisualCheckpoint {
	return {
		name: input.name,
		settled: restingPage,
		geometry: input.geometry,
		target: SECTION,
		capture: "element",
		pinnedText: [],
	};
}

function dialogCheckpoint(input: { name: string; geometry: (page: Page) => Promise<void> }): VisualCheckpoint {
	return {
		name: input.name,
		settled: dialogOpen,
		geometry: input.geometry,
		target: DIALOG,
		capture: "element",
		pinnedText: IDENTITY_PINNED,
	};
}

test.describe("Account Connected apps at the design width", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH });

	for (const theme of ["light", "dark"] as const) {
		test(`lists the Chrome extension with its logo in the well and Disconnect on the right (${theme})`, async ({
			page,
		}, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, { stamp: `listed-${theme}-${testInfo.workerIndex}-${Date.now()}`, grants: "chrome" });
			await openAccount(page);
			await captureCheckpoint(page, sectionCheckpoint({ name: `account-connected-apps-${theme}`, geometry: desktopListedGeometry }));
		});

		test(`asks before it disconnects the Chrome extension (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, { stamp: `dialog-${theme}-${testInfo.workerIndex}-${Date.now()}`, grants: "chrome" });
			await openAccount(page);
			await openDisconnectDialog(page);
			await captureCheckpoint(page, dialogCheckpoint({ name: `account-disconnect-dialog-${theme}`, geometry: desktopDialogGeometry }));
		});
	}

	test("keeps one row that says how the section fills when nothing is connected", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `empty-${testInfo.workerIndex}-${Date.now()}`, grants: "none" });
		await openAccount(page);
		await captureCheckpoint(page, sectionCheckpoint({ name: "account-connected-apps-empty-light", geometry: emptyGeometry }));
	});
});

test.describe("Account Connected apps on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("drops Disconnect under the app's name and description", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `listed-phone-${testInfo.workerIndex}-${Date.now()}`, grants: "chrome" });
		await openAccount(page);
		await captureCheckpoint(page, sectionCheckpoint({ name: "account-connected-apps-phone", geometry: phoneListedGeometry }));
	});

	test("stacks the Disconnect dialog's buttons with Disconnect on top", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `dialog-phone-${testInfo.workerIndex}-${Date.now()}`, grants: "chrome" });
		await openAccount(page);
		await openDisconnectDialog(page);
		await captureCheckpoint(page, dialogCheckpoint({ name: "account-disconnect-dialog-phone", geometry: phoneDialogGeometry }));
	});
});

test.describe("Account Connected apps on the narrowest phone", () => {
	test.use({ timezoneId: "UTC", viewport: NARROWEST_PHONE });

	test("keeps Disconnect inside the card without scrolling sideways", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `listed-narrowest-${testInfo.workerIndex}-${Date.now()}`, grants: "chrome" });
		await openAccount(page);
		await restingPage(page);
		await narrowestPhoneGeometry(page);
	});
});

test.describe("Account Connected apps in greyscale", () => {
	test.use({ timezoneId: "UTC", viewport: EINK_VIEWPORT });

	test("keeps the listed row's contrast in greyscale", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
		await signIn(page, { stamp: `eink-${testInfo.workerIndex}-${Date.now()}`, grants: "chrome" });
		await openAccount(page);
		await restingPage(page);
		let previous = "";
		await expect
			.poll(async () => {
				const current = JSON.stringify(await measuredBox(page, SECTION));
				const stable = current === previous;
				previous = current;
				return stable;
			})
			.toBe(true);
		await chromeRowGeometry(page);
		await snapToWholePixels(page, SECTION);

		await expect(page.locator(SECTION)).toHaveScreenshot("eink-account-connected-apps-light.png", CONTRAST_SENSITIVE);
	});
});
