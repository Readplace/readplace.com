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
import { clickAndWaitForPageReload } from "./page-interactions";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const IMPORTED_URLS = [
	"https://example.com/essays/the-case-for-reading-slowly",
	"https://example.com/essays/notes-on-a-quiet-inbox",
	"https://example.com/essays/why-we-keep-saving-links",
];
const CHOICE_BOX_PX = 18;

const LISTING = ".import__listing";
const TOOLBAR = ".import__toolbar";
const SELECT_ALL = "[data-test-import-select-all]";
const SUMMARY_COUNT = "[data-test-import-summary] .import__summary-count";

function row(index: number): string {
	return `[data-test-import-row="${index}"]`;
}

function checkbox(index: number): string {
	return `[data-test-import-checkbox="${index}"]`;
}

async function signInAsNewReader(page: Page, email: string): Promise<void> {
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

async function openPartialSelection(page: Page, stamp: string): Promise<void> {
	await signInAsNewReader(page, `import-review-visual-${stamp}@example.com`);
	await page.goto(`${BASE_URL}/import?mode=upload`, { waitUntil: "domcontentloaded" });
	await page.locator("[data-test-import-file-input]").setInputFiles({
		name: "links.txt",
		mimeType: "text/plain",
		buffer: Buffer.from(IMPORTED_URLS.join("\n"), "utf-8"),
	});
	await page.waitForSelector("[data-test-import-list]");
	await expect(page.locator(SUMMARY_COUNT)).toHaveText("3");

	await clickAndWaitForPageReload(page, page.locator(checkbox(1)));
	await expect(page.locator(SUMMARY_COUNT)).toHaveText("2");
}

async function selectionShown(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await expect(page.locator(SELECT_ALL)).toBeChecked({ indeterminate: true });
	await expect(page.locator(checkbox(0))).toBeChecked();
	await expect(page.locator(checkbox(1))).toBeChecked({ checked: false });
	await expect(page.locator(checkbox(2))).toBeChecked();
	await expect(page.locator(row(1))).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await waitForBrandFonts(page, ["Inter"]);
}

async function toolbarHeadsOneCheckboxColumn(page: Page): Promise<void> {
	const listing = await measuredBox(page, LISTING);
	const toolbar = await measuredBox(page, TOOLBAR);
	const stacked = [
		["toolbar", toolbar],
		["first row", await measuredBox(page, row(0))],
		["second row", await measuredBox(page, row(1))],
		["third row", await measuredBox(page, row(2))],
	] as const;
	for (let i = 1; i < stacked.length; i++) {
		const [name, part] = stacked[i];
		const [aboveName, above] = stacked[i - 1];
		assert.ok(
			part.y >= above.y + above.height - 0.5,
			`the ${name} must sit below the ${aboveName}, not beside it`,
		);
	}
	for (const [name, part] of stacked) {
		assert.ok(
			part.x >= listing.x - 0.5 && part.x + part.width <= listing.x + listing.width + 0.5,
			`the ${name} must sit inside the listing card horizontally`,
		);
	}

	const master = await measuredBox(page, SELECT_ALL);
	const choices = [
		["master checkbox", master],
		["first row checkbox", await measuredBox(page, checkbox(0))],
		["second row checkbox", await measuredBox(page, checkbox(1))],
		["third row checkbox", await measuredBox(page, checkbox(2))],
	] as const;
	for (const [name, choice] of choices) {
		assert.equal(Math.round(choice.width), CHOICE_BOX_PX, `the ${name} must draw the shared choice box's width`);
		assert.equal(Math.round(choice.height), CHOICE_BOX_PX, `the ${name} must draw the shared choice box's height`);
		assert.ok(
			Math.abs(choice.x - master.x) <= 0.5,
			`the ${name} must sit in the master checkbox's column, measured ${choice.x} against ${master.x}`,
		);
	}
}

function selectionCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: selectionShown,
		geometry: toolbarHeadsOneCheckboxColumn,
		target: LISTING,
		capture: "element",
		pinnedText: [],
	};
}

const SELECTION_LIGHT = selectionCheckpoint("import-review-selection-light");
const SELECTION_DARK = selectionCheckpoint("import-review-selection-dark");

test.describe("Import review selection", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("shows the master checkbox mixed over one kept row and one dropped row (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPartialSelection(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, SELECTION_LIGHT);
	});

	test("shows the master checkbox mixed over one kept row and one dropped row (dark)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openPartialSelection(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, SELECTION_DARK);
	});
});
