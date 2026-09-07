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
import { requireEnv } from "@packages/require-env";
import { z } from "zod";
import { clickAndWaitForPageReload } from "./page-interactions";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const PURPOSE =
	"Long-form essays about how teams actually ship software, kept here so I can reread them before a planning round.";

const PANEL = '[data-test-confirm-popover="readlist-preferences"]';
const PANEL_TITLE = `${PANEL} .confirm-popover__title`;
const PANEL_BODY = `${PANEL} .confirm-popover__body`;
const PANEL_FIELD = `${PANEL} [data-test-field="purpose"]`;
const PANEL_SAVE = `${PANEL} [data-test-action="readlist-preferences-save"]`;
const PANEL_CANCEL = `${PANEL} [data-test-action="readlist-preferences-cancel"]`;
const PREFERENCES = "main.readlist [data-test-readlist-preferences]";
const PREFERENCES_TAB = 'main.readlist [data-test-filter="preferences"]';
const SETUP_TRIGGER = 'main.readlist [data-test-action="readlist-preferences-setup"]';
const EDIT_TRIGGER = 'main.readlist [data-test-action="readlist-preferences-edit"]';
const PURPOSE_TEXT = "main.readlist [data-test-preferences-purpose]";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createVerifiedUser(page: Page, email: string): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	CreatedUser.parse(await created.json());
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openPreferences(page: Page, stamp: string): Promise<void> {
	const email = `readlist-preferences-visual-${stamp}@example.com`;
	await createVerifiedUser(page, email);
	await loginAs(page, email);

	await page.goto(`${BASE_URL}/queue?feature=pref`, { waitUntil: "domcontentloaded" });
	await page.click('[data-test-action="new-readlist"]');
	await page.waitForSelector("[data-readlist-rename]");
	await page.goto(`${page.url()}&feature=pref`, { waitUntil: "domcontentloaded" });
	await clickAndWaitForPageReload(page, page.locator(PREFERENCES_TAB));
	await page.waitForSelector(PREFERENCES);
	await page.mouse.move(5, 5);
}

async function openWizard(page: Page, stamp: string): Promise<void> {
	await openPreferences(page, stamp);
	await page.click(SETUP_TRIGGER);
}

async function savePurpose(page: Page, stamp: string): Promise<void> {
	await openWizard(page, stamp);
	await page.locator(PANEL_FIELD).fill(PURPOSE);
	await clickAndWaitForPageReload(page, page.locator(PANEL_SAVE));
	await page.waitForSelector(PURPOSE_TEXT);
	await page.mouse.move(5, 5);
}

async function wizardOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${PANEL}:popover-open`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function purposeShown(page: Page): Promise<void> {
	await expect(page.locator(PREFERENCES)).toHaveAttribute("data-test-preferences-state", "set");
	await expect(page.locator(PURPOSE_TEXT)).toHaveText(PURPOSE);
	await waitForBrandFonts(page, ["Inter"]);
}

async function questionLeadsTheFieldThenBothChoices(page: Page): Promise<void> {
	const panel = await measuredBox(page, PANEL);
	const stacked = [
		["question", await measuredBox(page, PANEL_TITLE)],
		["explanation", await measuredBox(page, PANEL_BODY)],
		["purpose field", await measuredBox(page, PANEL_FIELD)],
		["save choice", await measuredBox(page, PANEL_SAVE)],
		["cancel choice", await measuredBox(page, PANEL_CANCEL)],
	] as const;

	for (let i = 1; i < stacked.length; i++) {
		const [name, part] = stacked[i];
		const [aboveName, above] = stacked[i - 1];
		assert.ok(
			part.y >= above.y + above.height,
			`the ${name} must sit below the ${aboveName}, not beside it`,
		);
	}
	const save = await measuredBox(page, PANEL_SAVE);
	const cancel = await measuredBox(page, PANEL_CANCEL);
	assert.equal(cancel.x, save.x, "the two choices must stack in one column");
	assert.equal(cancel.width, save.width, "the stacked choices must share the panel's width");

	for (const [name, part] of stacked) {
		assert.ok(
			part.x >= panel.x && part.x + part.width <= panel.x + panel.width,
			`the ${name} must sit inside the panel horizontally`,
		);
		assert.ok(
			part.y >= panel.y && part.y + part.height <= panel.y + panel.height,
			`the ${name} must sit inside the panel vertically`,
		);
	}
}

async function purposeFillsThePanelUnderTheTabs(page: Page): Promise<void> {
	await expect(page.locator(SETUP_TRIGGER)).toBeHidden();
	await expect(page.locator(EDIT_TRIGGER)).toBeVisible();
	const [preferences, edit, tab] = [
		await measuredBox(page, PREFERENCES),
		await measuredBox(page, EDIT_TRIGGER),
		await measuredBox(page, PREFERENCES_TAB),
	];
	assert.ok(
		edit.x > preferences.x && edit.x + edit.width < preferences.x + preferences.width,
		"the purpose block must sit inside the panel's padding, not run to its edges",
	);
	assert.ok(
		tab.y + tab.height <= preferences.y + 1,
		"the preferences tab must meet the panel it opens, the way a file tab meets its folder",
	);
}

function wizardCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: wizardOpen,
		geometry: questionLeadsTheFieldThenBothChoices,
		target: PANEL,
		capture: "element",
		pinnedText: [],
	};
}

const WIZARD_LIGHT = wizardCheckpoint("readlist-preferences-wizard-light");
const WIZARD_DARK = wizardCheckpoint("readlist-preferences-wizard-dark");

const PURPOSE_SET_LIGHT: VisualCheckpoint = {
	name: "readlist-preferences-set-light",
	settled: purposeShown,
	geometry: purposeFillsThePanelUnderTheTabs,
	target: PREFERENCES,
	capture: "element",
	pinnedText: [],
};

test.describe("Readlist preferences wizard", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("asks what the readlist is for, then offers both answers (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openWizard(page, `wizard-light-${testInfo.workerIndex}-${Date.now()}`);
		await expect(page.locator(PANEL_FIELD)).toHaveAttribute(
			"placeholder",
			"This readlist purpose is …",
		);
		await captureCheckpoint(page, WIZARD_LIGHT);
	});

	test("asks what the readlist is for, then offers both answers (dark)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openWizard(page, `wizard-dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, WIZARD_DARK);
	});

	test("shows the saved purpose as the block that reopens the wizard", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await savePurpose(page, `set-light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, PURPOSE_SET_LIGHT);
	});
});
