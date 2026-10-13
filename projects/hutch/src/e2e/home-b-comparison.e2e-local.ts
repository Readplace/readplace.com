import assert from "node:assert/strict";
import { expect, test, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { EXPERIMENT_COOKIE_NAME } from "../runtime/web/experiments/homepage-assignment";
import { HOMEPAGE_SPLIT } from "../runtime/web/experiments/homepage-split";
import {
	HOME_COMPARE_CONTENT,
	HOME_COMPARE_FEATURES,
	HOME_COMPARE_PRICES,
} from "../runtime/web/pages/home-b/home-b-compare.content";
import { clickAndWaitForPageReload } from "./page-interactions";
import { pageOverflowsSideways, resolveColourTokens } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const TABLE = ".home-compare__table";
const SECTION_ORDER = ["principle", "compare", "pricing", "faq", "close"];
const VIEWPORTS = [
	{ width: 320, height: 800 },
	{ width: 390, height: 844 },
	{ width: 768, height: 1024 },
	{ width: 1440, height: 1000 },
];

for (const viewport of VIEWPORTS) {
	test.describe(`Homepage comparison at ${viewport.width}px`, () => {
		test.use({ viewport, timezoneId: "UTC" });

		test("keeps every comparison row readable and the comparison signup attributed", async ({ page }) => {
			await page.emulateMedia({ colorScheme: "light" });
			await page.context().addCookies([{
				name: EXPERIMENT_COOKIE_NAME,
				value: `${HOMEPAGE_SPLIT.campaign}:${HOMEPAGE_SPLIT.epoch}:${HOMEPAGE_SPLIT.variants[1].slug}`,
				url: BASE_URL,
			}]);
			await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("body.page-home.variant-b")).toHaveCount(1);
			await waitForBrandFonts(page, ["Inter"]);
			assert.equal(await page.evaluate(pageOverflowsSideways), false,
				`the homepage must fit its ${viewport.width}px viewport`);

			const bands = await page.locator("main.home > section").evaluateAll((sections, order) =>
				sections.filter((section) => order.some((key) => section.getAttribute("data-test-section") === key)).map((section) => {
					const style = getComputedStyle(section);
					return {
						key: section.getAttribute("data-test-section"),
						background: style.backgroundColor === "rgba(0, 0, 0, 0)"
							? getComputedStyle(document.body).backgroundColor
							: style.backgroundColor,
					};
				}), SECTION_ORDER);
			const [muted, background, primaryText] = await page.evaluate(resolveColourTokens, ["--muted", "--background", "--primary-text"]);
			assert.deepEqual(bands, [
				{ key: "principle", background: muted },
				{ key: "compare", background },
				{ key: "pricing", background: muted },
				{ key: "faq", background },
				{ key: "close", background: muted },
			], "the comparison must sit between the promise and pricing in alternating bands");

			const table = page.locator(TABLE);
			await expect(page.getByRole("table", { name: HOME_COMPARE_CONTENT.caption })).toHaveCount(1);
			await expect(table.getByRole("columnheader")).toHaveText([
				HOME_COMPARE_CONTENT.columns.feature,
				HOME_COMPARE_CONTENT.columns.readplace,
				HOME_COMPARE_CONTENT.columns.claude,
				HOME_COMPARE_CONTENT.columns.chatgpt,
			]);
			const rowCount = HOME_COMPARE_PRICES.length + HOME_COMPARE_FEATURES.length;
			await expect(table.getByRole("rowgroup")).toHaveCount(2);
			await expect(table.getByRole("row")).toHaveCount(rowCount + 1);
			await expect(table.getByRole("rowheader")).toHaveCount(rowCount);
			await expect(table.getByRole("cell")).toHaveCount(rowCount * 3);
			await expect(table.locator("tbody > tr")).toHaveCount(rowCount);
			await expect(table.locator("tbody > tr > th[scope='row']")).toHaveCount(rowCount);
			const readplaceInks = await table.locator(".home-compare__head--readplace, .home-compare__cell--readplace")
				.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
			assert.equal(readplaceInks.length, rowCount + 1);
			assert.deepEqual(new Set(readplaceInks), new Set([primaryText]),
				"the Readplace column must stand out in the primary ink");
			const tableBox = await table.boundingBox();
			assert(tableBox, "the comparison must have a measurable table");
			const layout = {
				display: await table.evaluate((element) => getComputedStyle(element).display),
				header: await table.locator("thead").evaluate((element) => getComputedStyle(element).display),
			};
			const rows = await table.locator("tbody > tr").evaluateAll((elements) => elements.map((row) => ({
				display: getComputedStyle(row).display,
				cells: Array.from(row.querySelectorAll("th, td"), (cell) => {
					const box = cell.getBoundingClientRect();
					return {
						text: cell.textContent,
						label: cell.getAttribute("data-label"),
						prefix: getComputedStyle(cell, "::before").content,
						display: getComputedStyle(cell).display,
						x: box.x,
						y: box.y,
						width: box.width,
						height: box.height,
						scrollWidth: cell.scrollWidth,
						clientWidth: cell.clientWidth,
					};
				}),
			})));
			if (viewport.width < 768) {
				assert.deepEqual(layout, { display: "block", header: "block" });
				const header = await table.locator("thead").evaluate((element) => {
					const style = getComputedStyle(element);
					const box = element.getBoundingClientRect();
					return { position: style.position, clip: style.clip, width: box.width, height: box.height };
				});
				assert.deepEqual(header, { position: "absolute", clip: "rect(0px, 0px, 0px, 0px)", width: 1, height: 1 });
				for (const row of rows) {
					assert.equal(row.display, "block", "each mobile row must form a stacked card");
					for (const cell of row.cells) assert.equal(cell.display, "block");
					for (const [index, cell] of row.cells.slice(1).entries()) {
						const previous = row.cells[index];
						assert(previous, "a stacked cell must follow the cell above it");
						assert.ok(cell.y >= previous.y + previous.height - 1,
							"mobile columns must stack without obscuring the comparison above");
					}
					for (const cell of row.cells.slice(1)) {
						assert(cell.label, "every mobile data cell must name its column");
						assert.equal(cell.prefix, JSON.stringify(`${cell.label}: `));
					}
				}
			} else {
				assert.deepEqual(layout, { display: "table", header: "table-header-group" });
				for (const row of rows) {
					assert.equal(row.display, "table-row");
					for (const cell of row.cells) assert.equal(cell.display, "table-cell");
					for (const cell of row.cells.slice(1)) assert.equal(cell.prefix, "none");
				}
			}
			for (const [index, row] of rows.entries()) {
				assert.equal(row.cells.length, 4, `row ${index + 1} must retain all four columns`);
				for (const cell of row.cells) {
					assert.ok(cell.text?.trim(), `row ${index + 1} must render its complete comparison`);
					assert.ok(cell.width > 0 && cell.height > 0, `row ${index + 1} must be readable`);
					assert.ok(cell.scrollWidth <= cell.clientWidth + 1, `row ${index + 1} must wrap its text`);
					assert.ok(cell.x >= tableBox.x - 1 && cell.x + cell.width <= tableBox.x + tableBox.width + 1,
						`row ${index + 1} must stay within the comparison`);
				}
			}

			const signup = page.locator('[data-test-cta="compare-signup"]');
			await clickAndWaitForPageReload(page, signup);
			await expect(page.locator("body.page-signup")).toHaveCount(1);
			const destination = new URL(page.url());
			assert.equal(destination.searchParams.get("utm_source"), "home-compare");
			assert.equal(destination.searchParams.get("utm_medium"), "internal");
			assert.equal(destination.searchParams.get("utm_content"), "compare-signup");
		});
	});
}
