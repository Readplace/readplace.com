import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { type MeasuredBox, measureBoxes, neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TOLERANCE_PX = 1;

const DESIGN_WIDTH = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const MAIN = "main.account";
const TITLE = ".account__title";
const SECTION = "[data-test-account-section]";
const CARDS = `${MAIN} .account-section__card, ${MAIN} [data-test-account-card], ${MAIN} [data-test-cards-section]`;
const DATA_CARD = "[data-test-account-export]";
const THEME_ROW = "[data-test-account-appearance] .account-row";
const THEME_OPTION = "[data-test-appearance-option]";
const APPEARANCE_SECTION = '[data-test-account-section="appearance"]';
const DANGER_SECTION = '[data-test-account-section="danger"]';
const DANGER_CARD = "[data-test-account-danger]";
const DANGER_OPEN = "[data-test-danger-open]";
const DIALOG = '[data-test-confirm-popover="delete-account"]';
const DIALOG_FIELD = `${DIALOG} .form-field`;
const DIALOG_CANCEL = `${DIALOG} [data-test-action="delete-account-cancel"]`;
const DIALOG_COMMIT = `${DIALOG} [data-test-action="delete-account-confirm"]`;
const INLINE_FORM = '[data-test-danger-form="inline"]';
const BACK_LINK = "[data-test-account-back-link]";
const EMAIL_PINNED = [{ selector: "[data-test-account-email] strong", text: "reader@example.com" }];
const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

function assertNear(input: { actual: number; expected: number }, message: string): void {
	assert.ok(
		Math.abs(input.actual - input.expected) <= TOLERANCE_PX,
		`${message}, measured ${input.actual} against ${input.expected}`,
	);
}

async function signIn(page: Page, input: { stamp: string; state?: "inactive" }): Promise<void> {
	const email = `account-visual-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	if (input.state) {
		const { userId } = CreatedUser.parse(await created.json());
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
			data: { userId, state: input.state },
		});
		assert.equal(seeded.status(), 201, "the subscription-state seed endpoint must answer 201");
	}
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

async function restingPage(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function openDeleteDialog(page: Page): Promise<void> {
	await restingPage(page);
	await page.locator(DANGER_OPEN).click();
	await page.waitForSelector(`${DIALOG}:popover-open`);
}

async function dialogOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${DIALOG}:popover-open`);
	await page.mouse.move(5, 5);
	await waitForBrandFonts(page, ["Inter"]);
}

async function boxesOf(page: Page, selector: string): Promise<MeasuredBox[]> {
	return page.locator(selector).evaluateAll((elements) =>
		elements.map((element) => {
			const { x, y, width, height } = element.getBoundingClientRect();
			return { x, y, width, height };
		}),
	);
}

async function sectionRhythm(page: Page): Promise<void> {
	const sections = await page.locator(SECTION).evaluateAll((elements) =>
		elements.map((section) => {
			const heading = section.querySelector(".account-section__heading");
			const card = heading?.nextElementSibling;
			if (!heading || !card) throw new Error("every account section must open with its heading over a card");
			const box = section.getBoundingClientRect();
			return {
				top: box.top,
				bottom: box.bottom,
				headingBottom: heading.getBoundingClientRect().bottom,
				cardTop: card.getBoundingClientRect().top,
			};
		}),
	);
	assert.equal(sections.length, 4, "the account page renders four sections");
	for (const [index, section] of sections.entries()) {
		assertNear({ actual: section.cardTop - section.headingBottom, expected: 12 }, `section ${index}'s heading sits 12px above its card`);
		const next = sections[index + 1];
		if (next) assertNear({ actual: next.top - section.bottom, expected: 24 }, `sections ${index} and ${index + 1} sit 24px apart`);
	}
}

async function rowAnatomy(page: Page, input: { cardRight: number }): Promise<void> {
	const rows = await page.locator(`${MAIN} .account-row`).evaluateAll((elements) =>
		elements.map((row) => {
			const part = (selector: string) => {
				const element = row.querySelector(selector);
				if (!element) throw new Error(`every settings row must render its ${selector}`);
				const { x, y, width, height } = element.getBoundingClientRect();
				return { x, y, width, height };
			};
			const { x, y, width, height } = row.getBoundingClientRect();
			return { row: { x, y, width, height }, icon: part(".account-row__icon"), text: part(".account-row__text"), actions: part(".account-row__actions") };
		}),
	);
	assert.equal(rows.length, 3, "Theme, Your data and Danger zone each draw one row");
	for (const [index, { row, icon, text, actions }] of rows.entries()) {
		assertNear({ actual: icon.width, expected: 48 }, `row ${index}'s icon well is 48px wide`);
		assertNear({ actual: icon.height, expected: 48 }, `row ${index}'s icon well is 48px tall`);
		assertNear({ actual: icon.x - row.x, expected: 24 }, `row ${index}'s icon well sits 24px in`);
		assertNear({ actual: text.x - icon.x, expected: 64 }, `row ${index}'s text starts 16px after the well`);
		assertNear({ actual: actions.x - (text.x + text.width), expected: 32 }, `row ${index}'s actions sit 32px after its text`);
		assertNear({ actual: actions.height, expected: 40 }, `row ${index}'s actions are M buttons`);
		assertNear({ actual: actions.x + actions.width, expected: input.cardRight - 25 }, `row ${index}'s actions end on the card's 24px inset`);
		assertNear({ actual: actions.y + actions.height / 2, expected: row.y + row.height / 2 }, `row ${index}'s actions are centred on the row`);
	}
}

async function designWidthGeometry(page: Page): Promise<void> {
	const [main, title] = await page.evaluate(measureBoxes, [MAIN, TITLE]);
	assertNear({ actual: title.y - main.y, expected: 32 }, "at 1440 the title's line box starts 32px under the header");
	const cards = await boxesOf(page, CARDS);
	assert.equal(cards.length, 5, "the subscription card, the payment methods and the three settings cards are measured");
	for (const [index, card] of cards.entries()) {
		assertNear({ actual: card.x, expected: 280 }, `card ${index} starts on the 880px column's left edge`);
		assertNear({ actual: card.x + card.width, expected: 1160 }, `card ${index} ends on the 880px column's right edge`);
	}
	await sectionRhythm(page);
	await rowAnatomy(page, { cardRight: 1160 });
	const dataCard = await measuredBox(page, DATA_CARD);
	assertNear({ actual: dataCard.height, expected: 98 }, "a one-line row's card is 98px tall");
	const options = await boxesOf(page, THEME_OPTION);
	assert.equal(options.length, 3, "Theme offers three options");
	for (const [index, option] of options.slice(1).entries()) {
		const before = options[index];
		assertNear({ actual: option.x - (before.x + before.width), expected: 8 }, `Theme options ${index} and ${index + 1} sit 8px apart`);
	}
}

async function phoneGeometry(page: Page): Promise<void> {
	const cards = await boxesOf(page, CARDS);
	for (const [index, card] of cards.entries()) {
		assertNear({ actual: card.x, expected: 20 }, `on a phone card ${index} starts at the 20px gutter`);
		assertNear({ actual: card.x + card.width, expected: PHONE.width - 20 }, `on a phone card ${index} ends at the 20px gutter`);
	}
	await sectionRhythm(page);
	const [text, actions] = await page.evaluate(measureBoxes, [`${THEME_ROW} .account-row__text`, `${THEME_ROW} .account-row__actions`]);
	assertNear({ actual: actions.y - (text.y + text.height), expected: 16 }, "on a phone the Theme options drop 16px under the text");
	const options = await boxesOf(page, THEME_OPTION);
	const [first] = options;
	for (const option of options) {
		assertNear({ actual: option.y, expected: first.y }, "on a phone the Theme options share one line");
		assertNear({ actual: option.width, expected: first.width }, "on a phone the Theme options share the width equally");
	}
	const last = options[options.length - 1];
	assertNear({ actual: last.x + last.width - first.x, expected: actions.width }, "on a phone the Theme options fill the row");
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the account page must not scroll sideways on a phone");
}

async function appShellGeometry(page: Page): Promise<void> {
	await phoneGeometry(page);
	const [back, title] = await page.evaluate(measureBoxes, [BACK_LINK, TITLE]);
	assert.ok(back.y + back.height <= title.y, "the back link sits above the title");
	assert.ok(back.height >= 44, `the back link keeps a 44px target, measured ${back.height}`);
	await expect(page.locator("body")).toHaveClass(/page-account--chromeless/);
}

async function dialogGeometry(page: Page, input: { width: number }): Promise<{ field: MeasuredBox; cancel: MeasuredBox; commit: MeasuredBox }> {
	const [panel, field, cancel, commit] = await page.evaluate(measureBoxes, [DIALOG, DIALOG_FIELD, DIALOG_CANCEL, DIALOG_COMMIT]);
	assertNear({ actual: panel.width, expected: input.width }, "the delete dialog takes the shared panel's width");
	for (const part of [field, cancel, commit]) {
		assert.ok(part.x >= panel.x && part.x + part.width <= panel.x + panel.width, "every part of the dialog sits inside its panel");
	}
	return { field, cancel, commit };
}

async function desktopDialogGeometry(page: Page): Promise<void> {
	const { field, cancel, commit } = await dialogGeometry(page, { width: 600 });
	assertNear({ actual: cancel.y, expected: commit.y }, "Cancel and Delete account share one row");
	assert.ok(cancel.x + cancel.width < commit.x, "Cancel comes before Delete account");
	assertNear({ actual: commit.x + commit.width, expected: field.x + field.width }, "the buttons end on the field's right edge");
	assertNear({ actual: cancel.y - (field.y + field.height), expected: 24 }, "the buttons sit 24px under the field");
	assertNear({ actual: commit.height, expected: 48 }, "the dialog's buttons are L buttons");
}

async function phoneDialogGeometry(page: Page): Promise<void> {
	const { field, cancel, commit } = await dialogGeometry(page, { width: PHONE.width - 32 });
	assert.ok(commit.y + commit.height <= cancel.y, "on a phone Delete account stacks above Cancel");
	for (const button of [cancel, commit]) {
		assertNear({ actual: button.width, expected: field.width }, "on a phone the dialog's buttons span the field's width");
	}
}

async function appearanceGeometry(page: Page): Promise<void> {
	await expect(page.locator("body")).toHaveClass(/theme-dark/);
	await expect(page.locator(`${THEME_OPTION}[aria-pressed="true"]`)).toHaveAttribute("data-test-appearance-option", "dark");
	const dots = await page.locator(`${THEME_OPTION} .form-choice--mark`).evaluateAll((marks) =>
		marks.map((mark) => getComputedStyle(mark).backgroundImage !== "none"),
	);
	assert.deepEqual(dots, [false, true, false], "only the pressed option draws the radio dot");
}

async function rejectedGeometry(page: Page): Promise<void> {
	await expect(page.locator(DANGER_CARD)).toHaveAttribute("data-test-danger-presentation", "inline");
	await expect(page.locator(DANGER_OPEN)).toBeHidden();
	await expect(page.locator(`${INLINE_FORM} [data-test-danger-notice]`)).toBeVisible();
	const [card, form] = await page.evaluate(measureBoxes, [DANGER_CARD, INLINE_FORM]);
	assertNear({ actual: form.x, expected: card.x + 1 }, "the refused form spans the danger card");
	assertNear({ actual: form.width, expected: card.width - 2 }, "the refused form spans the danger card");
}

function mainCheckpoint(input: { name: string; geometry: (page: Page) => Promise<void> }): VisualCheckpoint {
	return {
		name: input.name,
		settled: restingPage,
		geometry: input.geometry,
		target: MAIN,
		capture: "element",
		pinnedText: EMAIL_PINNED,
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

test.describe("Account page at the design width", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH });

	for (const theme of ["light", "dark"] as const) {
		test(`stacks headed sections of settings rows in the 880px column (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, { stamp: `founding-${theme}-${testInfo.workerIndex}-${Date.now()}` });
			await openAccount(page);
			await captureCheckpoint(page, mainCheckpoint({ name: `account-founding-${theme}`, geometry: designWidthGeometry }));
		});

		test(`opens the delete dialog from the Danger zone row (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, { stamp: `dialog-${theme}-${testInfo.workerIndex}-${Date.now()}` });
			await openAccount(page);
			await openDeleteDialog(page);
			await captureCheckpoint(page, dialogCheckpoint({ name: `account-delete-dialog-${theme}`, geometry: desktopDialogGeometry }));
		});
	}

	test("places the inactive card and its payment methods under one heading", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `inactive-${testInfo.workerIndex}-${Date.now()}`, state: "inactive" });
		await openAccount(page);
		await captureCheckpoint(page, mainCheckpoint({ name: "account-inactive-light", geometry: designWidthGeometry }));
	});

	test("re-renders the page dark with the dot on Dark once Dark is chosen", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `appearance-${testInfo.workerIndex}-${Date.now()}` });
		await openAccount(page);
		await page.locator(`${THEME_OPTION}[data-test-appearance-option="dark"]`).click();
		await page.waitForSelector("body.page-account.theme-dark");
		await captureCheckpoint(page, {
			name: "account-appearance-dark-selected",
			settled: restingPage,
			geometry: appearanceGeometry,
			target: APPEARANCE_SECTION,
			capture: "element",
			pinnedText: EMAIL_PINNED,
		});
	});

	test("shows the refused delete inline under the Danger zone row", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `rejected-${testInfo.workerIndex}-${Date.now()}` });
		await openAccount(page, "?error=delete_confirmation");
		await captureCheckpoint(page, {
			name: "account-delete-rejected-light",
			settled: restingPage,
			geometry: rejectedGeometry,
			target: DANGER_SECTION,
			capture: "element",
			pinnedText: EMAIL_PINNED,
		});
	});
});

test.describe("Account page on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	for (const theme of ["light", "dark"] as const) {
		test(`drops each row's actions under its text (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await signIn(page, { stamp: `phone-${theme}-${testInfo.workerIndex}-${Date.now()}` });
			await openAccount(page);
			await captureCheckpoint(page, mainCheckpoint({ name: `account-phone-${theme}`, geometry: phoneGeometry }));
		});
	}

	test("stacks the delete dialog's buttons with the commit on top", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `dialog-phone-${testInfo.workerIndex}-${Date.now()}` });
		await openAccount(page);
		await openDeleteDialog(page);
		await captureCheckpoint(page, dialogCheckpoint({ name: "account-delete-dialog-phone", geometry: phoneDialogGeometry }));
	});

	test("renders the app shell with its back link and no billing", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signIn(page, { stamp: `app-shell-${testInfo.workerIndex}-${Date.now()}` });
		await openAccount(page, "?platform=ios&shell=app");
		await captureCheckpoint(page, mainCheckpoint({ name: "account-app-shell-light", geometry: appShellGeometry }));
	});
});
