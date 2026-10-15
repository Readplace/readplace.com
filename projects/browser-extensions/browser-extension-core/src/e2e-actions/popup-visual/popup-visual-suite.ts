import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	LENSES,
	NON_TEXT_MINIMUM,
	type Rgb,
	captureCheckpoint,
	contrastRatio,
	expect,
	test,
	textMinimum,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import type { Page } from "@playwright/test";
import { FIXED_NOW, OVERSIZED_TITLE, WIDE_TITLE, popupListUrl, popupRuntimeStub, popupSaveUrl } from "./popup-visual-fixture";

const VIEWPORT = { width: 1024, height: 900 };

const LIST_VIEW = "#list-view:not([hidden])";
const SAVING_SKELETON = "#saving-view:not([hidden]) #saving-progress:not([hidden])";
const SAVE_FAILURE = "#save-failure:not([hidden])";
const LIST_SKELETON = "#list-skeleton-view:not([hidden])";

/** Captured apart from the list because a whole-popup diff can absorb a control
 * row that has grown, wrapped or pushed a neighbour out of frame. Framed alone,
 * the same change is most of the image. */
const HEADER = ".list-view__header";

const PINNED_NEWEST_SAVE = [{ selector: ".list-view__fact--saved .list-view__fact-text", text: "just now" }];

async function open(
	page: Page,
	opts: { url: string; stub: string; wait: string },
): Promise<void> {
	await page.clock.install({ time: FIXED_NOW });
	await page.addInitScript(opts.stub);
	await page.setViewportSize(VIEWPORT);
	await page.goto(opts.url);
	await page.waitForSelector(opts.wait);
}

async function listSettled(page: Page): Promise<void> {
	await expect(page.locator(".list-view__row")).toHaveCount(4);
	await expect(page.locator("#pagination")).toBeVisible();
	await expect(page.locator("[data-test-save-all-count]")).toHaveText("Save 10 tabs");
	await expect(page.locator("[data-test-list-count]")).toHaveText("86 Saved Articles");
	await expect(page.locator("#sort-button")).toHaveText("Newest first");
}

async function savingSettled(page: Page): Promise<void> {
	await expect(page.locator("#saving-progress")).toBeVisible();
	await expect(page.locator("#saving-status")).toBeVisible();
	await expect(page.locator("#save-failure")).toHaveCount(1);
	await expect(page.locator("#save-failure")).toBeHidden();
	await expect(page.locator("#saving-view")).toHaveAttribute("aria-busy", "true");
}

async function failureSettled(page: Page): Promise<void> {
	await expect(page.locator("#save-failure")).toBeVisible();
	await expect(page.locator("#save-retry-button")).toBeVisible();
	await expect(page.locator("#saving-status")).toBeHidden();
	await expect(page.locator("#saving-view")).toHaveAttribute("aria-busy", "false");
}

async function loginSettled(page: Page): Promise<void> {
	await expect(page.locator("#login-view")).toBeVisible();
	await expect(page.locator("#login-button")).toBeVisible();
}

async function savedSettled(page: Page): Promise<void> {
	await expect(page.locator("#saved-view")).toBeVisible();
	await expect(page.locator("#saved-affordances button")).toBeVisible();
}

async function saveAllSettled(page: Page): Promise<void> {
	await expect(page.locator("#save-all-view-readlist")).toBeVisible();
	await expect(page.locator("#save-all-failed > li")).toHaveCount(3);
}

async function emptySettled(page: Page): Promise<void> {
	await expect(page.locator("#empty-list")).toBeVisible();
	await expect(page.locator("#pagination")).toBeHidden();
	for (const unframed of ["#list-header", ".list-view__search"]) {
		await expect(page.locator(unframed)).toHaveCSS("display", "none");
	}
}

async function messagesSettled(page: Page): Promise<void> {
	await expect(page.locator("#messages > .alert")).toHaveCount(3);
	await expect(page.locator(".list-view__row")).toHaveCount(1);
	await expect(page.locator("[data-test-list-count]")).toHaveText("86 Saved Articles");
}

async function listErrorSettled(page: Page): Promise<void> {
	await expect(page.locator('#list-error[role="alert"]')).toBeVisible();
	await expect(page.locator("#list-error-title")).toHaveText("Couldn't load your articles");
}

async function listSkeletonSettled(page: Page): Promise<void> {
	await expect(page.locator(".list-skeleton__row")).toHaveCount(5);
	await expect(page.locator("#list-view")).toBeHidden();
	await expect(page.locator("#link-list > *")).toHaveCount(0);
	await expect(page.locator('#list-skeleton-view [role="status"]')).toBeVisible();
}

async function noOverflow(page: Page): Promise<void> {
	const geometry = await page.evaluate(() => {
		const linkList = document.getElementById("link-list");
		return {
			bodyWidth: document.body.getBoundingClientRect().width,
			bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
			pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			linkListOverflow: linkList === null ? 0 : linkList.scrollWidth - linkList.clientWidth,
		};
	});
	expect(geometry.bodyWidth).toBe(Math.min(400, page.viewportSize()?.width ?? 0));
	expect(geometry.bodyOverflow).toBeLessThanOrEqual(0);
	expect(geometry.pageOverflow).toBeLessThanOrEqual(0);
	expect(geometry.linkListOverflow).toBeLessThanOrEqual(0);
}

async function frameIs400By600(page: Page): Promise<void> {
	const frame = await page.locator("body").evaluate((body) => {
		const bounds = body.getBoundingClientRect();
		return { width: bounds.width, height: bounds.height };
	});
	expect(frame).toEqual({ width: 400, height: 600 });
}

function framed(geometry: (page: Page) => Promise<void>): (page: Page) => Promise<void> {
	return async (page) => {
		await frameIs400By600(page);
		await geometry(page);
	};
}

async function rowActionHitArea(page: Page): Promise<void> {
	const hitArea = await page.locator(".list-view__action").first().evaluate((button) => {
		const target = getComputedStyle(button, "::before");
		return button.getBoundingClientRect().height - Number.parseFloat(target.top) - Number.parseFloat(target.bottom);
	});
	expect(hitArea).toBeGreaterThanOrEqual(44);
}

async function sortTapFloor(page: Page): Promise<void> {
	const [sort, count] = await Promise.all(
		["#sort-button", ".list-view__count"].map((selector) =>
			page.locator(selector).evaluate((element) => element.getBoundingClientRect().height),
		),
	);
	expect([sort, count]).toEqual([36, 20]);
}

async function listGeometry(page: Page): Promise<void> {
	await pagerShowsEveryControl(page);
	await rowActionHitArea(page);
	await sortTapFloor(page);
}

async function skeletonRowsEqual(page: Page): Promise<void> {
	await noOverflow(page);
	const heights = await page
		.locator(".list-skeleton__row")
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
	expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
}

async function pagerShowsEveryControl(page: Page): Promise<void> {
	await noOverflow(page);
	await expect(page.locator("#pagination > *")).toHaveCount(9);
	await expect(page.locator(".pagination__page--current")).toHaveText("5");
}

async function headerFitsOneRow(page: Page): Promise<void> {
	const overflow = await page
		.locator(HEADER)
		.evaluate((header) => header.scrollWidth - header.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	const heights = await page
		.locator(".list-view__actions > button")
		.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
	expect(heights).toEqual([32, 32]);
}

async function boxesOf(page: Page, selectors: string[]): Promise<{ top: number; height: number }[]> {
	const boxes: { top: number; height: number }[] = [];
	for (const selector of selectors) {
		boxes.push(
			await page.locator(selector).first().evaluate((el) => {
				const bounds = el.getBoundingClientRect();
				return { top: bounds.top, height: bounds.height };
			}),
		);
	}
	return boxes;
}

async function extentOf(
	page: Page,
	group: { first: string; last: string },
): Promise<{ top: number; height: number }> {
	const top = await page.locator(group.first).evaluate((el) => el.getBoundingClientRect().top);
	const bottom = await page.locator(group.last).evaluate((el) => el.getBoundingClientRect().bottom);
	return { top, height: bottom - top };
}

function spread(values: number[]): number {
	return Math.max(...values) - Math.min(...values);
}

function rgbOf(css: string): Rgb {
	const channels = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/.exec(css);
	assert.ok(channels, `expected an rgb() colour, got "${css}"`);
	return { red: Number(channels[1]), green: Number(channels[2]), blue: Number(channels[3]) };
}

type InkRole = "text" | "non-text";

type InkProbe = {
	name: string;
	selector: string;
	ink: "color" | "border";
	surface: "ground" | "own";
	role: InkRole;
};

type InkPair = {
	name: string;
	ink: string;
	surface: string;
	role: InkRole;
	fontSizePx: number;
	fontWeight: number;
};

async function inkPairs(page: Page, probes: readonly InkProbe[]): Promise<InkPair[]> {
	const measured: InkPair[] = [];
	const ground = await page
		.locator(".list-view__main")
		.evaluate((main) => getComputedStyle(main).backgroundColor);
	for (const pair of probes) {
		const element = await page.locator(pair.selector).first().evaluate((el) => {
			const style = getComputedStyle(el);
			return {
				color: style.color,
				border: style.boxShadow,
				fill: style.backgroundColor,
				fontSizePx: Number.parseFloat(style.fontSize),
				fontWeight: Number.parseFloat(style.fontWeight),
			};
		});
		measured.push({
			name: pair.name,
			ink: pair.ink === "color" ? element.color : element.border,
			surface: pair.surface === "ground" ? ground : element.fill,
			role: pair.role,
			fontSizePx: element.fontSizePx,
			fontWeight: element.fontWeight,
		});
	}
	return measured;
}

function contrastShortfalls(pairs: InkPair[]): string[] {
	const shortfalls: string[] = [];
	for (const [lensName, lens] of Object.entries(LENSES)) {
		for (const pair of pairs) {
			const ratio = contrastRatio({ ink: lens(rgbOf(pair.ink)), surface: lens(rgbOf(pair.surface)) });
			const minimum = pair.role === "text" ? textMinimum(pair) : NON_TEXT_MINIMUM;
			if (ratio < minimum) {
				shortfalls.push(
					`${lensName}: ${pair.name} is ${ratio.toFixed(2)}:1 (${pair.ink} on ${pair.surface}), below ${minimum}:1`,
				);
			}
		}
	}
	return shortfalls;
}

const LIST_INK: readonly InkProbe[] = [
	{ name: "row title", selector: ".list-view__item-title", ink: "color", surface: "ground", role: "text" },
	{
		name: "site fact",
		selector: ".list-view__fact--site .list-view__fact-text",
		ink: "color",
		surface: "ground",
		role: "text",
	},
	{
		name: "saved fact",
		selector: ".list-view__fact--saved .list-view__fact-text",
		ink: "color",
		surface: "ground",
		role: "text",
	},
	{
		name: "site glyph",
		selector: ".list-view__fact--site .list-view__fact-icon",
		ink: "color",
		surface: "ground",
		role: "non-text",
	},
	{
		name: "saved glyph",
		selector: ".list-view__fact--saved .list-view__fact-icon",
		ink: "color",
		surface: "ground",
		role: "non-text",
	},
	{ name: "count", selector: ".list-view__count", ink: "color", surface: "ground", role: "text" },
	{ name: "sort", selector: "#sort-button", ink: "color", surface: "ground", role: "text" },
	{ name: "row action label", selector: ".list-view__action", ink: "color", surface: "own", role: "text" },
	{ name: "row action border", selector: ".list-view__action", ink: "border", surface: "ground", role: "non-text" },
];

const EMPTY_INK: readonly InkProbe[] = [
	{ name: "empty title", selector: "#empty-list .list-empty__title", ink: "color", surface: "ground", role: "text" },
	{ name: "empty body", selector: "#empty-list .list-empty__body", ink: "color", surface: "ground", role: "text" },
];

const FALLBACK_FONT = '"Source Sans Pro", system-ui, -apple-system, sans-serif';

async function renderWithFallbackFont(page: Page): Promise<void> {
	await page.evaluate((family) => {
		document.body.style.fontFamily = family;
	}, FALLBACK_FONT);
}

async function renderWithBrandFont(page: Page): Promise<void> {
	await page.evaluate(() => {
		document.body.style.removeProperty("font-family");
	});
}

const SKELETON_TWINS = [
	{ list: ".list-view__header", skeleton: ".list-skeleton__header" },
	{ list: ".list-view__search", skeleton: ".list-skeleton__search" },
	{ list: ".list-view__list-header", skeleton: ".list-skeleton__list-header" },
	{ list: ".list-view__body", skeleton: ".list-skeleton__rows" },
	{ list: ".list-view__row", skeleton: ".list-skeleton__row" },
];

const SAVING_EXTENT = { first: "#saving-progress", last: "#saving-status" };

const SAVED_CARD_EXTENT = { first: ".saved-view__icon", last: "#save-shortcut-hint" };

const PINNED_CONTROLS = [".list-view__header", ".list-view__search", "#list-header", "#pagination"];

/** Registers the popup's visual gate against one extension's packaged build.
 * Both extensions render the same popup from the same core stylesheet, so the
 * suite is declared once and each project supplies only the package to point at
 * — and owns the baselines its own engine produces. */
export function registerPopupVisualSuite(input: { packagedPopup: string }): void {
	const startupHtml = readFileSync(input.packagedPopup, "utf-8").replace(
		'<script src="popup-entry.browser.js"></script>',
		"",
	);

	async function openStartup(page: Page): Promise<void> {
		await page.setViewportSize(VIEWPORT);
		await page.setContent(startupHtml);
		await expect(page.locator(".popup-shell #saving-progress")).toBeVisible();
		await noOverflow(page);
		await frameIs400By600(page);
	}

	test.describe("popup startup shell", () => {
		test("centers the placeholder before application assets load", async ({ page }) => {
			await openStartup(page);
			await expect(page.locator("body")).toHaveScreenshot("popup-startup-light.png");
		});

		test.describe("in dark mode", () => {
			test.use({ colorScheme: "dark" });

			test("centers the placeholder against the dark palette", async ({ page }) => {
				await openStartup(page);
				await expect(page.locator("body")).toHaveScreenshot("popup-startup-dark.png");
			});
		});
	});

	test("fits startup, loading and loaded content at each viewport width", async ({ page }) => {
		await page.clock.install({ time: FIXED_NOW });
		await page.addInitScript(popupRuntimeStub({ holdItems: true }));

		for (const width of [350, 640, 800, 1024]) {
			await page.setViewportSize({ width, height: VIEWPORT.height });
			await page.setContent(startupHtml);
			await expect(page.locator(".popup-shell #saving-progress")).toBeVisible();
			await noOverflow(page);

			const centered = await page.locator(".popup-shell .saving-view__icon, .popup-shell .saving-view__bar--title, .popup-shell .saving-view__bar--subtitle, .popup-shell .saving-view__action, .popup-shell .saving-view__bar--hint").evaluateAll((elements) => {
				const center = document.body.getBoundingClientRect().left + document.body.getBoundingClientRect().width / 2;
				return elements.every((element) => Math.abs(element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2 - center) <= 1);
			});
			expect(centered).toBe(true);

			await page.goto(popupListUrl(input.packagedPopup));
			await page.waitForSelector(LIST_SKELETON);
			await noOverflow(page);
			await page.waitForFunction(() => typeof window.__popupReleaseItems === "function");
			await page.evaluate(() => window.__popupReleaseItems?.());
			await page.waitForSelector(LIST_VIEW);
			await listSettled(page);
			await noOverflow(page);

			const controlsFit = await page.locator("#list-view button:visible, #list-view input:visible, #list-view a:visible").evaluateAll((elements) => {
				const body = document.body.getBoundingClientRect();
				return elements.every((element) => {
					const bounds = element.getBoundingClientRect();
					return bounds.left >= body.left - 1 && bounds.right <= body.right + 1;
				});
			});
			expect(controlsFit).toBe(true);

			const titles = await page.locator(".list-view__item-title").evaluateAll((elements) => elements.slice(0, 2).map((element) => ({
				text: element.textContent,
				tooltip: element.getAttribute("title"),
				whiteSpace: getComputedStyle(element).whiteSpace,
				truncated: element.scrollWidth > element.clientWidth,
			})));
			expect(titles[0]?.text).toBe(WIDE_TITLE);
			expect(titles[0]?.tooltip).toBe(WIDE_TITLE);
			expect(titles[1]?.text).toBe(OVERSIZED_TITLE);
			expect(titles[1]?.tooltip).toBe(OVERSIZED_TITLE);
			expect(titles.every((title) => title.whiteSpace === "nowrap")).toBe(true);
			expect(titles.map((title) => title.truncated)).toEqual([true, true]);
		}
	});

	async function openList(page: Page): Promise<void> {
		await open(page, {
			url: popupListUrl(input.packagedPopup),
			stub: popupRuntimeStub(),
			wait: LIST_VIEW,
		});
	}

	test.describe("popup list state", () => {
		test("renders the saved list, its widest pager and the header controls", async ({ page }) => {
			await openList(page);
			await captureCheckpoint(page, {
				name: "popup-list-light",
				settled: listSettled,
				geometry: framed(listGeometry),
				target: "body",
				capture: "element",
				pinnedText: PINNED_NEWEST_SAVE,
			});
			await captureCheckpoint(page, {
				name: "popup-header-light",
				settled: listSettled,
				geometry: framed(headerFitsOneRow),
				target: HEADER,
				capture: "element",
				pinnedText: [],
			});
		});

		test.describe("in dark mode", () => {
			test.use({ colorScheme: "dark" });

			test("renders the same list against the dark palette", async ({ page }) => {
				await openList(page);
				await captureCheckpoint(page, {
					name: "popup-list-dark",
					settled: listSettled,
					geometry: framed(listGeometry),
					target: "body",
					capture: "element",
					pinnedText: PINNED_NEWEST_SAVE,
				});
				await captureCheckpoint(page, {
					name: "popup-header-dark",
					settled: listSettled,
					geometry: framed(headerFitsOneRow),
					target: HEADER,
					capture: "element",
					pinnedText: [],
				});
			});
		});
	});

	test.describe("popup saving state", () => {
		async function openSaving(page: Page): Promise<void> {
			await open(page, {
				url: popupSaveUrl(input.packagedPopup),
				stub: popupRuntimeStub({ saveReplies: ["hold"] }),
				wait: SAVING_SKELETON,
			});
		}

		test("opens on the saved-card skeleton", async ({ page }) => {
			await openSaving(page);
			await captureCheckpoint(page, {
				name: "popup-saving-light",
				settled: savingSettled,
				geometry: framed(noOverflow),
				target: "body",
				capture: "element",
				pinnedText: [],
			});
		});

		test("swaps the saved card in at the skeleton's extent", async ({ page }) => {
			await openSaving(page);
			await page.waitForFunction(() => typeof window.__popupReleaseSave === "function");
			await renderWithFallbackFont(page);
			const skeletonFallback = await extentOf(page, SAVING_EXTENT);
			await page.evaluate(async () => {
				await document.fonts.load("16px Inter");
			});
			await waitForBrandFonts(page, ["Inter"]);
			await renderWithBrandFont(page);
			const skeletonLoaded = await extentOf(page, SAVING_EXTENT);
			await renderWithFallbackFont(page);
			await page.evaluate(() => window.__popupReleaseSave?.());
			await page.waitForSelector("#saved-view:not([hidden])");
			const cardFallback = await extentOf(page, SAVED_CARD_EXTENT);
			await renderWithBrandFont(page);
			const cardLoaded = await extentOf(page, SAVED_CARD_EXTENT);
			const phases = [skeletonFallback, skeletonLoaded, cardFallback, cardLoaded];
			expect(spread(phases.map((phase) => phase.top))).toBeLessThanOrEqual(1);
			expect(spread(phases.map((phase) => phase.height))).toBeLessThanOrEqual(1);
		});

		test.describe("in dark mode", () => {
			test.use({ colorScheme: "dark" });

			test("opens on the saved-card skeleton against the dark palette", async ({ page }) => {
				await openSaving(page);
				await captureCheckpoint(page, {
					name: "popup-saving-dark",
					settled: savingSettled,
					geometry: framed(noOverflow),
					target: "body",
					capture: "element",
					pinnedText: [],
				});
			});
		});
	});

	test.describe("popup save failure", () => {
		async function openFailed(page: Page): Promise<void> {
			await open(page, {
				url: popupSaveUrl(input.packagedPopup),
				stub: popupRuntimeStub({ saveReplies: ["error"] }),
				wait: SAVE_FAILURE,
			});
		}

		test("paints the failure in place", async ({ page }) => {
			await openFailed(page);
			await captureCheckpoint(page, {
				name: "popup-save-failed-light",
				settled: failureSettled,
				geometry: framed(noOverflow),
				target: "body",
				capture: "element",
				pinnedText: [],
			});
		});

		test("retry re-runs the save for the same resolved target", async ({ page }) => {
			await open(page, {
				url: popupSaveUrl(input.packagedPopup),
				stub: popupRuntimeStub({ saveReplies: ["error", "saved"] }),
				wait: SAVE_FAILURE,
			});
			await page.locator("#save-retry-button").click();
			await page.waitForSelector("#saved-view:not([hidden])");
			const messages = await page.evaluate(() => window.__popupSaveMessages);
			expect(messages).toHaveLength(2);
			expect(messages[1]).toEqual(messages[0]);
		});

		test.describe("in dark mode", () => {
			test.use({ colorScheme: "dark" });

			test("paints the failure in place against the dark palette", async ({ page }) => {
				await openFailed(page);
				await captureCheckpoint(page, {
					name: "popup-save-failed-dark",
					settled: failureSettled,
					geometry: framed(noOverflow),
					target: "body",
					capture: "element",
					pinnedText: [],
				});
			});
		});
	});

	test.describe("popup list skeleton", () => {
		async function openSkeleton(page: Page): Promise<void> {
			await open(page, {
				url: popupListUrl(input.packagedPopup),
				stub: popupRuntimeStub({ holdItems: true }),
				wait: LIST_SKELETON,
			});
		}

		test("renders the list skeleton while the collection loads", async ({ page }) => {
			await openSkeleton(page);
			await captureCheckpoint(page, {
				name: "popup-list-skeleton-light",
				settled: listSkeletonSettled,
				geometry: framed(skeletonRowsEqual),
				target: "body",
				capture: "element",
				pinnedText: [],
			});
		});

		test("swaps the real list in at the skeleton's geometry", async ({ page }) => {
			await openSkeleton(page);
			await page.waitForFunction(() => typeof window.__popupReleaseItems === "function");
			const skeletonSelectors = SKELETON_TWINS.map((twin) => twin.skeleton);
			const listSelectors = SKELETON_TWINS.map((twin) => twin.list);
			await renderWithFallbackFont(page);
			const skeletonFallback = await boxesOf(page, skeletonSelectors);
			await page.evaluate(async () => {
				await document.fonts.load("13px Inter");
			});
			await waitForBrandFonts(page, ["Inter"]);
			await renderWithBrandFont(page);
			const skeletonLoaded = await boxesOf(page, skeletonSelectors);
			await renderWithFallbackFont(page);
			await page.evaluate(() => window.__popupReleaseItems?.());
			await page.waitForSelector(LIST_VIEW);
			await listSettled(page);
			const listFallback = await boxesOf(page, listSelectors);
			await renderWithBrandFont(page);
			const listLoaded = await boxesOf(page, listSelectors);
			for (const [index, twin] of SKELETON_TWINS.entries()) {
				const boxes = [skeletonFallback, skeletonLoaded, listFallback, listLoaded].map((phase) => phase[index]);
				expect(spread(boxes.map((box) => box.top)), `${twin.list} top`).toBeLessThanOrEqual(1);
				expect(spread(boxes.map((box) => box.height)), `${twin.list} height`).toBeLessThanOrEqual(1);
			}
		});

		test.describe("in dark mode", () => {
			test.use({ colorScheme: "dark" });

			test("renders the list skeleton against the dark palette", async ({ page }) => {
				await openSkeleton(page);
				await captureCheckpoint(page, {
					name: "popup-list-skeleton-dark",
					settled: listSkeletonSettled,
					geometry: framed(skeletonRowsEqual),
					target: "body",
					capture: "element",
					pinnedText: [],
				});
			});
		});
	});

	test.describe("popup pagination feedback", () => {
		test("dims the list while a page loads", async ({ page }) => {
			await open(page, {
				url: popupListUrl(input.packagedPopup),
				stub: popupRuntimeStub({ holdLoadPage: true }),
				wait: LIST_VIEW,
			});
			await listSettled(page);
			await page.locator("button.pagination__page").first().click();
			await expect(page.locator("#link-list")).toHaveAttribute("aria-busy", "true");
			await expect(page.locator("#link-list")).toHaveClass(/list-view__links--pending/);
			await page.waitForFunction(() => typeof window.__popupReleaseLoadPage === "function");
			await page.evaluate(() => window.__popupReleaseLoadPage?.());
			await expect(page.locator("#link-list")).toHaveAttribute("aria-busy", "false");
			await expect(page.locator("#link-list")).not.toHaveClass(/list-view__links--pending/);
		});
	});

	test.describe("popup long list", () => {
		test("scrolls the rows while the header, search, count row and pager stay put", async ({ page }) => {
			await open(page, {
				url: popupListUrl(input.packagedPopup),
				stub: popupRuntimeStub({ rowCount: 10 }),
				wait: LIST_VIEW,
			});
			await expect(page.locator(".list-view__row")).toHaveCount(10);
			const links = page.locator("#link-list");
			const overflow = await links.evaluate((list) => list.scrollHeight - list.clientHeight);
			expect(overflow).toBeGreaterThan(0);
			const before = await boxesOf(page, PINNED_CONTROLS);
			await links.evaluate((list) => {
				list.scrollTop = list.scrollHeight;
			});
			await expect.poll(() => links.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
			const after = await boxesOf(page, PINNED_CONTROLS);
			expect(after.map((box) => box.top)).toEqual(before.map((box) => box.top));
		});
	});

	test.describe("popup not-saveable page", () => {
		test("warns in place and drops the count row the refusal does not carry", async ({ page }) => {
			await open(page, {
				url: popupSaveUrl(input.packagedPopup),
				stub: popupRuntimeStub({ saveReplies: ["not-saveable"] }),
				wait: LIST_VIEW,
			});
			await expect(page.locator("#list-warning")).toBeVisible();
			await expect(page.locator("#list-warning .alert__message")).toHaveText(
				"Only http and https pages can be saved.",
			);
			await expect(page.locator(".list-view__row")).toHaveCount(4);
			await expect(page.locator("#list-header")).toHaveCount(1);
			await expect(page.locator("#list-header")).toBeHidden();
		});
	});

	for (const colorScheme of ["light", "dark"] as const) {
		test.describe(`popup contrast in ${colorScheme} mode`, () => {
			test.use({ colorScheme });

			test("keeps WCAG contrast on the list in colour and under the greyscale lens", async ({ page }) => {
				await openList(page);
				await listSettled(page);
				expect(contrastShortfalls(await inkPairs(page, LIST_INK))).toEqual([]);
			});

			test("keeps WCAG contrast on the empty list in colour and under the greyscale lens", async ({
				page,
			}) => {
				await open(page, {
					url: popupListUrl(input.packagedPopup),
					stub: popupRuntimeStub({ listReply: "empty" }),
					wait: "#empty-list:not([hidden])",
				});
				await emptySettled(page);
				expect(contrastShortfalls(await inkPairs(page, EMPTY_INK))).toEqual([]);
			});
		});
	}

	const STATES = [
		{
			name: "popup-login",
			describe: "popup sign in",
			url: popupListUrl(input.packagedPopup),
			stub: popupRuntimeStub({ listReply: "logged-out" }),
			wait: "#login-view:not([hidden])",
			settled: loginSettled,
		},
		{
			name: "popup-saved",
			describe: "popup saved",
			url: popupSaveUrl(input.packagedPopup),
			stub: popupRuntimeStub({ saveReplies: ["saved"] }),
			wait: "#saved-view:not([hidden])",
			settled: savedSettled,
		},
		{
			name: "popup-save-all",
			describe: "popup save all tabs",
			url: popupListUrl(input.packagedPopup),
			stub: popupRuntimeStub({ pendingBulkSave: true }),
			wait: "#save-all-view-readlist:not([hidden])",
			settled: saveAllSettled,
		},
		{
			name: "popup-empty",
			describe: "popup empty list",
			url: popupListUrl(input.packagedPopup),
			stub: popupRuntimeStub({ listReply: "empty" }),
			wait: "#empty-list:not([hidden])",
			settled: emptySettled,
		},
		{
			name: "popup-list-error",
			describe: "popup list error",
			url: popupListUrl(input.packagedPopup),
			stub: popupRuntimeStub({ listReply: "error" }),
			wait: "#list-error:not([hidden])",
			settled: listErrorSettled,
		},
		{
			name: "popup-list-messages",
			describe: "popup save refused with messages",
			url: popupSaveUrl(input.packagedPopup),
			stub: popupRuntimeStub({ saveReplies: ["messages"], rowCount: 1 }),
			wait: "#messages:not([hidden])",
			settled: messagesSettled,
		},
	];

	for (const state of STATES) {
		test.describe(state.describe, () => {
			test("renders against the light palette", async ({ page }) => {
				await open(page, { url: state.url, stub: state.stub, wait: state.wait });
				await captureCheckpoint(page, {
					name: `${state.name}-light`,
					settled: state.settled,
					geometry: framed(noOverflow),
					target: "body",
					capture: "element",
					pinnedText: [],
				});
			});

			test.describe("in dark mode", () => {
				test.use({ colorScheme: "dark" });

				test("renders against the dark palette", async ({ page }) => {
					await open(page, { url: state.url, stub: state.stub, wait: state.wait });
					await captureCheckpoint(page, {
						name: `${state.name}-dark`,
						settled: state.settled,
						geometry: framed(noOverflow),
						target: "body",
						capture: "element",
						pinnedText: [],
					});
				});
			});
		});
	}
}
