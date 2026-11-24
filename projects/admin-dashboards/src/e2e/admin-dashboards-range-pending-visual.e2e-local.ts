import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { captureCheckpoint, expect, measuredBox, test, type VisualCheckpoint } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { pageOverflowsSideways, suppressVolatileChrome } from "./admin-dashboards-visual.browser";
import { signInAsAdmin } from "./admin-session";
import { fitViewportToPage } from "./fit-viewport-to-page";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const DASHBOARD_PATH = "/admin/dashboards/hn-experiment";
const TARGET = 'main[data-test-admin-dashboard="hn-experiment"]';

const VARIANTS = [
	{ width: "desktop", theme: "light", viewport: { width: 1280, height: 900 } },
	{ width: "desktop", theme: "dark", viewport: { width: 1280, height: 900 } },
	{ width: "mobile", theme: "light", viewport: { width: 375, height: 812 } },
	{ width: "mobile", theme: "dark", viewport: { width: 375, height: 812 } },
] as const;
type Variant = (typeof VARIANTS)[number];

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	"[data-test-verify-banner]",
];

function rangeButton(page: Page, range: string) {
	return page.locator(`[data-test-admin-dashboard-range="${range}"]`);
}

async function holdRange(page: Page, range: string): Promise<() => void> {
	let release: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	assert.ok(release, "a promise executor runs synchronously, so its resolver must be captured");
	await page.route(
		(url) => url.pathname === DASHBOARD_PATH && url.searchParams.get("range") === range,
		async (route) => {
			await held;
			await route.continue();
		},
	);
	return release;
}

async function settleWhileHeld(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await page.evaluate(suppressVolatileChrome, VOLATILE_CHROME);
	await expect(page.locator(".admin-dashboard__widget").first()).toHaveCSS("opacity", "0.55");
}

async function staysWithinTheViewport(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the pending dashboard must never make the page scroll sideways");
}

function checkpoint(variant: Variant): VisualCheckpoint {
	return {
		name: `admin-dashboards-range-pending-${variant.width}-${variant.theme}`,
		settled: settleWhileHeld,
		geometry: staysWithinTheViewport,
		target: TARGET,
		capture: "element",
		pinnedText: [],
	};
}

async function openSevenDays(page: Page, viewport: { width: number; height: number }): Promise<void> {
	await page.goto(`${BASE_URL}${DASHBOARD_PATH}`, { waitUntil: "domcontentloaded" });
	await expect(page.locator(TARGET)).toHaveCount(1);
	await expect(rangeButton(page, "7d")).toHaveAttribute("aria-current", "page");
	await fitViewportToPage(page, viewport);
}

test.describe("Admin dashboards range press while it loads", () => {
	test.use({ timezoneId: "UTC" });

	test("marks the pressed range and dims the dashboard until the answer lands", async ({ page }) => {
		await signInAsAdmin(page, BASE_URL);

		for (const variant of VARIANTS) {
			await page.setViewportSize(variant.viewport);
			await page.emulateMedia({ colorScheme: variant.theme });
			await openSevenDays(page, variant.viewport);
			const widgetBoxBefore = await measuredBox(page, ".admin-dashboard__widget >> nth=0");

			const release = await holdRange(page, "30d");
			await rangeButton(page, "30d").click();

			const pressedForms = page.locator(".admin-dashboard__range-form.htmx-request");
			await expect(pressedForms).toHaveCount(1);
			await expect(pressedForms.locator('[data-test-admin-dashboard-range="30d"]')).toHaveCount(1);
			await expect(page.locator(".admin-dashboard__ranges")).toHaveClass(/\bhtmx-request\b/);
			const widgetCount = await page.locator(".admin-dashboard__widget").count();
			assert.ok(widgetCount > 0, "the dashboard renders its widgets");
			await expect(page.locator(".admin-dashboard__widget.htmx-request")).toHaveCount(widgetCount);
			for (const veiled of [page.locator(".admin-dashboard__widget").first(), page.locator(".admin-dashboard__window")]) {
				await expect(veiled).toHaveCSS("opacity", "0.55");
				await expect(veiled).toHaveCSS("cursor", "progress");
			}
			await expect(rangeButton(page, "30d")).toHaveCSS("font-weight", "600");
			await expect(rangeButton(page, "30d")).toHaveCSS("cursor", "progress");
			await expect(rangeButton(page, "7d")).toHaveAttribute("aria-current", "page");
			await expect(rangeButton(page, "7d")).toHaveCSS("font-weight", "400");
			await expect(page.locator(".admin-dashboard__title")).toHaveCSS("opacity", "1");
			const widgetBoxHeld = await measuredBox(page, ".admin-dashboard__widget >> nth=0");
			assert.deepEqual(widgetBoxHeld, widgetBoxBefore, "the veil must not resize the widgets");

			await captureCheckpoint(page, checkpoint(variant));

			release();
			await expect(rangeButton(page, "30d")).toHaveAttribute("aria-current", "page");
			await expect(page.locator(".htmx-request")).toHaveCount(0);
			await page.unrouteAll({ behavior: "wait" });
		}

		const releaseOpenTab = await holdRange(page, "30d");
		await rangeButton(page, "30d").click();
		await expect(page.locator(".admin-dashboard__range-form.htmx-request")).toHaveCount(1);
		await expect(rangeButton(page, "30d")).toHaveCSS("font-weight", "600");
		releaseOpenTab();
		await expect(page.locator(".htmx-request")).toHaveCount(0);
		await page.unrouteAll({ behavior: "wait" });
	});

	test("a second press replaces the first, so only the latest range shows as pressed", async ({ page }) => {
		await signInAsAdmin(page, BASE_URL);
		await page.setViewportSize(VARIANTS[0].viewport);
		await openSevenDays(page, VARIANTS[0].viewport);

		await holdRange(page, "30d");
		const releaseNinetyDays = await holdRange(page, "90d");
		await rangeButton(page, "30d").click();
		await expect(page.locator(".admin-dashboard__range-form.htmx-request")).toHaveCount(1);
		await rangeButton(page, "90d").click();

		const pressedForms = page.locator(".admin-dashboard__range-form.htmx-request");
		await expect(pressedForms).toHaveCount(1);
		await expect(pressedForms.locator('[data-test-admin-dashboard-range="90d"]')).toHaveCount(1);
		await expect(rangeButton(page, "30d")).toHaveCSS("font-weight", "400");
		const widgetCount = await page.locator(".admin-dashboard__widget").count();
		await expect(page.locator(".admin-dashboard__widget.htmx-request")).toHaveCount(widgetCount);
		await expect(page.locator(".admin-dashboard__widget").first()).toHaveCSS("opacity", "0.55");

		releaseNinetyDays();
		await expect(rangeButton(page, "90d")).toHaveAttribute("aria-current", "page");
		await expect(page.locator(".htmx-request")).toHaveCount(0);
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});
});
