import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { EXPERIMENT_COOKIE_NAME } from "../runtime/web/experiments/homepage-assignment";
import { HOMEPAGE_SPLIT } from "../runtime/web/experiments/homepage-split";
import { clickAndWaitForPageReload } from "./page-interactions";
import { pageOverflowsSideways, resolveColourTokens } from "./page-measurements.browser";
import { collectThemeSignature } from "./theme-signature.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const SECTION_ORDER = ["assistant", "proof", "capabilities", "principle", "pricing", "faq", "close"];
const VIEWPORTS = [
	{ width: 320, height: 800 },
	{ width: 390, height: 844 },
	{ width: 768, height: 1024 },
	{ width: 1440, height: 1000 },
];

async function assignArmC(page: Page): Promise<void> {
	await page.context().addCookies([{
		name: EXPERIMENT_COOKIE_NAME,
		value: `${HOMEPAGE_SPLIT.campaign}:${HOMEPAGE_SPLIT.epoch}:${HOMEPAGE_SPLIT.variants[1].slug}`,
		url: BASE_URL,
	}]);
}

for (const viewport of VIEWPORTS) {
	test.describe(`Homepage arm C at ${viewport.width}px`, () => {
		test.use({ viewport, timezoneId: "UTC" });

		test("lays out its capabilities between proof and principle and opens a pasted link in the reader", async ({ page }) => {
			await page.emulateMedia({ colorScheme: "light" });
			await assignArmC(page);
			await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("body.page-home.variant-c")).toHaveCount(1);
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
			const [muted, background] = await page.evaluate(resolveColourTokens, ["--muted", "--background"]);
			assert.deepEqual(bands, [
				{ key: "assistant", background: muted },
				{ key: "proof", background },
				{ key: "capabilities", background: muted },
				{ key: "principle", background },
				{ key: "pricing", background: muted },
				{ key: "faq", background },
				{ key: "close", background: muted },
			], "the capabilities must sit between proof and the principle in alternating bands");

			const items = await page.locator("[data-test-capability]").evaluateAll((elements) =>
				elements.map((element) => {
					const box = element.getBoundingClientRect();
					return { x: box.x, y: box.y, width: box.width, height: box.height };
				}));
			assert.equal(items.length, 3, "arm C must list three capabilities");
			const [first, second, third] = items;
			assert(first && second && third, "arm C must list three capabilities");
			if (viewport.width < 768) {
				assert.deepEqual([second.x, third.x], [first.x, first.x], "stacked capabilities must share one left edge");
				assert.ok(second.y >= first.y + first.height && third.y >= second.y + second.height,
					"each stacked capability must sit below the one before it");
			} else {
				assert.deepEqual([second.y, third.y], [first.y, first.y], "side-by-side capabilities must share one top");
				assert.ok(second.x >= first.x + first.width && third.x >= second.x + second.width,
					"side-by-side capabilities must run left to right without overlapping");
			}

			await page.locator('[data-test-hero-input="homepage-link-input"]')
				.fill(`${BASE_URL}/e2e/fixtures/unfetchable/home-c-paste-${viewport.width}`);
			await clickAndWaitForPageReload(page, page.locator('[data-test-cta="homepage-link-input"]'));
			assert.equal(new URL(page.url()).pathname.startsWith("/view"), true,
				`a pasted link must open in the reader, landed on ${page.url()}`);
		});
	});
}

test.describe("Homepage arm C paints the palette it was designed for", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("paints the same colours under a dark system theme", async ({ page }) => {
		await assignArmC(page);
		const signatures = [];
		for (const scheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
			await page.waitForSelector("body.page-home.variant-c");
			signatures.push(await page.evaluate(collectThemeSignature));
		}
		const [light, dark] = signatures;
		assert(light && dark, "both system themes must render arm C");
		assert.ok(light.bodyClass.split(/\s+/).includes("theme-light"),
			`arm C must be pinned light while logged out, but rendered "${light.bodyClass}"`);
		assert.equal(dark.rootColorScheme, "light",
			"arm C pins the light palette, so its root element must not report a dark colour scheme");
		assert.deepEqual(dark.painted, light.painted, "arm C must paint the same colours under a dark system theme");
	});
});
