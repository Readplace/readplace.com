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
const PREFERENCES = "[data-test-readlist-preferences]";
const PREFERENCES_TAB = '[data-test-filter="preferences"]';
const SETUP_TRIGGER = '[data-test-action="readlist-preferences-setup"]';
const EDIT_TRIGGER = '[data-test-action="readlist-preferences-edit"]';
const PURPOSE_TEXT = "[data-test-preferences-purpose]";
const INBOXES = "[data-test-readlist-inboxes]";
const INBOX_ROWS = "[data-test-preferences-inbox]";
const INBOXES_DESCRIPTION = "[data-test-inboxes-description]";
const CREATE_INBOX = '[data-test-action="create-inbox"]';
const TABS = "[data-test-filters]";
const ALERT = "[data-test-readlist-error]";
const ALERT_TITLE = "[data-test-readlist-error-title]";

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

async function createReadlistFromRail(page: Page): Promise<string> {
	await clickAndWaitForPageReload(page, page.locator('[data-test-action="new-readlist"]'));
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
	const slug = await createReadlistFromRail(page);
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
	const elsewhere = await createReadlistFromRail(page);
	const addresses = await seedInboxes(page, {
		userId,
		inboxes: [{ name: "news", readlist: slug }, { name: "tech", readlist: elsewhere }, { name: "deals" }],
	});
	await reopenPreferences(page, { slug });
	return addresses;
}

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

test.describe("Readlist preferences inboxes", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

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
