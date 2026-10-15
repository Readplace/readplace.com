import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { measureBoxes, neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TOLERANCE_PX = 1;

const DESIGN_WIDTH = { width: 1440, height: 900 };
const DESIGN_WIDTH_FROM_TOP = { width: 1440, height: 1540 };
const NARROW_DESKTOP = { width: 1100, height: 900 };
const TABLET = { width: 800, height: 1000 };
const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 320, height: 640 };

const MAIN = "main.import";
const TITLE = ".import__title";
const TABS = "[data-test-import-tabs]";
const PANEL = ".import__panel";
const PANEL_DESCRIPTION = ".import__panel-description";
const RAIL = ".import__rail";
const SOURCES = ".import__sources";
const FAQ = ".import__faq";
const LISTING = ".import__listing";
const FROM_URL_ROW = ".import__from-url-row";
const FROM_URL_FIELD = "[data-test-import-from-url-input]";
const FETCH_BUTTON = '[data-test-action="import-from-url-submit"]';
const FROM_URL_META = ".import__from-url-meta";
const UPLOAD_FORM = '[data-test-form="import-file"]';
const FILE_INPUT = "[data-test-import-file-input]";
const DROPZONE = "[data-import-dropzone]";
const DROPZONE_DISC = `${DROPZONE} .import__dropzone-icon`;
const UPLOAD_BUTTON = '[data-test-action="import-upload"]';
const UPLOADING = '[data-import-region="uploading"]';
const PROGRESS_BAR = "[data-import-progress-bar]";
const PROGRESS_LABEL = "[data-import-progress-label]";
const CARD_HEADERS = [
	`${RAIL} .disclosure-card__header`,
	`${SOURCES} .disclosure-card__header`,
	`${FAQ} .disclosure-card__header`,
];
const FAQ_STATIC_HEADER = `${FAQ} .disclosure-card__header--static`;
const FAQ_ITEM = `${FAQ} details.import__faq-item`;
const FAQ_SUMMARY = ".import__faq-summary";
const FAQ_CHEVRON = ".import__faq-chevron svg";
const FAQ_ANSWER = "[data-test-import-faq-answer]";
const POCKET_LINK = `${SOURCES} .import__source-text a`;
const REVIEW_LIST = "[data-test-import-list]";
const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];
const IMPORTED_URLS = [
	"https://example.com/essays/the-case-for-reading-slowly",
	"https://example.com/essays/notes-on-a-quiet-inbox",
	"https://example.com/essays/why-we-keep-saving-links",
];

function assertNear(input: { actual: number; expected: number }, message: string): void {
	assert.ok(
		Math.abs(input.actual - input.expected) <= TOLERANCE_PX,
		`${message}, measured ${input.actual} against ${input.expected}`,
	);
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

async function openImport(page: Page, query: string): Promise<void> {
	await page.context().addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
	await page.goto(`${BASE_URL}/import${query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-import");
}

async function openSignedInImport(page: Page, input: { stamp: string; query: string }): Promise<void> {
	await signInAsNewReader(page, `import-visual-${input.stamp}@example.com`);
	await openImport(page, input.query);
}

async function chooseLinksFile(page: Page): Promise<void> {
	await page.locator(FILE_INPUT).setInputFiles({
		name: "links.txt",
		mimeType: "text/plain",
		buffer: Buffer.from(IMPORTED_URLS.join("\n"), "utf-8"),
	});
}

async function openReview(page: Page): Promise<void> {
	await openImport(page, "?mode=upload");
	await chooseLinksFile(page);
	await page.waitForSelector(REVIEW_LIST);
}

async function restingPage(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function neverScrollsSideways(page: Page, view: string): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	assert.equal(await page.evaluate(pageOverflowsSideways), false, `${view} must not scroll sideways`);
}

async function designWidthColumns(page: Page): Promise<void> {
	const [title, tabs, panel, rail, sources] = await page.evaluate(measureBoxes, [TITLE, TABS, PANEL, RAIL, SOURCES]);
	assertNear({ actual: title.x, expected: 120 }, "at 1440 the column starts 120px in");
	assertNear({ actual: tabs.width, expected: 812 }, "at 1440 the main column is 812px wide");
	assertNear({ actual: panel.width, expected: 812 }, "at 1440 the panel fills the main column");
	assertNear({ actual: rail.x, expected: 980 }, "at 1440 the rail starts 980px in");
	assertNear({ actual: rail.width, expected: 340 }, "at 1440 the rail is 340px wide");
	assertNear({ actual: rail.y, expected: title.y }, "the rail starts level with the title");
	assertNear({ actual: panel.y - (tabs.y + tabs.height), expected: 32 }, "the panel sits 32px under the tabs");
	assertNear(
		{ actual: sources.y - (panel.y + panel.height), expected: 32 },
		"the sources card sits 32px under the panel",
	);
	const headers = await page.evaluate(measureBoxes, CARD_HEADERS);
	for (const [index, header] of headers.entries()) {
		assertNear({ actual: header.height, expected: 64 }, `${CARD_HEADERS[index]} keeps the 64px card header`);
	}
}

async function fromUrlCardRhythm(page: Page): Promise<void> {
	const [description, row, field, button, meta] = await page.evaluate(measureBoxes, [
		PANEL_DESCRIPTION,
		FROM_URL_ROW,
		FROM_URL_FIELD,
		FETCH_BUTTON,
		FROM_URL_META,
	]);
	assertNear({ actual: field.height, expected: 48 }, "the from-link field is 48px tall");
	assertNear({ actual: button.height, expected: 48 }, "the Fetch link button is 48px tall");
	assertNear({ actual: button.x - (field.x + field.width), expected: 8 }, "the button sits 8px after the field");
	assertNear(
		{ actual: row.y - (description.y + description.height), expected: 16 },
		"the field row sits 16px under the description",
	);
	assertNear({ actual: meta.y - (row.y + row.height), expected: 16 }, "the meta sits 16px under the field row");
}

async function pasteGeometry(page: Page): Promise<void> {
	await designWidthColumns(page);
	await fromUrlCardRhythm(page);
}

async function uploadGeometry(page: Page): Promise<void> {
	await designWidthColumns(page);
	const [dropzone, disc, upload] = await page.evaluate(measureBoxes, [DROPZONE, DROPZONE_DISC, UPLOAD_BUTTON]);
	const edge = await page
		.locator(DROPZONE)
		.evaluate((element) => `${getComputedStyle(element).borderTopWidth} ${getComputedStyle(element).borderTopStyle}`);
	assert.equal(edge, "1px dashed", "the dropzone draws a 1px dashed edge");
	assertNear({ actual: disc.width, expected: 40 }, "the dropzone's icon disc is 40px wide");
	assertNear({ actual: disc.height, expected: 40 }, "the dropzone's icon disc is 40px tall");
	assertNear({ actual: upload.x, expected: dropzone.x }, "the Upload button starts on the dropzone's left edge");
}

async function pageFromTopGeometry(page: Page): Promise<void> {
	await designWidthColumns(page);
	const [main] = await page.evaluate(measureBoxes, [MAIN]);
	const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
	assert.ok(
		main.y + main.height <= DESIGN_WIDTH_FROM_TOP.height,
		`the import page must fit the ${DESIGN_WIDTH_FROM_TOP.height}px viewport to be captured from the top, measured ${main.y + main.height}`,
	);
	assert.ok(
		pageHeight > DESIGN_WIDTH_FROM_TOP.height,
		`the footer must start below the fold so the page keeps its own height, measured ${pageHeight}`,
	);
}

async function faqCardGeometry(page: Page): Promise<void> {
	const [header] = await page.evaluate(measureBoxes, [FAQ_STATIC_HEADER]);
	assertNear({ actual: header.height, expected: 64 }, "the FAQ's static header keeps the 64px card header");
	const open = await page.locator(FAQ_ITEM).evaluateAll((items) => items.map((item) => item.hasAttribute("open")));
	assert.deepEqual(open, [true, true, false, false, false], "only the first two questions are open");
}

async function narrowDesktopColumns(page: Page): Promise<void> {
	const [title, tabs, rail] = await page.evaluate(measureBoxes, [TITLE, TABS, RAIL]);
	assertNear({ actual: title.x, expected: 24 }, "below 1200 the column starts at the 24px gutter");
	assertNear({ actual: rail.width, expected: 300 }, "below 1200 the rail is 300px wide");
	assertNear({ actual: rail.x - (tabs.x + tabs.width), expected: 24 }, "below 1200 the columns sit 24px apart");
	assertNear({ actual: rail.y, expected: title.y }, "the rail starts level with the title");
}

async function railFoldsBetweenPanelAndSources(page: Page): Promise<void> {
	const [tabs, panel, rail, sources] = await page.evaluate(measureBoxes, [TABS, PANEL, RAIL, SOURCES]);
	assertNear({ actual: rail.x, expected: tabs.x }, "the rail joins the single column");
	assertNear({ actual: rail.width, expected: tabs.width }, "the rail spans the single column");
	assert.ok(rail.y > panel.y + panel.height, "the rail folds under the panel");
	assert.ok(rail.y + rail.height < sources.y, "the rail folds above the sources card");
}

async function phonePasteGeometry(page: Page): Promise<void> {
	await railFoldsBetweenPanelAndSources(page);
	const [panel, field, button] = await page.evaluate(measureBoxes, [PANEL, FROM_URL_FIELD, FETCH_BUTTON]);
	assertNear({ actual: field.width, expected: panel.width - 50 }, "on a phone the field fills the card's content box");
	assertNear(
		{ actual: button.y - (field.y + field.height), expected: 16 },
		"on a phone the Fetch link button sits 16px under the field",
	);
	assertNear({ actual: field.height, expected: 48 }, "on a phone the field stays 48px tall");
	assertNear({ actual: button.height, expected: 48 }, "on a phone the button stays 48px tall");
	assert.ok(button.width < field.width, "on a phone the button keeps its own width under the field");
	await neverScrollsSideways(page, "the phone paste tab");
}

async function phoneUploadGeometry(page: Page): Promise<void> {
	await railFoldsBetweenPanelAndSources(page);
	const [panel, upload] = await page.evaluate(measureBoxes, [PANEL, UPLOAD_BUTTON]);
	assertNear({ actual: upload.width, expected: panel.width - 50 }, "on a phone Upload fills the card's content box");
	await neverScrollsSideways(page, "the phone upload tab");
}

async function dragoverShown(page: Page): Promise<void> {
	await restingPage(page);
	await expect(page.locator(DROPZONE)).toHaveClass(/import__dropzone--dragover/);
}

async function dragoverGeometry(page: Page): Promise<void> {
	const edge = await page.locator(DROPZONE).evaluate((element) => getComputedStyle(element).borderTopStyle);
	assert.equal(edge, "solid", "a file held over the dropzone turns its edge solid");
}

async function uploadingShown(page: Page): Promise<void> {
	await restingPage(page);
	await expect(page.locator(UPLOAD_FORM)).toHaveAttribute("data-import-state", "uploading");
	await expect(page.locator(PROGRESS_LABEL)).toHaveText("Preparing upload…");
}

async function uploadingGeometry(page: Page): Promise<void> {
	const [region, bar] = await page.evaluate(measureBoxes, [UPLOADING, PROGRESS_BAR]);
	assertNear({ actual: bar.height, expected: 6 }, "the upload bar is 6px tall");
	assertNear({ actual: bar.width, expected: region.width }, "the upload bar spans the card's content box");
}

async function reviewShown(page: Page): Promise<void> {
	await restingPage(page);
	await expect(page.locator(`${REVIEW_LIST} [data-test-import-url]`)).toHaveText(IMPORTED_URLS);
}

async function reviewGeometry(page: Page): Promise<void> {
	const [title, listing] = await page.evaluate(measureBoxes, [TITLE, LISTING]);
	assertNear({ actual: title.x, expected: 120 }, "at 1440 the review column starts 120px in");
	assertNear({ actual: listing.x, expected: 120 }, "at 1440 the listing starts on the column's edge");
	assertNear({ actual: listing.width, expected: 812 }, "at 1440 the listing keeps the 812px main column");
}

function mainCheckpoint(input: { name: string; geometry: (page: Page) => Promise<void> }): VisualCheckpoint {
	return {
		name: input.name,
		settled: restingPage,
		geometry: input.geometry,
		target: MAIN,
		capture: "element",
		pinnedText: [],
	};
}

const PASTE_LIGHT = mainCheckpoint({ name: "import-acquire-paste-light", geometry: pasteGeometry });
const PASTE_DARK = mainCheckpoint({ name: "import-acquire-paste-dark", geometry: pasteGeometry });
const UPLOAD_LIGHT = mainCheckpoint({ name: "import-acquire-upload-light", geometry: uploadGeometry });
const UPLOAD_DARK = mainCheckpoint({ name: "import-acquire-upload-dark", geometry: uploadGeometry });
const NARROW_DESKTOP_LIGHT = mainCheckpoint({ name: "import-acquire-1100-light", geometry: narrowDesktopColumns });
const PHONE_LIGHT = mainCheckpoint({ name: "import-acquire-phone-light", geometry: phonePasteGeometry });
const PHONE_DARK = mainCheckpoint({ name: "import-acquire-phone-dark", geometry: phonePasteGeometry });
const UPLOAD_PHONE_LIGHT = mainCheckpoint({ name: "import-acquire-upload-phone-light", geometry: phoneUploadGeometry });

const GUEST_FROM_TOP_LIGHT: VisualCheckpoint = {
	name: "import-acquire-guest-light",
	settled: restingPage,
	geometry: pageFromTopGeometry,
	target: MAIN,
	capture: "page-from-top",
	pinnedText: [],
};

const FAQ_OPEN_LIGHT: VisualCheckpoint = {
	name: "import-acquire-faq-open-light",
	settled: restingPage,
	geometry: faqCardGeometry,
	target: FAQ,
	capture: "element",
	pinnedText: [],
};

const DRAGOVER_LIGHT: VisualCheckpoint = {
	name: "import-upload-dropzone-dragover-light",
	settled: dragoverShown,
	geometry: dragoverGeometry,
	target: DROPZONE,
	capture: "element",
	pinnedText: [],
};

const UPLOADING_LIGHT: VisualCheckpoint = {
	name: "import-upload-uploading-light",
	settled: uploadingShown,
	geometry: uploadingGeometry,
	target: UPLOADING,
	capture: "element",
	pinnedText: [],
};

function reviewCheckpoint(name: string): VisualCheckpoint {
	return { name, settled: reviewShown, geometry: reviewGeometry, target: MAIN, capture: "element", pinnedText: [] };
}

const REVIEW_LIGHT = reviewCheckpoint("import-review-light");
const REVIEW_DARK = reviewCheckpoint("import-review-dark");

test.describe("Import page at the design width", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH });

	test("lays out Paste a link beside the How it works rail (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openSignedInImport(page, { stamp: `paste-light-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, PASTE_LIGHT);
	});

	test("lays out Paste a link beside the How it works rail (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openSignedInImport(page, { stamp: `paste-dark-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, PASTE_DARK);
	});

	test("lays out Upload a file with its dropzone (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openSignedInImport(page, { stamp: `upload-light-${testInfo.workerIndex}-${Date.now()}`, query: "?mode=upload" });
		await captureCheckpoint(page, UPLOAD_LIGHT);
	});

	test("lays out Upload a file with its dropzone (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openSignedInImport(page, { stamp: `upload-dark-${testInfo.workerIndex}-${Date.now()}`, query: "?mode=upload" });
		await captureCheckpoint(page, UPLOAD_DARK);
	});

	test("opens a question on a summary click and turns its chevron", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "");
		const items = page.locator(FAQ_ITEM);
		const closed = await items.evaluateAll((all) => all.map((item) => item.hasAttribute("open")));
		assert.deepEqual(closed, [false, false, false, false, false], "every question starts closed");

		const first = items.first();
		await first.locator(FAQ_SUMMARY).click();
		await expect(first).toHaveAttribute("open", "");
		await expect
			.poll(() => first.locator(FAQ_CHEVRON).evaluate((element) => getComputedStyle(element).transform))
			.toBe("matrix(-1, 0, 0, -1, 0, 0)");
		await expect(first.locator(FAQ_ANSWER)).toBeVisible();
		await expect(page.locator(POCKET_LINK)).toHaveCSS("text-decoration-line", "underline");
	});

	test("draws a question's focus ring inside the card's corners and clear of its text", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "");
		const last = page.locator(FAQ_ITEM).last();
		const summary = last.locator(FAQ_SUMMARY);
		await expect(summary).toHaveCSS("border-bottom-left-radius", "15px");
		await expect(summary).toHaveCSS("border-bottom-right-radius", "15px");

		await summary.focus();
		await page.keyboard.press("Enter");
		await expect(last).toHaveAttribute("open", "");
		await expect(summary).toHaveCSS("border-bottom-left-radius", "0px");
		await expect(summary).toHaveCSS("padding-bottom", "4px");
	});

	test("keeps the FAQ's static header still under the pointer", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "");
		const header = page.locator(FAQ_STATIC_HEADER);
		await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

		await header.hover();
		await header.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
		await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect(header).toHaveCSS("cursor", "auto");
	});

	test("shows the first two answers open in the FAQ card", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "");
		const summaries = page.locator(`${FAQ_ITEM} ${FAQ_SUMMARY}`);
		await summaries.nth(0).click();
		await summaries.nth(1).click();
		await summaries.nth(1).blur();
		await expect(page.locator(FAQ_ITEM).nth(1)).toHaveAttribute("open", "");
		await page.locator(FAQ).evaluate((element) => element.scrollIntoView({ block: "center" }));
		await captureCheckpoint(page, FAQ_OPEN_LIGHT);
	});

	test("tints the dropzone while a file is held over it", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "?mode=upload");
		await page.waitForLoadState("load");
		await page.locator(DROPZONE).dispatchEvent("dragenter");
		await captureCheckpoint(page, DRAGOVER_LIGHT);
	});

	test("swaps the dropzone for the upload bar while the file is on its way", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "?mode=upload");
		let releaseUpload: (() => void) | undefined;
		const uploadHeld = new Promise<void>((resolve) => {
			releaseUpload = resolve;
		});
		await page.route(
			(url) => url.pathname === "/import",
			async (route) => {
				await uploadHeld;
				await route.continue();
			},
		);
		await chooseLinksFile(page);
		await captureCheckpoint(page, UPLOADING_LIGHT);

		assert(releaseUpload, "the held upload must expose its release");
		releaseUpload();
		await page.waitForSelector(REVIEW_LIST);
	});

	test("keeps the review listing in the main column (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await signInAsNewReader(page, `import-visual-review-light-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openReview(page);
		await captureCheckpoint(page, REVIEW_LIGHT);
	});

	test("sits the review pager 16px below the listing card", async ({ page }, testInfo) => {
		await signInAsNewReader(page, `import-visual-review-pager-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openImport(page, "?mode=upload");
		const pagedUrls = Array.from({ length: 51 }, (_, index) => `https://example.com/essays/paged-${index}`);
		await page.locator(FILE_INPUT).setInputFiles({
			name: "links.txt",
			mimeType: "text/plain",
			buffer: Buffer.from(pagedUrls.join("\n"), "utf-8"),
		});
		await page.waitForSelector(REVIEW_LIST);
		await waitForBrandFonts(page, ["Inter"]);

		const [listing, pager] = await page.evaluate(measureBoxes, [LISTING, "[data-test-import-pagination]"]);

		assertNear({ actual: pager.y - (listing.y + listing.height), expected: 16 }, "the pager sits 16px below the card");
	});

	test("keeps the review listing in the main column (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await signInAsNewReader(page, `import-visual-review-dark-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openReview(page);
		await captureCheckpoint(page, REVIEW_DARK);
	});
});

test.describe("Import page at the design width, logged out from the top", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH_FROM_TOP });

	test("shows a guest the header, the intro and both columns", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "");
		await captureCheckpoint(page, GUEST_FROM_TOP_LIGHT);
	});
});

test.describe("Import page below 1200", () => {
	test.use({ timezoneId: "UTC", viewport: NARROW_DESKTOP });

	test("narrows the rail to 300px", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "");
		await captureCheckpoint(page, NARROW_DESKTOP_LIGHT);
	});
});

test.describe("Import page on a tablet", () => {
	test.use({ timezoneId: "UTC", viewport: TABLET });

	test("folds the rail into one column between the panel and the sources", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "");
		await waitForBrandFonts(page, ["Inter"]);
		await railFoldsBetweenPanelAndSources(page);
		const [title, tabs, panel] = await page.evaluate(measureBoxes, [TITLE, TABS, PANEL]);
		assertNear({ actual: title.x, expected: 24 }, "on a tablet the column starts at the 24px gutter");
		assertNear({ actual: panel.y - (tabs.y + tabs.height), expected: 24 }, "on a tablet the panel sits 24px under the tabs");
		await neverScrollsSideways(page, "the tablet paste tab");
	});
});

test.describe("Import page on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("stacks Fetch link under the field (light)", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "");
		await captureCheckpoint(page, PHONE_LIGHT);
	});

	test("stacks Fetch link under the field (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openSignedInImport(page, { stamp: `phone-dark-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, PHONE_DARK);
	});

	test("stretches Upload across the card", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openImport(page, "?mode=upload");
		await captureCheckpoint(page, UPLOAD_PHONE_LIGHT);
	});
});

for (const viewport of [SMALL_PHONE, PHONE]) {
	test.describe(`Import flow at ${viewport.width}px`, () => {
		test.use({ timezoneId: "UTC", viewport });

		test("never scrolls sideways on either tab or the review", async ({ page }) => {
			await page.emulateMedia({ colorScheme: "light" });
			await openImport(page, "");
			await neverScrollsSideways(page, `the paste tab at ${viewport.width}px`);
			await openImport(page, "?mode=upload");
			await neverScrollsSideways(page, `the upload tab at ${viewport.width}px`);
			await openReview(page);
			await neverScrollsSideways(page, `the review at ${viewport.width}px`);
		});
	});
}

test.describe("Import FAQ without client JavaScript", () => {
	test.use({ timezoneId: "UTC", viewport: DESIGN_WIDTH, javaScriptEnabled: false });

	test("a summary click opens its question", async ({ page }) => {
		await openImport(page, "");
		const first = page.locator(FAQ_ITEM).first();
		await first.locator(FAQ_SUMMARY).click();
		await expect(first).toHaveAttribute("open", "");
		await expect(first.locator(FAQ_ANSWER)).toBeVisible();
	});
});
