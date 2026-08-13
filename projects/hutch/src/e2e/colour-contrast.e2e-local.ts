import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { type RenderedInk, collectRenderedInk } from "./rendered-ink.browser";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://localhost:${E2E_PORT}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const VIEWPORT = { width: 1280, height: 900 };
const QUEUE_ROOT = "main.queue";
const SETTLE_MS = 45000;

const NORMAL_TEXT_MINIMUM = 4.5;
const LARGE_TEXT_MINIMUM = 3;
const NON_TEXT_MINIMUM = 3;
const LARGE_TEXT_PX = 24;
const BOLD_LARGE_TEXT_PX = 18.66;
const BOLD_WEIGHT = 700;

const SRGB_LINEAR_CUTOFF = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_EXPONENT = 2.4;
const CONTRAST_FLARE = 0.05;
const RED_LUMINANCE = 0.2126;
const GREEN_LUMINANCE = 0.7152;
const BLUE_LUMINANCE = 0.0722;

interface Rgb {
	red: number;
	green: number;
	blue: number;
}

function channelLuminance(value: number): number {
	const channel = value / 255;
	return channel <= SRGB_LINEAR_CUTOFF
		? channel / SRGB_LINEAR_DIVISOR
		: ((channel + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_EXPONENT;
}

function relativeLuminance(colour: Rgb): number {
	return (
		RED_LUMINANCE * channelLuminance(colour.red) +
		GREEN_LUMINANCE * channelLuminance(colour.green) +
		BLUE_LUMINANCE * channelLuminance(colour.blue)
	);
}

function contrastRatio(pair: { ink: Rgb; surface: Rgb }): number {
	const inkLuminance = relativeLuminance(pair.ink);
	const surfaceLuminance = relativeLuminance(pair.surface);
	const lighter = Math.max(inkLuminance, surfaceLuminance);
	const darker = Math.min(inkLuminance, surfaceLuminance);
	return (lighter + CONTRAST_FLARE) / (darker + CONTRAST_FLARE);
}

function minimumRatio(measured: RenderedInk): number {
	if (measured.role !== "text") return NON_TEXT_MINIMUM;
	const boldSizeCredit =
		measured.fontWeight >= BOLD_WEIGHT ? LARGE_TEXT_PX - BOLD_LARGE_TEXT_PX : 0;
	const isLargeText = measured.fontSizePx + boldSizeCredit >= LARGE_TEXT_PX;
	return isLargeText ? LARGE_TEXT_MINIMUM : NORMAL_TEXT_MINIMUM;
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
	await page.goto(`${BASE_URL}/signup`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('input[name="loadedAt"]').evaluate((el: HTMLInputElement) => {
		el.value = String(Date.now() - 5000);
	});
	await page.locator('[data-test-action="signup"]').click();
	await page.waitForSelector("body.page-queue");
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
	await page.locator('[data-test-action="mark-read"]').first().click();
	await expect(page.locator("[data-test-article]")).toHaveCount(before - 1, {
		timeout: SETTLE_MS,
	});
}

/** Moving the pointer off a control starts its colour transition, and a sample
 * taken mid-fade reads a blend that belongs to no state the guidelines cover —
 * the delete icon measured 2.76:1 against its own half-faded hover fill. Two
 * identical consecutive reads mean every transition has landed. */
async function stableMeasurements(page: Page): Promise<RenderedInk[]> {
	let measurements: RenderedInk[] = [];
	let previous = "";
	await expect
		.poll(
			async () => {
				measurements = await page.evaluate(collectRenderedInk, QUEUE_ROOT);
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

async function auditQueue(page: Page, where: { theme: string; view: string }): Promise<void> {
	await page.waitForSelector("body.page-queue");
	await expect(page.locator("[data-test-article]")).toHaveCount(1, { timeout: SETTLE_MS });
	await waitForCardsSettled(page);
	await page.mouse.move(0, 0);

	const measurements = await stableMeasurements(page);
	assert.ok(
		measurements.length > 0,
		`${where.theme}/${where.view}: the audit measured nothing inside ${QUEUE_ROOT}`,
	);
	for (const measured of measurements) {
		const ratio = contrastRatio({ ink: measured.ink, surface: measured.surface });
		assert.ok(ratio >= minimumRatio(measured), shortfall(measured, where));
	}

	await auditDeleteConfirmation(page, where);
}

/** A closed popover has a zero rect, so the delete confirmation is invisible to
 * the pass above and its surfaces would ship unmeasured. Opening it puts the
 * panel in the top layer, which changes painting only — it stays a DOM
 * descendant of the queue root, so the same walk reaches it. */
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

	const measurements = await stableMeasurements(page);
	for (const measured of measurements) {
		const ratio = contrastRatio({ ink: measured.ink, surface: measured.surface });
		assert.ok(ratio >= minimumRatio(measured), shortfall(measured, { ...where, view: `${where.view}/delete-confirm` }));
	}

	await page.keyboard.press("Escape");
	await expect(page.locator('[data-test-action="delete-confirm"]').first()).toBeHidden({
		timeout: SETTLE_MS,
	});
}

test.describe("Queue colour roles hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("every rendered queue surface clears its contrast minimum", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		await signUpFreshUser(page, `colour-contrast-${run}@example.com`);
		await saveArticle(page, `${BASE_URL}/privacy?colour-contrast-unread=${run}`, 1);
		await saveArticle(page, `${BASE_URL}/privacy?colour-contrast-read=${run}`, 2);
		await markNewestArticleRead(page);

		const viewUrls = {
			"to-read": `${BASE_URL}/queue`,
			done: `${BASE_URL}/queue?tab=done`,
			tabs: `${BASE_URL}/queue?feature=queues`,
		} as const;
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const view of ["to-read", "done", "tabs"] as const) {
				await page.goto(viewUrls[view], { waitUntil: "domcontentloaded" });
				await auditQueue(page, { theme, view });
			}
		}
	});
});
