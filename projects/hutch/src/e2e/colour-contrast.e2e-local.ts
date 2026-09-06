import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { markReadWithConfirmation } from "./page-interactions";
import { type RenderedInk, collectRenderedInk } from "./rendered-ink.browser";
import { LENSES, NON_TEXT_MINIMUM, contrastRatio, textMinimum } from "./wcag-contrast";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://localhost:${E2E_PORT}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const VIEWPORT = { width: 1280, height: 900 };
const READLIST_ROOT = "main.readlist";
const READER_ROOT = "main.reader";
const AUTH_ROOT = "main.auth-page";
const SETTLE_MS = 45000;

function minimumRatio(measured: RenderedInk): number {
	return measured.role === "text" ? textMinimum(measured) : NON_TEXT_MINIMUM;
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

async function signUpFreshUser(page: Page, email: string): Promise<void> {
	// Focusing the save bar opens the save tip, whose ink is not what is measured.
	await page
		.context()
		.addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
	await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('input[name="loadedAt"]').evaluate((el: HTMLInputElement) => {
		el.value = String(Date.now() - 5000);
	});
	await page.locator('[data-test-action="signup"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function saveArticle(page: Page, url: string, expectedCards: number): Promise<void> {
	await page.locator('[data-test-form="save-article"] input[name="url"]').fill(url);
	await page.locator('[data-test-form="save-article"] button[type="submit"]').click();
	await expect(page.locator("[data-test-article]")).toHaveCount(expectedCards, {
		timeout: SETTLE_MS,
	});
}

async function waitForCardsSettled(page: Page): Promise<void> {
	await expect(page.locator('[data-test-article][data-card-status="pending"]')).toHaveCount(0, {
		timeout: SETTLE_MS,
	});
}

async function markNewestArticleRead(page: Page): Promise<void> {
	const before = await page.locator("[data-test-article]").count();
	await waitForCardsSettled(page);
	await markReadWithConfirmation(page, page.locator('[data-test-action="mark-read"]').first());
	await expect(page.locator("[data-test-article]")).toHaveCount(before - 1, {
		timeout: SETTLE_MS,
	});
}

/** Moving the pointer off a control starts its colour transition, and a sample
 * taken mid-fade reads a blend that belongs to no state the guidelines cover —
 * the delete icon measured 2.76:1 against its own half-faded hover fill. Two
 * identical consecutive reads mean every transition has landed. */
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

function assertContrast(
	measurements: readonly RenderedInk[],
	where: { theme: string; view: string },
): void {
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

async function auditReadlist(page: Page, where: { theme: string; view: string }): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator("[data-test-article]")).toHaveCount(1, { timeout: SETTLE_MS });
	await waitForCardsSettled(page);
	await page.mouse.move(0, 0);

	const measurements = await stableMeasurements(page, READLIST_ROOT);
	assert.ok(
		measurements.length > 0,
		`${where.theme}/${where.view}: the audit measured nothing inside ${READLIST_ROOT}`,
	);
	assertContrast(measurements, where);

	await auditDeleteConfirmation(page, where);
}

async function auditReader(page: Page, where: { theme: string; view: string }): Promise<void> {
	await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]', {
		timeout: SETTLE_MS,
	});
	await page.locator("[data-test-readlists-trigger]").click({ timeout: SETTLE_MS });
	await expect(page.locator("[data-test-readlist-create-name]")).toBeVisible({
		timeout: SETTLE_MS,
	});
	await page.mouse.move(0, 0);

	const measurements = await stableMeasurements(page, READER_ROOT);
	assert.ok(
		measurements.length > 0,
		`${where.theme}/${where.view}: the audit measured nothing inside ${READER_ROOT}`,
	);
	assertContrast(measurements, where);
}

async function auditAuth(page: Page, where: { theme: string; view: string }): Promise<void> {
	await page.mouse.move(0, 0);

	const measurements = await stableMeasurements(page, AUTH_ROOT);
	assert.ok(
		measurements.length > 0,
		`${where.theme}/${where.view}: the audit measured nothing inside ${AUTH_ROOT}`,
	);
	assertContrast(measurements, where);
}

/** A closed popover has a zero rect, so the delete confirmation is invisible to
 * the pass above and its surfaces would ship unmeasured. Opening it puts the
 * panel in the top layer, which changes painting only — it stays a DOM
 * descendant of the readlist root, so the same walk reaches it. */
async function auditDeleteConfirmation(
	page: Page,
	where: { theme: string; view: string },
): Promise<void> {
	const trigger = page.locator('[data-test-action="delete"]').first();
	await trigger.click({ timeout: SETTLE_MS });
	await expect(page.locator('[data-test-action="delete-confirm"]').first()).toBeVisible({
		timeout: SETTLE_MS,
	});
	// The click leaves the pointer over the trigger, whose :hover state fills it
	// solid red; measuring that would audit a state the guidelines exempt.
	await page.mouse.move(0, 0);

	const measurements = await stableMeasurements(page, READLIST_ROOT);
	assertContrast(measurements, { ...where, view: `${where.view}/delete-confirm` });

	await page.keyboard.press("Escape");
	await expect(page.locator('[data-test-action="delete-confirm"]').first()).toBeHidden({
		timeout: SETTLE_MS,
	});
}

test.describe("Readlist colour roles hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("every rendered readlist surface clears its contrast minimum", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		await signUpFreshUser(page, `colour-contrast-${run}@example.com`);
		await saveArticle(page, `${BASE_URL}/privacy?colour-contrast-unread=${run}`, 1);
		await saveArticle(page, `${BASE_URL}/privacy?colour-contrast-read=${run}`, 2);
		await markNewestArticleRead(page);

		const readerHref = await page
			.locator("[data-test-article-title]")
			.first()
			.getAttribute("href");
		assert(readerHref, "a saved card must link to its own reader");
		const readerUrl = new URL(readerHref, BASE_URL).toString();

		const viewUrls = {
			"to-read": `${BASE_URL}/queue`,
			done: `${BASE_URL}/queue?tab=done`,
			"save-error": `${BASE_URL}/queue?error_code=save_failed`,
		} as const;
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const view of ["to-read", "done", "save-error"] as const) {
				await page.goto(viewUrls[view], { waitUntil: "domcontentloaded" });
				if (view === "save-error") {
					await expect(page.locator("[data-test-save-error]")).toBeVisible({
						timeout: SETTLE_MS,
					});
				}
				await auditReadlist(page, { theme, view });
			}
			await page.goto(readerUrl, { waitUntil: "domcontentloaded" });
			await auditReader(page, { theme, view: "reader" });
		}
	});
});

test.describe("Auth colour roles hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("every rendered auth surface clears its contrast minimum", async ({ page }) => {
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });

			for (const view of ["login", "signup", "forgot-password"] as const) {
				await page.goto(`${BASE_URL}/${view}`, { waitUntil: "domcontentloaded" });
				await page.waitForSelector(`body.page-${view}`);
				await auditAuth(page, { theme, view });
			}

			await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
			await page.locator("#email").fill("nobody@example.com");
			await page.locator("#password").fill("Wr0ng-Password!");
			await page.locator('[data-test-form="login"] button[type="submit"]').click();
			await expect(page.locator("[data-test-global-error]")).toBeVisible({ timeout: SETTLE_MS });
			await auditAuth(page, { theme, view: "login/global-error" });

			await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
			await page.locator("#email").fill("someone@0-mail.com");
			await page.locator("#password").fill(PASSWORD);
			await page.locator('input[name="loadedAt"]').evaluate((el: HTMLInputElement) => {
				el.value = String(Date.now() - 5000);
			});
			await page.locator('[data-test-action="signup"]').click();
			await expect(page.locator('[data-test-error="email"]')).toBeVisible({ timeout: SETTLE_MS });
			await auditAuth(page, { theme, view: "signup/field-error" });
		}
	});
});
