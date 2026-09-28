import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { E2E_CHANGELOG_BANNER_HEADER } from "./changelog-banner-fixture";
import { markReadWithConfirmation } from "./page-interactions";
import { type RenderedInk, collectRenderedInk } from "./rendered-ink.browser";
import { LENSES, NON_TEXT_MINIMUM, contrastRatio, textMinimum } from "./wcag-contrast";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://localhost:${E2E_PORT}`;
const PASSWORD = "Sup3r-Secret-Pw!";
const VIEWPORT = { width: 1280, height: 900 };
const READER_ROOT = "main.reader";
const AUTH_ROOT = "main.auth-page";
const READLIST_ROOT = "main.readlist";
const BANNER_AREA_ROOT = ".banner-area";
const NAV_LIBRARY_ROOT = '[data-test-nav-group="library"]';
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
/** The design card's delete lives inside a closed <details> menu, so the sweep
 * has to open the menu before the delete trigger is clickable; the confirm
 * popover then renders inside main.readlist, so the same walk reaches it. */
async function auditDeleteConfirmation(
	page: Page,
	where: { theme: string; view: string },
): Promise<void> {
	await page.locator('[data-test-action="article-menu"]').first().click({ timeout: SETTLE_MS });
	await page.locator('[data-test-action="delete"]').first().click({ timeout: SETTLE_MS });
	await expect(page.locator('[data-test-confirm-popover="delete"]:popover-open')).toBeVisible({
		timeout: SETTLE_MS,
	});
	await page.mouse.move(0, 0);

	const measurements = await stableMeasurements(page, READLIST_ROOT);
	assertContrast(measurements, { ...where, view: `${where.view}/delete-confirm` });

	await page.keyboard.press("Escape");
	await expect(page.locator('[data-test-confirm-popover="delete"]:popover-open')).toBeHidden({
		timeout: SETTLE_MS,
	});
}

async function auditReadlistQueue(page: Page, where: { theme: string; view: string }): Promise<void> {
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

async function auditAnnouncementBars(
	page: Page,
	where: { theme: string; view: string },
): Promise<void> {
	await page.waitForSelector("body.page-readlist");
	await expect(page.locator("[data-test-changelog-banner]")).toHaveClass(
		/changelog-banner--visible/,
		{ timeout: SETTLE_MS },
	);
	await expect(page.locator("[data-test-verify-banner]")).toBeVisible({ timeout: SETTLE_MS });
	await page.mouse.move(0, 0);

	for (const root of [BANNER_AREA_ROOT, NAV_LIBRARY_ROOT]) {
		const measurements = await stableMeasurements(page, root);
		assert.ok(
			measurements.length > 0,
			`${where.theme}/${where.view}: the audit measured nothing inside ${root}`,
		);
		assertContrast(measurements, where);
	}
}

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
			await expect(page.locator('[data-test-alert="global-error"]')).toBeVisible({ timeout: SETTLE_MS });
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

test.describe("Readlist colour roles hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("every rendered readlist surface clears its contrast minimum", async ({
		page,
	}, testInfo) => {
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
		const articleId = new URL(readerHref, BASE_URL).pathname.match(/^\/queue\/([^/]+)\/view$/)?.[1];
		assert(articleId, "a saved card must link to a reader with an article id");

		const viewUrls = {
			"to-read": `${BASE_URL}/queue`,
			done: `${BASE_URL}/queue?tab=done`,
			"save-error": `${BASE_URL}/queue?error_code=save_failed`,
			"alert-limit": `${BASE_URL}/queue?queue_error=limit`,
		} as const;
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const view of ["to-read", "done", "save-error", "alert-limit"] as const) {
				await page.goto(viewUrls[view], { waitUntil: "domcontentloaded" });
				if (view === "save-error") {
					await expect(page.locator("[data-test-save-error]")).toBeVisible({
						timeout: SETTLE_MS,
					});
				}
				if (view === "alert-limit") {
					await expect(page.locator('[data-test-alert="readlist"]')).toBeVisible({ timeout: SETTLE_MS });
				}
				await auditReadlistQueue(page, { theme, view });
			}
			await page.route("**/client-dist/toast.client.js", (route) => route.abort());
			await page.goto(
				`${BASE_URL}/queue?status_changed=read&status_article=${encodeURIComponent(articleId)}`,
				{ waitUntil: "domcontentloaded" },
			);
			await expect(page.locator("[data-test-toast]")).toBeVisible({ timeout: SETTLE_MS });
			await auditReadlistQueue(page, { theme, view: "status-toast" });
			const toastColours = await page.locator("[data-test-toast]").evaluate((toast) => {
				function rgb(value: string) {
					const channels = value.match(/-?[\d.]+/g);
					if (!channels || channels.length < 3) throw new Error(`Expected an RGB colour, got ${value}`);
					return {
						red: Number(channels[0]),
						green: Number(channels[1]),
						blue: Number(channels[2]),
						alpha: channels.length > 3 ? Number(channels[3]) : 1,
					};
				}
				const border = rgb(getComputedStyle(toast).borderTopColor);
				let ancestor = toast.parentElement;
				while (ancestor) {
					const canvas = rgb(getComputedStyle(ancestor).backgroundColor);
					if (canvas.alpha === 1) return { border, canvas };
					ancestor = ancestor.parentElement;
				}
				throw new Error("The toast must float over an opaque ancestor canvas");
			});
			for (const [lens, project] of Object.entries(LENSES)) {
				const ratio = contrastRatio({
					ink: project(toastColours.border),
					surface: project(toastColours.canvas),
				});
				assert.ok(
					ratio >= NON_TEXT_MINIMUM,
					`${theme}/status-toast/${lens}: border contrast ${ratio.toFixed(2)}:1 is below ${NON_TEXT_MINIMUM}:1`,
				);
			}
			await page.unroute("**/client-dist/toast.client.js");
			await page.setExtraHTTPHeaders({ [E2E_CHANGELOG_BANNER_HEADER]: "1" });
			await page.goto(viewUrls["to-read"], { waitUntil: "domcontentloaded" });
			await auditAnnouncementBars(page, { theme, view: "announcement-bars" });
			await page.setExtraHTTPHeaders({});
			await page.goto(readerUrl, { waitUntil: "domcontentloaded" });
			await auditReader(page, { theme, view: "reader" });
		}
	});
});

test.describe("Alert variants hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("error, info, success and warning clear colour and greyscale minimums", async ({ page }, testInfo) => {
		const email = `alert-contrast-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email, password: PASSWORD, verified: true },
		});
		assert.equal(created.status(), 201);
		const { userId } = await created.json() as { userId: string };
		assert(userId, "the new reader must have a user id");
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
			data: { userId },
		});
		assert.equal(seeded.status(), 201);
		await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
		await page.locator("#email").fill(email);
		await page.locator("#password").fill(PASSWORD);
		await page.locator('[data-test-form="login"] button[type="submit"]').click();
		await page.waitForSelector("body.page-readlist");
		const uploaded = await page.request.post(`${BASE_URL}/import`, {
			multipart: {
				file: {
					name: "links.txt",
					mimeType: "text/plain",
					buffer: Buffer.from(Array.from({ length: 2_001 }, (_, index) => `https://example.com/post-${index}`).join("\n")),
				},
			},
			maxRedirects: 0,
		});
		assert.equal(uploaded.status(), 303);
		const location = uploaded.headers().location;
		assert(location, "the import upload must redirect to its review page");
		const warningUrl = new URL(location, BASE_URL).href;
		await page.goto(warningUrl, { waitUntil: "domcontentloaded" });
		await expect(page.locator('[data-test-alert="import-truncated"]')).toBeVisible({ timeout: SETTLE_MS });

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const view of [
				{ key: "oauth_state", url: `${BASE_URL}/integrations?error=oauth_state`, variant: "error" },
				{ key: "gmail_disconnected", url: `${BASE_URL}/integrations?notice=gmail_disconnected`, variant: "info" },
				{ key: "connected", url: `${BASE_URL}/integrations/gmail?notice=connected`, variant: "success" },
			] as const) {
				await page.goto(view.url, { waitUntil: "domcontentloaded" });
				const alert = page.locator(`[data-test-alert="${view.key}"]`);
				await expect(alert).toHaveAttribute("data-test-alert-variant", view.variant);
				const measurements = await stableMeasurements(page, `[data-test-alert="${view.key}"]`);
				assert.ok(measurements.length > 0);
				assertContrast(measurements, { theme, view: view.variant });
			}

			await page.goto(warningUrl, { waitUntil: "domcontentloaded" });
			const warning = page.locator('[data-test-alert="import-truncated"]');
			await expect(warning).toHaveAttribute("data-test-alert-variant", "warning", { timeout: SETTLE_MS });
			const measurements = await stableMeasurements(page, '[data-test-alert="import-truncated"]');
			assert.ok(measurements.length > 0);
			assertContrast(measurements, { theme, view: "warning" });
		}
	});
});
