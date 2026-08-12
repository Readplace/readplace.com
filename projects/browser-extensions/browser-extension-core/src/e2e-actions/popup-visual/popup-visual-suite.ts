import { captureCheckpoint, expect, test } from "@packages/e2e-harness";
import type { Page } from "@playwright/test";
import { FIXED_NOW, popupListUrl, popupRuntimeStub } from "./popup-visual-fixture";

/** The popup paints at its own fixed width; the viewport only has to be big
 * enough not to clip it. */
const VIEWPORT = { width: 640, height: 900 };

const LIST_VIEW = "#list-view:not([hidden])";

/** Captured apart from the list because a whole-popup diff can absorb a control
 * row that has grown, wrapped or pushed a neighbour out of frame. Framed alone,
 * the same change is most of the image. */
const HEADER = ".list-view__header";

async function listSettled(page: Page): Promise<void> {
	await expect(page.locator(".list-view__row")).toHaveCount(6);
	await expect(page.locator("#pagination")).toBeVisible();
	await expect(page.locator("[data-test-save-all-count]")).toHaveText("Save 10 tabs");
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

/** Registers the popup's visual gate against one extension's packaged build.
 * Both extensions render the same popup from the same core stylesheet, so the
 * suite is declared once and each project supplies only the package to point at
 * — and owns the baselines its own engine produces. */
export function registerPopupVisualSuite(input: { packagedPopup: string }): void {
	async function openList(page: Page): Promise<void> {
		await page.clock.install({ time: FIXED_NOW });
		await page.addInitScript(popupRuntimeStub());
		await page.setViewportSize(VIEWPORT);
		await page.goto(popupListUrl(input.packagedPopup));
		await page.waitForSelector(LIST_VIEW);
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
}
