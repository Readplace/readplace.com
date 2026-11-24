import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { LENSES, NON_TEXT_MINIMUM, contrastRatio, expect, test, textMinimum } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { signInAsAdmin } from "./admin-session";
import { type RenderedInk, collectRenderedInk } from "./rendered-ink.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const VIEWPORT = { width: 1280, height: 900 };
const SETTLE_MS = 45000;

function minimumRatio(measured: RenderedInk): number {
	const minimums = {
		text: textMinimum(measured),
		graphic: NON_TEXT_MINIMUM,
		fill: NON_TEXT_MINIMUM,
	} satisfies Record<RenderedInk["role"], number>;
	return minimums[measured.role];
}

function shortfall(measured: RenderedInk, where: { theme: string; view: string }): string {
	const ratio = contrastRatio({ ink: measured.ink, surface: measured.surface });
	return [
		`${where.theme}/${where.view}: ${measured.name} renders ${measured.role}`,
		`at ${ratio.toFixed(2)}:1, below the ${minimumRatio(measured)}:1 WCAG minimum`,
		`— rgb(${measured.ink.red},${measured.ink.green},${measured.ink.blue})`,
		`on rgb(${measured.surface.red},${measured.surface.green},${measured.surface.blue})`,
		`at ${measured.fontSizePx}px/${measured.fontWeight}`,
	].join(" ");
}

async function stableMeasurements(page: Page, root: string): Promise<RenderedInk[]> {
	let measurements: RenderedInk[] = [];
	let previous = "";
	await expect
		.poll(
			async () => {
				measurements = await page.evaluate(collectRenderedInk, root);
				const current = JSON.stringify(measurements);
				const settled = current === previous;
				previous = current;
				return settled;
			},
			{ timeout: SETTLE_MS },
		)
		.toBe(true);
	return measurements;
}

function assertContrast(measurements: readonly RenderedInk[], where: { theme: string; view: string }): void {
	for (const measured of measurements) {
		for (const [lens, project] of Object.entries(LENSES)) {
			const seen = {
				...measured,
				ink: project(measured.ink),
				surface: project(measured.surface),
			};
			assert.ok(
				contrastRatio(seen) >= minimumRatio(seen),
				shortfall(seen, { ...where, view: `${where.view}/${lens}` }),
			);
		}
	}
}

async function auditRoot(page: Page, input: { root: string; theme: string; view: string }): Promise<void> {
	await page.mouse.move(0, 0);
	const measurements = await stableMeasurements(page, input.root);
	assert.ok(
		measurements.length > 0,
		`${input.theme}/${input.view}: the audit measured nothing inside ${input.root}`,
	);
	assertContrast(measurements, { theme: input.theme, view: input.view });
}

test.describe("Admin dashboard colour roles hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("the dashboard index and the HN experiment, MCP, login and keep engine dashboards clear their contrast minimum", async ({ page }) => {
		await signInAsAdmin(page, BASE_URL);

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/admin/dashboards`, { waitUntil: "domcontentloaded" });
			await page.waitForSelector("body.page-admin-dashboards");
			await auditRoot(page, { root: "main.admin-dashboards", theme, view: "admin/dashboards" });

			for (const slug of ["hn-experiment", "mcp", "login", "keep-engine"] as const) {
				await page.goto(`${BASE_URL}/admin/dashboards/${slug}`, { waitUntil: "domcontentloaded" });
				await page.waitForSelector("body.page-admin-dashboard");
				await auditRoot(page, { root: "main.admin-dashboard", theme, view: `admin/dashboards/${slug}` });
			}
		}
	});
});
