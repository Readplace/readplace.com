import { captureCheckpoint, expect, test } from "@packages/e2e-harness";
import type { Page } from "@playwright/test";
import { FIXED_NOW, popupListUrl, popupRuntimeStub, popupSaveUrl } from "./popup-visual-fixture";

/** The popup paints at its own fixed width; the viewport only has to be big
 * enough not to clip it. */
const VIEWPORT = { width: 640, height: 900 };

const LIST_VIEW = "#list-view:not([hidden])";
const SAVING_SKELETON = "#saving-view:not([hidden]) #saving-progress:not([hidden])";
const SAVE_FAILURE = "#save-failure:not([hidden])";
const LIST_SKELETON = "#list-skeleton-view:not([hidden])";

/** Captured apart from the list because a whole-popup diff can absorb a control
 * row that has grown, wrapped or pushed a neighbour out of frame. Framed alone,
 * the same change is most of the image. */
const HEADER = ".list-view__header";

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
	await expect(page.locator(".list-view__row")).toHaveCount(6);
	await expect(page.locator("#pagination")).toBeVisible();
	await expect(page.locator("[data-test-save-all-count]")).toHaveText("Save 10 tabs");
}

async function savingSettled(page: Page): Promise<void> {
	await expect(page.locator("#saving-progress")).toBeVisible();
	await expect(page.locator("#save-failure")).toBeHidden();
	await expect(page.locator("#saving-view")).toHaveAttribute("aria-busy", "true");
}

async function failureSettled(page: Page): Promise<void> {
	await expect(page.locator("#save-failure")).toBeVisible();
	await expect(page.locator("#save-retry-button")).toBeVisible();
	await expect(page.locator("#saving-view")).toHaveAttribute("aria-busy", "false");
}

async function listSkeletonSettled(page: Page): Promise<void> {
	await expect(page.locator(".list-skeleton__row")).toHaveCount(6);
	await expect(page.locator("#list-view")).toBeHidden();
	await expect(page.locator("#link-list > *")).toHaveCount(0);
	await expect(page.locator('#list-skeleton-view [role="status"]')).toBeVisible();
}

async function noOverflow(page: Page): Promise<void> {
	const overflow = await page
		.locator("body")
		.evaluate((body) => body.scrollWidth - body.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
}

async function skeletonRowsEqual(page: Page): Promise<void> {
	await noOverflow(page);
	const heights = await page
		.locator(".list-skeleton__row")
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
	expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
}

/** The pager's widest form is what makes this capture worth taking: first page,
 * gap, the five-page window, gap, last page, between both step controls. */
async function pagerShowsEveryControl(page: Page): Promise<void> {
	await expect(page.locator("#pagination > *")).toHaveCount(11);
	await expect(page.locator(".pagination__page--active")).toHaveText("5");
}

async function headerFitsOneRow(page: Page): Promise<void> {
	const overflow = await page
		.locator(HEADER)
		.evaluate((header) => header.scrollWidth - header.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	const heights = await page
		.locator(".list-view__actions > button")
		.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
	expect(new Set(heights).size).toBe(1);
}

async function heightsOf(page: Page, selectors: string[]): Promise<number[]> {
	const heights: number[] = [];
	for (const selector of selectors) {
		heights.push(
			await page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height),
		);
	}
	return heights;
}

/** Registers the popup's visual gate against one extension's packaged build.
 * Both extensions render the same popup from the same core stylesheet, so the
 * suite is declared once and each project supplies only the package to point at
 * — and owns the baselines its own engine produces. */
export function registerPopupVisualSuite(input: { packagedPopup: string }): void {
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
				geometry: pagerShowsEveryControl,
				target: "body",
				capture: "element",
				pinnedText: [],
			});
			await captureCheckpoint(page, {
				name: "popup-header-light",
				settled: listSettled,
				geometry: headerFitsOneRow,
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
					geometry: pagerShowsEveryControl,
					target: "body",
					capture: "element",
					pinnedText: [],
				});
				await captureCheckpoint(page, {
					name: "popup-header-dark",
					settled: listSettled,
					geometry: headerFitsOneRow,
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
				geometry: noOverflow,
				target: "body",
				capture: "element",
				pinnedText: [],
			});
		});

		test("swaps the saved card in without resizing the popup", async ({ page }) => {
			await openSaving(page);
			await page.waitForFunction(() => typeof window.__popupReleaseSave === "function");
			const skeletonHeight = await page
				.locator("#saving-view")
				.evaluate((el) => el.getBoundingClientRect().height);
			await page.evaluate(() => window.__popupReleaseSave?.());
			await page.waitForSelector("#saved-view:not([hidden])");
			const cardHeight = await page
				.locator("#saved-view")
				.evaluate((el) => el.getBoundingClientRect().height);
			expect(Math.abs(skeletonHeight - cardHeight)).toBeLessThanOrEqual(1);
		});

		test.describe("in dark mode", () => {
			test.use({ colorScheme: "dark" });

			test("opens on the saved-card skeleton against the dark palette", async ({ page }) => {
				await openSaving(page);
				await captureCheckpoint(page, {
					name: "popup-saving-dark",
					settled: savingSettled,
					geometry: noOverflow,
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
				geometry: noOverflow,
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
					geometry: noOverflow,
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
				geometry: skeletonRowsEqual,
				target: "body",
				capture: "element",
				pinnedText: [],
			});
		});

		test("swaps the real list in at the skeleton's geometry", async ({ page }) => {
			await openSkeleton(page);
			await page.waitForFunction(() => typeof window.__popupReleaseItems === "function");
			const before = await heightsOf(page, [
				".list-skeleton__header",
				".list-skeleton__search",
				".list-skeleton__rows",
				".list-skeleton__row",
			]);
			await page.evaluate(() => window.__popupReleaseItems?.());
			await page.waitForSelector(LIST_VIEW);
			await listSettled(page);
			const after = await heightsOf(page, [
				".list-view__header",
				".list-view__search",
				"#link-list",
				".list-view__row",
			]);
			for (let index = 0; index < before.length; index += 1) {
				expect(Math.abs(before[index] - after[index])).toBeLessThanOrEqual(1);
			}
		});

		test.describe("in dark mode", () => {
			test.use({ colorScheme: "dark" });

			test("renders the list skeleton against the dark palette", async ({ page }) => {
				await openSkeleton(page);
				await captureCheckpoint(page, {
					name: "popup-list-skeleton-dark",
					settled: listSkeletonSettled,
					geometry: skeletonRowsEqual,
					target: "body",
					capture: "element",
					pinnedText: [],
				});
			});
		});
	});

	test.describe("popup pagination feedback", () => {
		test("shows the busy overlay while a page loads", async ({ page }) => {
			await open(page, {
				url: popupListUrl(input.packagedPopup),
				stub: popupRuntimeStub({ holdLoadPage: true }),
				wait: LIST_VIEW,
			});
			await listSettled(page);
			await page.locator(".pagination__page:not(.pagination__page--active)").first().click();
			await expect(page.locator("#spinner-overlay")).toBeVisible();
			await page.waitForFunction(() => typeof window.__popupReleaseLoadPage === "function");
			await page.evaluate(() => window.__popupReleaseLoadPage?.());
			await expect(page.locator("#spinner-overlay")).toBeHidden();
		});
	});
}
