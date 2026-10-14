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

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TOLERANCE_PX = 1;
const READER_NAME = "James Davis";

const DESIGN_WIDTH = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const PROFILE_SECTION = '[data-test-account-section="profile"]';
const PROFILE_CARD = "[data-test-account-profile]";
const PROFILE_TEXT = `${PROFILE_CARD} .account-row__text`;
const AVATAR = "[data-test-account-profile-initials]";
const NAME_LINE = '[data-test-account-profile-line="name"]';
const EMAIL_LINE = '[data-test-account-profile-line="email"]';
const EDIT = '[data-test-action="account-profile-edit"]';
const DIALOG = '[data-test-confirm-popover="account-profile"]';
const DIALOG_FIELD = "#account-profile-name";
const DIALOG_FORM_FIELD = `${DIALOG} .form-field`;
const DIALOG_CANCEL = `${DIALOG} [data-test-action="account-profile-cancel"]`;
const DIALOG_SAVE = `${DIALOG} [data-test-action="account-profile-save"]`;
const HEADER_TRIGGER = '[data-test-nav-group="account"] summary.nav__user-summary';
const HEADER_AVATAR = `${HEADER_TRIGGER} .nav__avatar`;
const EMAIL_PINNED = [{ selector: EMAIL_LINE, text: "reader@example.com" }];
const UNNAMED_PINNED = [...EMAIL_PINNED, { selector: AVATAR, text: "RE" }];
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

function assertNear(input: { actual: number; expected: number }, message: string): void {
	assert.ok(
		Math.abs(input.actual - input.expected) <= TOLERANCE_PX,
		`${message}, measured ${input.actual} against ${input.expected}`,
	);
}

async function signIn(page: Page, stamp: string): Promise<void> {
	const email = `account-profile-${stamp}@example.com`;
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

async function openAccount(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-account");
}

async function restingPage(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function openEditDialog(page: Page): Promise<void> {
	await restingPage(page);
	await page.locator(EDIT).click();
	await page.waitForSelector(`${DIALOG}:popover-open`);
}

async function nameReader(page: Page): Promise<void> {
	await openEditDialog(page);
	await page.locator(DIALOG_FIELD).fill(READER_NAME);
	await page.locator(DIALOG_SAVE).click();
	await page.waitForSelector(NAME_LINE);
}

async function dialogOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${DIALOG}:popover-open`);
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function desktopProfileGeometry(page: Page): Promise<void> {
	const [card, avatar, edit] = await page.evaluate(measureBoxes, [PROFILE_CARD, AVATAR, EDIT]);
	assertNear({ actual: avatar.width, expected: 48 }, "the identity disc is 48px wide");
	assertNear({ actual: avatar.height, expected: 48 }, "the identity disc is 48px tall");
	assertNear({ actual: edit.height, expected: 40 }, "Edit is an M button");
	assertNear({ actual: edit.x + edit.width, expected: card.x + card.width - 25 }, "Edit ends on the card's 24px inset");
	assertNear({ actual: card.height, expected: 98 }, "the Profile card is a one-line row's 98px");
}

async function phoneProfileGeometry(page: Page): Promise<void> {
	const [card, text, edit] = await page.evaluate(measureBoxes, [PROFILE_CARD, PROFILE_TEXT, EDIT]);
	assertNear({ actual: card.x, expected: 20 }, "on a phone the Profile card starts at the 20px gutter");
	assertNear({ actual: card.x + card.width, expected: PHONE.width - 20 }, "on a phone the Profile card ends at the 20px gutter");
	assertNear({ actual: edit.x, expected: card.x + 25 }, "on a phone Edit starts on the card's 24px inset");
	assertNear({ actual: edit.y - (text.y + text.height), expected: 16 }, "on a phone Edit drops 16px under the name and email");
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the account page must not scroll sideways on a phone");
}

async function dialogGeometry(
	page: Page,
	input: { width: number },
): Promise<{ field: MeasuredBox; cancel: MeasuredBox; save: MeasuredBox }> {
	await expect(page.locator(DIALOG_FIELD)).toHaveValue(READER_NAME);
	const [panel, field, cancel, save] = await page.evaluate(measureBoxes, [DIALOG, DIALOG_FORM_FIELD, DIALOG_CANCEL, DIALOG_SAVE]);
	assertNear({ actual: panel.width, expected: input.width }, "the Edit profile dialog takes the shared panel's width");
	for (const part of [field, cancel, save]) {
		assert.ok(part.x >= panel.x && part.x + part.width <= panel.x + panel.width, "every part of the dialog sits inside its panel");
	}
	return { field, cancel, save };
}

async function desktopDialogGeometry(page: Page): Promise<void> {
	const { field, cancel, save } = await dialogGeometry(page, { width: 600 });
	assertNear({ actual: cancel.y, expected: save.y }, "Cancel and Save share one row");
	assert.ok(cancel.x + cancel.width < save.x, "Cancel comes before Save");
	assertNear({ actual: save.x + save.width, expected: field.x + field.width }, "the buttons end on the field's right edge");
	assertNear({ actual: cancel.y - (field.y + field.height), expected: 24 }, "the buttons sit 24px under the field");
	assertNear({ actual: save.height, expected: 48 }, "the dialog's buttons are L buttons");
}

async function phoneDialogGeometry(page: Page): Promise<void> {
	const { field, cancel, save } = await dialogGeometry(page, { width: PHONE.width - 32 });
	assert.ok(save.y + save.height <= cancel.y, "on a phone Save stacks above Cancel");
	for (const button of [cancel, save]) {
		assertNear({ actual: button.width, expected: field.width }, "on a phone the dialog's buttons span the field's width");
	}
}

async function headerTriggerGeometry(page: Page): Promise<void> {
	const avatar = await measuredBox(page, HEADER_AVATAR);
	assertNear({ actual: avatar.width, expected: 24 }, "the header's initials disc is 24px wide");
	assertNear({ actual: avatar.height, expected: 24 }, "the header's initials disc is 24px tall");
	await expect(page.locator(`${HEADER_TRIGGER} [data-test-nav-user-name]`)).toHaveText(READER_NAME);
	await expect(page.locator(HEADER_AVATAR)).toHaveText("JD");
}

function profileCheckpoint(input: {
	name: string;
	geometry: (page: Page) => Promise<void>;
	pinnedText: VisualCheckpoint["pinnedText"];
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: restingPage,
		geometry: input.geometry,
		target: PROFILE_SECTION,
		capture: "element",
		pinnedText: input.pinnedText,
	};
}

function dialogCheckpoint(input: { name: string; geometry: (page: Page) => Promise<void> }): VisualCheckpoint {
	return {
		name: input.name,
		settled: dialogOpen,
		geometry: input.geometry,
		target: DIALOG,
		capture: "element",
		pinnedText: EMAIL_PINNED,
	};
}

function headerCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: restingPage,
		geometry: headerTriggerGeometry,
		target: HEADER_TRIGGER,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Account Profile row at the design width", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH });

	test("titles the unnamed row with the email and its initials, with Edit on the right", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `unnamed-${testInfo.workerIndex}-${Date.now()}`);
		await openAccount(page);
		await captureCheckpoint(
			page,
			profileCheckpoint({ name: "account-profile-unnamed-light", geometry: desktopProfileGeometry, pinnedText: UNNAMED_PINNED }),
		);
	});

	for (const theme of ["light", "dark"] as const) {
		test(`titles the row with the name saved through Edit, over the email (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, `named-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await openAccount(page);
			await nameReader(page);
			await captureCheckpoint(
				page,
				profileCheckpoint({ name: `account-profile-named-${theme}`, geometry: desktopProfileGeometry, pinnedText: EMAIL_PINNED }),
			);
		});

		test(`opens Edit profile with the saved name in its one field (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, `dialog-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await openAccount(page);
			await nameReader(page);
			await openEditDialog(page);
			await captureCheckpoint(page, dialogCheckpoint({ name: `account-profile-edit-dialog-${theme}`, geometry: desktopDialogGeometry }));
			await page.keyboard.press("Escape");
			await expect(page.locator(`${DIALOG}:popover-open`)).toHaveCount(0);
		});

		test(`names the reader in the header's account trigger (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, `header-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await openAccount(page);
			await nameReader(page);
			await captureCheckpoint(page, headerCheckpoint(`header-account-trigger-named-${theme}`));
		});
	}
});

test.describe("Account Profile row on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("drops Edit under the name and email", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `named-phone-${testInfo.workerIndex}-${Date.now()}`);
		await openAccount(page);
		await nameReader(page);
		await captureCheckpoint(
			page,
			profileCheckpoint({ name: "account-profile-named-phone", geometry: phoneProfileGeometry, pinnedText: EMAIL_PINNED }),
		);
	});

	test("stacks the Edit profile dialog's buttons with Save on top", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, `dialog-phone-${testInfo.workerIndex}-${Date.now()}`);
		await openAccount(page);
		await nameReader(page);
		await openEditDialog(page);
		await captureCheckpoint(page, dialogCheckpoint({ name: "account-profile-edit-dialog-phone", geometry: phoneDialogGeometry }));
	});
});

test.describe("Account Profile row in greyscale", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH });

	test("keeps the named row's contrast in greyscale", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
		await signIn(page, `eink-${testInfo.workerIndex}-${Date.now()}`);
		await openAccount(page);
		await nameReader(page);
		await restingPage(page);
		await page.evaluate((pin) => {
			const emailLine = document.querySelector(pin.selector);
			if (!emailLine) throw new Error("the Profile row must name the signed-in address");
			emailLine.textContent = pin.text;
		}, EMAIL_PINNED[0]);
		let previous = "";
		await expect
			.poll(async () => {
				const current = JSON.stringify(await measuredBox(page, PROFILE_SECTION));
				const stable = current === previous;
				previous = current;
				return stable;
			})
			.toBe(true);
		await desktopProfileGeometry(page);
		await snapToWholePixels(page, PROFILE_SECTION);

		await expect(page.locator(PROFILE_SECTION)).toHaveScreenshot("eink-account-profile-named-light.png", CONTRAST_SENSITIVE);
	});
});
