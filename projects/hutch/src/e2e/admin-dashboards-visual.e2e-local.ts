import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { captureCheckpoint, expect, measuredBox, test, type VisualCheckpoint } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { suppressVolatileChrome } from "./admin-dashboards-visual.browser";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./admin-extend-trial/admin-e2e-user";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

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

const SCENARIOS = [
	{ name: "index", path: "/admin/dashboards", target: "main[data-test-admin-dashboards]" },
	{ name: "hn-experiment", path: "/admin/dashboards/hn-experiment", target: 'main[data-test-admin-dashboard="hn-experiment"]' },
	{ name: "mcp", path: "/admin/dashboards/mcp", target: 'main[data-test-admin-dashboard="mcp"]' },
	{ name: "login", path: "/admin/dashboards/login", target: 'main[data-test-admin-dashboard="login"]' },
] as const;

async function settle(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await page.evaluate(suppressVolatileChrome, VOLATILE_CHROME);
}

async function signIn(page: Page): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(E2E_ADMIN_EMAIL);
	await page.locator("#password").fill(E2E_ADMIN_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await expect(page.locator("body.page-login")).toHaveCount(0);
}

async function staysWithinTheViewport(page: Page, target: string): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, `"${target}" must never make the page scroll sideways`);
	const box = await measuredBox(page, target);
	const viewport = page.viewportSize();
	assert.ok(viewport, "the capture runs at a fixed viewport");
	assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 0.5, `"${target}" must sit inside the viewport horizontally`);
}

function checkpoint(input: { surface: string; target: string; variant: Variant }): VisualCheckpoint {
	return {
		name: `admin-dashboards-${input.surface}-${input.variant.width}-${input.variant.theme}`,
		settled: settle,
		geometry: (page) => staysWithinTheViewport(page, input.target),
		target: input.target,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Admin dashboards visual", () => {
	test.use({ timezoneId: "UTC" });

	for (const scenario of SCENARIOS) {
		test(`admin dashboards ${scenario.name}`, async ({ page }) => {
			await signIn(page);
			for (const variant of VARIANTS) {
				await page.setViewportSize(variant.viewport);
				await page.emulateMedia({ colorScheme: variant.theme });
				await page.goto(`${BASE_URL}${scenario.path}`, { waitUntil: "domcontentloaded" });
				await expect(page.locator(scenario.target)).toHaveCount(1);
				await fitViewportToPage(page, variant.viewport);
				await captureCheckpoint(page, checkpoint({ surface: scenario.name, target: scenario.target, variant }));
			}
		});
	}
});
