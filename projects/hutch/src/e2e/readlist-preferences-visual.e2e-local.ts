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
import { clickAndWaitForPageReload, nameNewReadlist } from "./page-interactions";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const PURPOSE =
	"Long-form essays about how teams actually ship software, kept here so I can reread them before a planning round.";

const DESKTOP = { width: 1280, height: 900 };
const DESKTOP_TALL = { width: 1280, height: 1700 };
const PHONE = { width: 390, height: 844 };
const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };
const THEMES = ["light", "dark"] as const;

const MAIN = "main.readlist";
const RAIL = ".readlist__rail";
const MAIN_COLUMN = ".readlist__main";
const SIDE = ".readlist__side";
const SAVE_CARD = "[data-test-save-card]";
const SETUP_GUIDE = "[data-test-setup-guide]";
const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const PANEL = '[data-test-confirm-popover="readlist-preferences"]';
const PANEL_HEADER = `${PANEL} .confirm-popover__header`;
const PANEL_TITLE = `${PANEL} .confirm-popover__title`;
const PANEL_SUBHEADING = `${PANEL} .confirm-popover__subheading`;
const PANEL_BODY = `${PANEL} .confirm-popover__body`;
const PANEL_LABEL = `${PANEL} .form-field__label`;
const PANEL_FIELD = `${PANEL} [data-test-field="purpose"]`;
const PANEL_ERROR = `${PANEL} [data-test-wizard-error]`;
const PANEL_ROW = `${PANEL} .confirm-popover__buttons`;
const PANEL_SAVE = `${PANEL} [data-test-action="readlist-preferences-save"]`;
const PANEL_CANCEL = `${PANEL} [data-test-action="readlist-preferences-cancel"]`;
const INLINE = '[data-test-wizard-inline="readlist-preferences"]';
const INLINE_FIELD = `${INLINE} [data-test-field="purpose"]`;
const INLINE_ERROR = `${INLINE} [data-test-wizard-error]`;
const INLINE_SAVE = `${INLINE} [data-test-action="readlist-preferences-save-fallback"]`;
const INLINE_CANCEL = `${INLINE} [data-test-action="readlist-preferences-cancel-fallback"]`;
const DELETE_PANEL = '[data-test-confirm-popover="readlist-purpose-delete"]';
const DELETE_HEADER = `${DELETE_PANEL} .confirm-popover__header`;
const DELETE_TITLE = `${DELETE_PANEL} .confirm-popover__title`;
const DELETE_BODY = `${DELETE_PANEL} .confirm-popover__body`;
const DELETE_CANCEL = `${DELETE_PANEL} [data-test-action="readlist-purpose-delete-cancel"]`;
const DELETE_COMMIT = `${DELETE_PANEL} [data-test-action="readlist-purpose-delete-confirm"]`;
const PREFERENCES = "[data-test-readlist-preferences]";
const PREFERENCES_TAB = '[data-test-filter="preferences"]';
const SETUP_TRIGGER = '[data-test-action="readlist-preferences-setup"]';
const UNSET_CARD = "[data-test-preferences-empty]";
const UNSET_ART = `${UNSET_CARD} [data-test-illustration="book-lightbulb"]`;
const UNSET_TEXT = `${UNSET_CARD} .readlist-empty__text`;
const MENU = "[data-test-preferences-menu]";
const MENU_TOGGLE = '[data-test-action="readlist-preferences-menu"]';
const MENU_GLYPH = `${MENU_TOGGLE} svg`;
const MENU_PANEL = `${MENU} .menu__panel`;
const EDIT_TRIGGER = '[data-test-action="readlist-preferences-edit"]';
const DELETE_TRIGGER = '[data-test-action="readlist-preferences-delete"]';
const PURPOSE_TEXT = "[data-test-preferences-purpose]";
const INBOXES = "[data-test-readlist-inboxes]";
const INBOX_ROWS = "[data-test-preferences-inbox]";
const INBOXES_DESCRIPTION = "[data-test-inboxes-description]";
const CREATE_INBOX = '[data-test-action="create-inbox"]';
const TABS = "[data-test-filters]";
const ALERT = '[data-test-alert="readlist"]';
const ALERT_TITLE = `${ALERT} [data-test-alert-title]`;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededInboxes = z.object({ ok: z.literal(true), addresses: z.array(z.string()) });

async function createVerifiedUser(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await created.json()).userId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function createReadlistFromRail(page: Page, name: string): Promise<string> {
	await clickAndWaitForPageReload(page, await nameNewReadlist(page, name));
	await page.waitForFunction(() => new URL(window.location.href).searchParams.has("queue"));
	const slug = new URL(page.url()).searchParams.get("queue");
	assert.ok(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function openPreferences(page: Page, stamp: string): Promise<{ userId: string; slug: string }> {
	const email = `readlist-preferences-visual-${stamp}@example.com`;
	const userId = await createVerifiedUser(page, email);
	await loginAs(page, email);

	await page.goto(`${BASE_URL}/queue?feature=pref`, { waitUntil: "domcontentloaded" });
	const slug = await createReadlistFromRail(page, "New Readlist");
	await page.goto(`${page.url()}&feature=pref`, { waitUntil: "domcontentloaded" });
	await clickAndWaitForPageReload(page, page.locator(PREFERENCES_TAB));
	await page.waitForSelector(PREFERENCES);
	await page.mouse.move(5, 5);
	return { userId, slug };
}

async function seedInboxes(
	page: Page,
	input: { userId: string; inboxes: readonly { name: string; readlist?: string }[] },
): Promise<string[]> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-inbox-addresses`, { data: input });
	assert.equal(seeded.status(), 201, "the e2e inbox fixture must answer the seed request");
	return SeededInboxes.parse(await seeded.json()).addresses;
}

async function reopenPreferences(page: Page, input: { slug: string; query?: string }): Promise<void> {
	await page.goto(
		`${BASE_URL}/queue/queues/${input.slug}/preferences?feature=pref${input.query ?? ""}`,
		{ waitUntil: "domcontentloaded" },
	);
	await page.waitForSelector(INBOXES);
	await page.mouse.move(5, 5);
}

async function openPreferencesByRequest(page: Page, stamp: string): Promise<string> {
	const email = `readlist-preferences-visual-${stamp}@example.com`;
	await createVerifiedUser(page, email);
	await loginAs(page, email);
	const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: "New Readlist" } });
	assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
	const slug = new URL(created.url()).searchParams.get("queue");
	assert.ok(slug, "creating a readlist must land the reader on it");
	await reopenPreferences(page, { slug });
	return slug;
}

async function seedPurpose(page: Page, slug: string): Promise<void> {
	const saved = await page.request.post(`${BASE_URL}/queue/queues/${slug}/preferences?feature=pref`, {
		form: { purpose: PURPOSE },
	});
	assert.equal(saved.status(), 200, "a saved purpose must land back on the preferences tab");
	await reopenPreferences(page, { slug });
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

async function openSetPreferences(page: Page, stamp: string): Promise<void> {
	const { slug } = await openPreferences(page, stamp);
	await seedPurpose(page, slug);
}

async function wizardOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${PANEL}:popover-open`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function wizardTyped(page: Page): Promise<void> {
	await wizardOpen(page);
	const field = page.locator(PANEL_FIELD);
	await field.fill(PURPOSE);
	await field.blur();
	await expect(page.locator("body")).toBeFocused();
	await expect(page.locator(`${PANEL}:popover-open`)).toHaveCount(1);
	await page.mouse.move(0, 0);
}

async function unsetShown(page: Page): Promise<void> {
	await expect(page.locator(PREFERENCES)).toHaveAttribute("data-test-preferences-state", "unset");
	await expect(page.locator(SETUP_TRIGGER)).toBeVisible();
	await waitForBrandFonts(page, ["Inter"]);
	await page.mouse.move(0, 0);
}

async function purposeShown(page: Page): Promise<void> {
	await expect(page.locator(PREFERENCES)).toHaveAttribute("data-test-preferences-state", "set");
	await expect(page.locator(PURPOSE_TEXT)).toHaveText(PURPOSE);
	await waitForBrandFonts(page, ["Inter"]);
	await page.mouse.move(0, 0);
}

async function openPurposeMenu(page: Page): Promise<void> {
	await page.click(MENU_TOGGLE);
	await expect(page.locator(MENU)).toHaveAttribute("open", "");
	await expect(page.locator(EDIT_TRIGGER)).toBeVisible();
	await expect(page.locator(DELETE_TRIGGER)).toBeVisible();
}

async function menuOpenSettled(page: Page): Promise<void> {
	await purposeShown(page);
	await expect(page.locator(SETUP_GUIDE)).toBeVisible();
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await openPurposeMenu(page);
	await page.mouse.move(0, 0);
}

async function editDialogOpen(page: Page): Promise<void> {
	await purposeShown(page);
	await openPurposeMenu(page);
	await page.click(EDIT_TRIGGER);
	await wizardOpen(page);
	await expect(page.locator(PANEL_FIELD)).toHaveValue(PURPOSE);
	await page.mouse.move(0, 0);
}

async function deleteConfirmOpen(page: Page): Promise<void> {
	await purposeShown(page);
	await openPurposeMenu(page);
	await page.click(DELETE_TRIGGER);
	await page.waitForSelector(`${DELETE_PANEL}:popover-open`);
	await waitForBrandFonts(page, ["Inter"]);
	await page.mouse.move(0, 0);
}

async function refusedInTheDialog(page: Page): Promise<void> {
	await wizardOpen(page);
	await page.locator(PANEL_FIELD).fill("   ");
	await page.click(PANEL_SAVE);
	await expect(page.locator(PANEL_ERROR)).not.toBeEmpty();
	await expect(page.locator(PANEL_FIELD)).toBeFocused();
	await page.mouse.move(0, 0);
}

async function refusedInline(page: Page): Promise<void> {
	await expect(page.locator(INLINE)).toBeVisible();
	await expect(page.locator(INLINE_ERROR)).not.toBeEmpty();
	await expect(page.locator(INLINE_FIELD)).toBeFocused();
	await waitForBrandFonts(page, ["Inter"]);
	await page.mouse.move(0, 0);
}

function near(input: { actual: number; expected: number; within: number }): boolean {
	return Math.abs(input.actual - input.expected) <= input.within;
}

function stackedInOrder(parts: readonly (readonly [string, { y: number; height: number }])[]): void {
	for (let index = 1; index < parts.length; index++) {
		const [name, part] = parts[index];
		const [aboveName, above] = parts[index - 1];
		assert.ok(part.y >= above.y + above.height, `the ${name} must sit below the ${aboveName}, not beside it`);
	}
}

async function headerHoldsOnlyTheTitle(page: Page, header: string): Promise<void> {
	const children = await page.locator(header).evaluate((element) => element.children.length);
	assert.equal(children, 1, "the dialog's header must hold its title alone, with no close control");
}

async function choiceRowEndsAtTheField(
	page: Page,
	parts: { cancel: string; save: string; field: string },
): Promise<void> {
	const [cancel, save, field] = [
		await measuredBox(page, parts.cancel),
		await measuredBox(page, parts.save),
		await measuredBox(page, parts.field),
	];
	assert.ok(
		near({ actual: cancel.y, expected: save.y, within: 0.5 }),
		`Cancel and Save must share one row, measured ${cancel.y}px and ${save.y}px`,
	);
	assert.ok(
		near({ actual: save.x - (cancel.x + cancel.width), expected: 8, within: 0.5 }),
		`Cancel must end 8px before Save, measured ${save.x - (cancel.x + cancel.width)}px`,
	);
	assert.ok(
		near({ actual: save.x + save.width, expected: field.x + field.width, within: 1 }),
		`Save must end where the field ends, measured ${save.x + save.width}px and ${field.x + field.width}px`,
	);
}

async function questionLeadsTheFieldThenTheChoiceRow(page: Page): Promise<void> {
	const panel = await measuredBox(page, PANEL);
	assert.ok(near({ actual: panel.width, expected: 600, within: 1 }), `the dialog must be 600px wide, measured ${panel.width}px`);
	await headerHoldsOnlyTheTitle(page, PANEL_HEADER);
	const [field, row] = [await measuredBox(page, PANEL_FIELD), await measuredBox(page, PANEL_ROW)];
	stackedInOrder([
		["question", await measuredBox(page, PANEL_TITLE)],
		["explanation", await measuredBox(page, PANEL_BODY)],
		["field's label", await measuredBox(page, PANEL_LABEL)],
		["purpose field", field],
		["choice row", row],
	]);
	assert.ok(
		near({ actual: row.y - (field.y + field.height), expected: 24, within: 1 }),
		`the choices must sit 24px under the field, measured ${row.y - (field.y + field.height)}px`,
	);
	await choiceRowEndsAtTheField(page, { cancel: PANEL_CANCEL, save: PANEL_SAVE, field: PANEL_FIELD });
}

async function editTitlesTheTaskAboveTheQuestion(page: Page): Promise<void> {
	const [title, subheading, body] = [
		await measuredBox(page, PANEL_TITLE),
		await measuredBox(page, PANEL_SUBHEADING),
		await measuredBox(page, PANEL_BODY),
	];
	assert.ok(
		near({ actual: subheading.y - (title.y + title.height), expected: 18, within: 1 }),
		`the question must sit 18px under the task title, measured ${subheading.y - (title.y + title.height)}px`,
	);
	const sizes = await page.evaluate(
		(selectors) => selectors.map((selector) => {
			const element = document.querySelector(selector);
			if (!element) throw new Error(`"${selector}" must be rendered to read its type size`);
			return Number.parseFloat(getComputedStyle(element).fontSize);
		}),
		[PANEL_TITLE, PANEL_SUBHEADING],
	);
	for (const size of sizes) {
		assert.ok(near({ actual: size, expected: 18, within: 0.5 }), `the task title and question must both set at 18px, measured ${size}px`);
	}
	assert.ok(subheading.y + subheading.height <= body.y, "the question must sit above the explanation");
	await questionLeadsTheFieldThenTheChoiceRow(page);
}

async function deleteAsksThenOffersTheChoiceRow(page: Page): Promise<void> {
	const panel = await measuredBox(page, DELETE_PANEL);
	assert.ok(near({ actual: panel.width, expected: 600, within: 1 }), `the dialog must be 600px wide, measured ${panel.width}px`);
	await headerHoldsOnlyTheTitle(page, DELETE_HEADER);
	const [body, cancel] = [await measuredBox(page, DELETE_BODY), await measuredBox(page, DELETE_CANCEL)];
	stackedInOrder([
		["question", await measuredBox(page, DELETE_TITLE)],
		["consequence", body],
		["choices", cancel],
	]);
	await choiceRowEndsAtTheField(page, { cancel: DELETE_CANCEL, save: DELETE_COMMIT, field: DELETE_BODY });
}

async function errorRowStaysOneLine(page: Page): Promise<void> {
	await choiceRowEndsAtTheField(page, { cancel: INLINE_CANCEL, save: INLINE_SAVE, field: INLINE_FIELD });
}

async function refusalSitsBetweenTheFieldAndTheChoiceRow(page: Page): Promise<void> {
	const [field, error, row] = [
		await measuredBox(page, PANEL_FIELD),
		await measuredBox(page, PANEL_ERROR),
		await measuredBox(page, PANEL_ROW),
	];
	stackedInOrder([
		["question", await measuredBox(page, PANEL_TITLE)],
		["explanation", await measuredBox(page, PANEL_BODY)],
		["purpose field", field],
		["reason", error],
		["choice row", row],
	]);
	assert.ok(
		near({ actual: error.y - (field.y + field.height), expected: 8, within: 1 }),
		`the reason must sit 8px under the field, measured ${error.y - (field.y + field.height)}px`,
	);
	assert.ok(
		near({ actual: row.y - (error.y + error.height), expected: 24, within: 1 }),
		`the choices must sit 24px under the reason, measured ${row.y - (error.y + error.height)}px`,
	);
	await choiceRowEndsAtTheField(page, { cancel: PANEL_CANCEL, save: PANEL_SAVE, field: PANEL_FIELD });
}

async function unsetCardComposition(page: Page): Promise<void> {
	const [panel, art, cta] = [
		await measuredBox(page, PREFERENCES),
		await measuredBox(page, UNSET_ART),
		await measuredBox(page, SETUP_TRIGGER),
	];
	assert.equal(Math.round(art.width), 80, `the setup art must keep its drawn width, measured ${art.width}px`);
	assert.equal(Math.round(art.height), 64, `the setup art must keep its drawn height, measured ${art.height}px`);
	assert.equal(Math.round(cta.height), 48, `the setup action must be 48px tall, measured ${cta.height}px`);
	assert.ok(
		near({ actual: art.y - panel.y, expected: 48, within: 1 }),
		`the art must sit 48px inside the card's top, measured ${art.y - panel.y}px`,
	);
	assert.ok(
		near({ actual: panel.y + panel.height - (cta.y + cta.height), expected: 48, within: 1 }),
		`the setup action must sit 48px inside the card's bottom, measured ${panel.y + panel.height - (cta.y + cta.height)}px`,
	);
}

async function purposeCardSitsUnderTheTabs(page: Page): Promise<void> {
	await expect(page.locator(SETUP_TRIGGER)).toBeHidden();
	const [save, tabs, panel, inboxes, purpose, glyph] = [
		await measuredBox(page, SAVE_CARD),
		await measuredBox(page, TABS),
		await measuredBox(page, PREFERENCES),
		await measuredBox(page, INBOXES),
		await measuredBox(page, PURPOSE_TEXT),
		await measuredBox(page, MENU_GLYPH),
	];
	assert.ok(
		near({ actual: tabs.y - (save.y + save.height), expected: 32, within: 1 }),
		`the tabs must sit 32px under the save card, measured ${tabs.y - (save.y + save.height)}px`,
	);
	assert.ok(
		near({ actual: panel.y - (tabs.y + tabs.height), expected: 32, within: 1 }),
		`the purpose card must sit 32px under the tabs, measured ${panel.y - (tabs.y + tabs.height)}px`,
	);
	assert.ok(
		near({ actual: inboxes.y - (panel.y + panel.height), expected: 32, within: 1 }),
		`the inboxes must sit 32px under the purpose card, measured ${inboxes.y - (panel.y + panel.height)}px`,
	);
	assert.ok(
		near({ actual: purpose.x - panel.x, expected: 25, within: 1 }),
		`the purpose must start 25px inside the card, measured ${purpose.x - panel.x}px`,
	);
	assert.ok(
		near({ actual: panel.x + panel.width - (glyph.x + glyph.width), expected: 25, within: 1 }),
		`the kebab must end 25px inside the card's right edge, measured ${panel.x + panel.width - (glyph.x + glyph.width)}px`,
	);
	assert.ok(
		near({ actual: glyph.y - panel.y, expected: 25, within: 1 }),
		`the kebab must sit 25px inside the card's top edge, measured ${glyph.y - panel.y}px`,
	);
}

async function neverScrollsSideways(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the preferences page must never scroll sideways");
}

async function railBesideMainBesideSide(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	const [rail, main, side] = [
		await measuredBox(page, RAIL),
		await measuredBox(page, MAIN_COLUMN),
		await measuredBox(page, SIDE),
	];
	assert.ok(rail.x + rail.width <= main.x, "the rail must sit left of the main column");
	assert.ok(main.x + main.width <= side.x, "the side column must sit right of the main column");
}

async function pageFitsTheClip(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "a whole-page capture needs a fixed viewport to size its clip");
	const target = await measuredBox(page, MAIN);
	assert.ok(
		target.y + target.height <= viewport.height,
		`the whole-page clip runs to ${Math.ceil(target.y + target.height)}px, past the ${viewport.height}px viewport a clip can reach`,
	);
}

async function menuOpensUnderItsKebab(page: Page): Promise<void> {
	await railBesideMainBesideSide(page);
	await pageFitsTheClip(page);
	const [toggle, panel, edit, remove] = [
		await measuredBox(page, MENU_TOGGLE),
		await measuredBox(page, MENU_PANEL),
		await measuredBox(page, EDIT_TRIGGER),
		await measuredBox(page, DELETE_TRIGGER),
	];
	assert.ok(
		near({ actual: panel.x + panel.width, expected: toggle.x + toggle.width, within: 1 }),
		`the menu must end at its kebab's right edge, measured ${panel.x + panel.width}px and ${toggle.x + toggle.width}px`,
	);
	assert.ok(panel.y >= toggle.y + toggle.height, "the menu must open below its kebab");
	for (const [name, item] of [["Edit", edit], ["Delete", remove]] as const) {
		assert.ok(near({ actual: item.height, expected: 44, within: 0.5 }), `${name} must be a 44px row, measured ${item.height}px`);
	}
}

async function phoneGuideSitsBetweenSaveCardAndTabs(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	const [save, guide, tabs, panel] = [
		await measuredBox(page, SAVE_CARD),
		await measuredBox(page, SETUP_GUIDE),
		await measuredBox(page, TABS),
		await measuredBox(page, PREFERENCES),
	];
	assert.ok(save.y + save.height <= guide.y, "the setup guide must follow the save card on a phone");
	assert.ok(guide.y + guide.height <= tabs.y, "the setup guide must lead the tabs on a phone");
	assert.ok(tabs.y + tabs.height <= panel.y, "the purpose card must sit under the tabs on a phone");
}

async function unsetBodyWrapsOnAPhone(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	await unsetCardComposition(page);
	const text = await measuredBox(page, UNSET_TEXT);
	assert.ok(
		near({ actual: text.height / 22, expected: 2, within: 0.1 }),
		`the setup copy must wrap to two 22px lines on a phone, measured ${text.height}px`,
	);
}

async function choicesStackOnAPhone(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	const [save, cancel, field] = [
		await measuredBox(page, PANEL_SAVE),
		await measuredBox(page, PANEL_CANCEL),
		await measuredBox(page, PANEL_FIELD),
	];
	assert.ok(save.y + save.height <= cancel.y, "Save must stack above Cancel on a phone");
	for (const [name, choice] of [["Save", save], ["Cancel", cancel]] as const) {
		assert.ok(near({ actual: choice.x, expected: field.x, within: 1 }), `${name} must start where the field starts`);
		assert.ok(near({ actual: choice.width, expected: field.width, within: 1 }), `${name} must span the field's width`);
	}
}

function themed(input: Omit<VisualCheckpoint, "name">, name: string): VisualCheckpoint {
	return { ...input, name };
}

const UNSET: Omit<VisualCheckpoint, "name"> = {
	settled: unsetShown,
	geometry: unsetCardComposition,
	target: PREFERENCES,
	capture: "element",
	pinnedText: [],
};

const SET: Omit<VisualCheckpoint, "name"> = {
	settled: purposeShown,
	geometry: purposeCardSitsUnderTheTabs,
	target: PREFERENCES,
	capture: "element",
	pinnedText: [],
};

const MENU_OPEN: Omit<VisualCheckpoint, "name"> = {
	settled: menuOpenSettled,
	geometry: menuOpensUnderItsKebab,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const WIZARD: Omit<VisualCheckpoint, "name"> = {
	settled: wizardOpen,
	geometry: questionLeadsTheFieldThenTheChoiceRow,
	target: PANEL,
	capture: "element",
	pinnedText: [],
};

const EDIT: Omit<VisualCheckpoint, "name"> = {
	settled: editDialogOpen,
	geometry: editTitlesTheTaskAboveTheQuestion,
	target: PANEL,
	capture: "element",
	pinnedText: [],
};

const DELETE_CONFIRM: Omit<VisualCheckpoint, "name"> = {
	settled: deleteConfirmOpen,
	geometry: deleteAsksThenOffersTheChoiceRow,
	target: DELETE_PANEL,
	capture: "element",
	pinnedText: [],
};

const ERROR: Omit<VisualCheckpoint, "name"> = {
	settled: refusedInTheDialog,
	geometry: refusalSitsBetweenTheFieldAndTheChoiceRow,
	target: PANEL,
	capture: "element",
	pinnedText: [],
};

const WIZARD_FILLED_LIGHT: VisualCheckpoint = {
	...WIZARD,
	name: "readlist-preferences-wizard-filled-light",
	settled: wizardTyped,
};

const ERROR_INLINE_LIGHT: VisualCheckpoint = {
	name: "readlist-preferences-error-inline-light",
	settled: refusedInline,
	geometry: errorRowStaysOneLine,
	target: PREFERENCES,
	capture: "element",
	pinnedText: [],
};

const UNSET_PHONE: VisualCheckpoint = {
	...UNSET,
	name: "readlist-preferences-unset-phone",
	geometry: unsetBodyWrapsOnAPhone,
};

const SET_PHONE: VisualCheckpoint = {
	...SET,
	name: "readlist-preferences-set-phone",
	geometry: phoneGuideSitsBetweenSaveCardAndTabs,
};

const WIZARD_PHONE: VisualCheckpoint = {
	...WIZARD,
	name: "readlist-preferences-wizard-phone",
	geometry: choicesStackOnAPhone,
};

const PINNED_INBOX_ADDRESSES = [
	"news-a1b2c3@read.place",
	"tech-d4e5f6@read.place",
	"deals-g7h8i9@read.place",
];

async function inboxesSectionSitsUnderThePurposePanel(page: Page): Promise<void> {
	const [purpose, inboxes] = [
		await measuredBox(page, PREFERENCES),
		await measuredBox(page, INBOXES),
	];
	assert.ok(
		inboxes.y >= purpose.y + purpose.height,
		"the inboxes section must stack under the purpose panel, not beside it",
	);
	assert.equal(inboxes.x, purpose.x, "the inboxes section must share the purpose panel's column");
	assert.equal(inboxes.width, purpose.width, "the inboxes section must span the purpose panel's width");
}

async function inboxesEmpty(page: Page): Promise<void> {
	await expect(page.locator(INBOXES)).toHaveAttribute("data-test-inboxes-state", "empty");
	await expect(page.locator(CREATE_INBOX)).toBeVisible();
	await waitForBrandFonts(page, ["Inter"]);
}

async function createInboxCentredUnderTheDescription(page: Page): Promise<void> {
	await inboxesSectionSitsUnderThePurposePanel(page);
	const [inboxes, description, create] = [
		await measuredBox(page, INBOXES),
		await measuredBox(page, INBOXES_DESCRIPTION),
		await measuredBox(page, CREATE_INBOX),
	];
	assert.ok(
		create.y >= description.y + description.height,
		"the way to create an inbox must sit under the section's description",
	);
	assert.ok(
		Math.abs(create.x + create.width / 2 - (inboxes.x + inboxes.width / 2)) <= 1,
		"the way to create an inbox must be centred in the section",
	);
}

async function inboxesListed(page: Page): Promise<void> {
	await expect(page.locator(INBOXES)).toHaveAttribute("data-test-inboxes-state", "listed");
	await expect(page.locator(INBOX_ROWS)).toHaveCount(PINNED_INBOX_ADDRESSES.length);
	await waitForBrandFonts(page, ["Inter"]);
}

async function eachInboxLeadsWithItsNameAndEndsWithItsMove(page: Page): Promise<void> {
	await inboxesSectionSitsUnderThePurposePanel(page);
	let above = await measuredBox(page, INBOXES_DESCRIPTION);
	for (let position = 1; position <= PINNED_INBOX_ADDRESSES.length; position++) {
		const row = `${INBOX_ROWS}:nth-child(${position})`;
		const [box, name, destination, move] = [
			await measuredBox(page, row),
			await measuredBox(page, `${row} [data-test-inbox-name]`),
			await measuredBox(page, `${row} [data-test-inbox-destination]`),
			await measuredBox(page, `${row} button`),
		];
		assert.ok(box.y >= above.y + above.height, `inbox ${position} must sit below what comes before it`);
		assert.ok(
			move.y >= destination.y + destination.height,
			`inbox ${position}'s button must sit under where the inbox goes`,
		);
		assert.equal(move.x, name.x, `inbox ${position}'s button must line up with its name`);
		above = box;
	}
}

function inboxesListedCheckpoint(input: {
	name: string;
	addresses: readonly string[];
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: inboxesListed,
		geometry: eachInboxLeadsWithItsNameAndEndsWithItsMove,
		target: INBOXES,
		capture: "element",
		pinnedText: input.addresses.map((address, index) => ({
			selector: `[data-test-preferences-inbox="${address}"] [data-test-inbox-address]`,
			text: PINNED_INBOX_ADDRESSES[index],
		})),
	};
}

async function inboxUnavailableAlertShown(page: Page): Promise<void> {
	await expect(page.locator(ALERT)).toBeVisible();
	await expect(page.locator(ALERT_TITLE)).toHaveText("That inbox isn't available");
	await waitForBrandFonts(page, ["Inter"]);
}

async function alertLeadsTheColumnAboveTheTabs(page: Page): Promise<void> {
	const [alert, tabs, purpose] = [
		await measuredBox(page, ALERT),
		await measuredBox(page, TABS),
		await measuredBox(page, PREFERENCES),
	];
	assert.ok(alert.y + alert.height <= tabs.y, "the alert must sit above the tabs it concerns");
	assert.equal(alert.x, purpose.x, "the alert must share the main column's left edge");
	assert.equal(alert.width, purpose.width, "the alert must span the main column");
}

const INBOXES_EMPTY_LIGHT: VisualCheckpoint = {
	name: "readlist-preferences-inboxes-empty-light",
	settled: inboxesEmpty,
	geometry: createInboxCentredUnderTheDescription,
	target: INBOXES,
	capture: "element",
	pinnedText: [],
};

const INBOX_UNAVAILABLE_LIGHT: VisualCheckpoint = {
	name: "readlist-preferences-inbox-unavailable-light",
	settled: inboxUnavailableAlertShown,
	geometry: alertLeadsTheColumnAboveTheTabs,
	target: ALERT,
	capture: "element",
	pinnedText: [],
};

async function openListedInboxes(page: Page, stamp: string): Promise<readonly string[]> {
	const { userId, slug } = await openPreferences(page, stamp);
	const elsewhere = await createReadlistFromRail(page, "New Readlist 2");
	const addresses = await seedInboxes(page, {
		userId,
		inboxes: [{ name: "news", readlist: slug }, { name: "tech", readlist: elsewhere }, { name: "deals" }],
	});
	await reopenPreferences(page, { slug });
	return addresses;
}

test.describe("Readlist preferences panel", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`offers to set the readlist up while it has no purpose (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openPreferences(page, `unset-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(page, themed(UNSET, `readlist-preferences-unset-${theme}`));
		});

		test(`asks what the readlist is for, then offers both answers (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openWizard(page, `wizard-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await expect(page.locator(PANEL_FIELD)).toHaveAttribute("placeholder", "This readlist purpose is…");
			await captureCheckpoint(page, themed(WIZARD, `readlist-preferences-wizard-${theme}`));
		});

		test(`shows the saved purpose as plain text with its options menu (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await savePurpose(page, `set-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(page, themed(SET, `readlist-preferences-set-${theme}`));
		});

		test(`titles the edit dialog with the task above its question (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openSetPreferences(page, `edit-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(page, themed(EDIT, `readlist-preferences-edit-${theme}`));
		});

		test(`asks before deleting the purpose (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openSetPreferences(page, `delete-confirm-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(page, themed(DELETE_CONFIRM, `readlist-preferences-delete-confirm-${theme}`));
		});

		test(`refuses a blank purpose in the dialog (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openWizard(page, `error-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(page, themed(ERROR, `readlist-preferences-error-${theme}`));
		});
	}

	test("keeps what the reader typed in the setup dialog (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openWizard(page, `wizard-filled-light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, WIZARD_FILLED_LIGHT);
	});

	test("lands a refused purpose on the inline form with its reason (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const { slug } = await openPreferences(page, `error-inline-light-${testInfo.workerIndex}-${Date.now()}`);
		await reopenPreferences(page, { slug, query: "&preferences_error=invalid-purpose" });
		await captureCheckpoint(page, ERROR_INLINE_LIGHT);
	});
});

test.describe("Readlist preferences page", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	for (const theme of THEMES) {
		test(`opens the purpose menu under its kebab, in the readlist's own page (${theme})`, async ({
			page,
		}, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openSetPreferences(page, `menu-open-${theme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(page, themed(MENU_OPEN, `readlist-preferences-menu-open-${theme}`));
		});
	}
});

test.describe("Readlist preferences on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("offers to set the readlist up on a phone (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPreferencesByRequest(page, `unset-phone-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, UNSET_PHONE);
	});

	test("puts the setup guide between the save card and the tabs on a phone (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const slug = await openPreferencesByRequest(page, `set-phone-${testInfo.workerIndex}-${Date.now()}`);
		await seedPurpose(page, slug);
		await captureCheckpoint(page, SET_PHONE);
	});

	test("stacks the setup dialog's choices on a phone (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPreferencesByRequest(page, `wizard-phone-${testInfo.workerIndex}-${Date.now()}`);
		await page.click(SETUP_TRIGGER);
		await captureCheckpoint(page, WIZARD_PHONE);
	});
});

test.describe("Readlist preferences at the reflow minimum", () => {
	test.use({ timezoneId: "UTC", viewport: WCAG_REFLOW_MINIMUM });

	test("never scrolls sideways at 320px, with or without a purpose", async ({ page }, testInfo) => {
		const slug = await openPreferencesByRequest(page, `reflow-${testInfo.workerIndex}-${Date.now()}`);
		await expect(page.locator(PREFERENCES)).toHaveAttribute("data-test-preferences-state", "unset");
		await neverScrollsSideways(page);
		await seedPurpose(page, slug);
		await expect(page.locator(PREFERENCES)).toHaveAttribute("data-test-preferences-state", "set");
		await neverScrollsSideways(page);
	});
});

test.describe("Readlist preferences inboxes", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("offers to create an inbox while the reader has none (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPreferences(page, `inboxes-empty-light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, INBOXES_EMPTY_LIGHT);
	});

	test("lists each inbox with where it goes and the one move that changes it (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const addresses = await openListedInboxes(
			page,
			`inboxes-listed-light-${testInfo.workerIndex}-${Date.now()}`,
		);
		await expect(page.locator(`${INBOX_ROWS} [data-test-inbox-destination]`)).toHaveText([
			"Goes to All",
			"Goes to New Readlist",
			"Goes to New Readlist 2",
		]);
		await captureCheckpoint(
			page,
			inboxesListedCheckpoint({ name: "readlist-preferences-inboxes-listed-light", addresses }),
		);
	});

	test("lists each inbox with where it goes and the one move that changes it (dark)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		const addresses = await openListedInboxes(
			page,
			`inboxes-listed-dark-${testInfo.workerIndex}-${Date.now()}`,
		);
		await captureCheckpoint(
			page,
			inboxesListedCheckpoint({ name: "readlist-preferences-inboxes-listed-dark", addresses }),
		);
	});

	test("says an inbox that can't be routed isn't available (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const { slug } = await openPreferences(
			page,
			`inbox-unavailable-light-${testInfo.workerIndex}-${Date.now()}`,
		);
		await reopenPreferences(page, { slug, query: "&preferences_error=unknown-inbox" });
		await captureCheckpoint(page, INBOX_UNAVAILABLE_LIGHT);
	});
});
