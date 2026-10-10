import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { z } from "zod";
import { encodeImportSkippedCookie, IMPORT_SKIPPED_COOKIE_NAME } from "../runtime/web/pages/import/import-skipped-cookie";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./admin-extend-trial/admin-e2e-user";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
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
	await expect(page.locator('[data-test-article-menu] .menu__panel').first()).toBeVisible({
		timeout: SETTLE_MS,
	});
	await page.mouse.move(0, 0);
	const menuMeasurements = await stableMeasurements(page, READLIST_ROOT);
	assertContrast(menuMeasurements, { ...where, view: `${where.view}/menu-open` });
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

async function auditMoveDialog(page: Page, where: { theme: string; view: string }): Promise<void> {
	const dialog = page.locator('[data-test-confirm-popover="move"]:popover-open');
	await page.locator('[data-test-action="article-menu"]').first().click({ timeout: SETTLE_MS });
	await page.locator('[data-test-action="move"]').first().click({ timeout: SETTLE_MS });
	await expect(dialog).toBeVisible({ timeout: SETTLE_MS });
	await dialog.locator("[data-test-move-destination]").first().click();
	await expect(dialog.locator('input[name="to"]').first()).toBeChecked();
	await page.mouse.move(0, 0);

	assertContrast(await stableMeasurements(page, READLIST_ROOT), { ...where, view: `${where.view}/move-dialog` });

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden({ timeout: SETTLE_MS });
}

async function auditCreateReadlistDialog(
	page: Page,
	where: { theme: string; view: string },
): Promise<void> {
	const dialog = page.locator('[data-test-confirm-popover="readlist-create"]');
	await page.locator('[data-test-action="new-readlist"]').click({ timeout: SETTLE_MS });
	await expect(page.locator('[data-test-confirm-popover="readlist-create"]:popover-open')).toBeVisible({
		timeout: SETTLE_MS,
	});
	await page.mouse.move(0, 0);
	assertContrast(await stableMeasurements(page, READLIST_ROOT), { ...where, view: `${where.view}/create-dialog` });

	await dialog.locator('input[name="label"]').fill("All");
	await dialog.locator('[data-test-action="readlist-create-save"]').click();
	await expect(dialog.locator("[data-test-readlist-create-error]")).not.toBeEmpty({ timeout: SETTLE_MS });
	await page.mouse.move(0, 0);
	assertContrast(await stableMeasurements(page, READLIST_ROOT), {
		...where,
		view: `${where.view}/create-dialog-error`,
	});

	await page.keyboard.press("Escape");
	await expect(page.locator('[data-test-confirm-popover="readlist-create"]:popover-open')).toBeHidden({
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
	await auditMoveDialog(page, where);
}

async function auditReadlistDiscovery(page: Page, where: { theme: string }): Promise<void> {
	const openDrawer = page.locator("[data-test-discovery-drawer]:popover-open");
	await page.goto(`${BASE_URL}/queue?q=no-such-words-anywhere`, { waitUntil: "domcontentloaded" });
	await expect(page.locator('[data-test-empty-action="clear-discovery"]')).toBeVisible({ timeout: SETTLE_MS });
	await auditRoot(page, { root: READLIST_ROOT, theme: where.theme, view: "search-no-results" });

	await page.goto(`${BASE_URL}/queue?saved=today`, { waitUntil: "domcontentloaded" });
	await expect(page.locator("[data-test-article]")).toHaveCount(1, { timeout: SETTLE_MS });
	await waitForCardsSettled(page);
	await page.locator('[data-test-action="open-discovery-filters"]').click({ timeout: SETTLE_MS });
	await expect(openDrawer).toBeVisible({ timeout: SETTLE_MS });
	await expect(openDrawer.locator('input[name="saved"]:checked')).toHaveCount(1);
	await auditRoot(page, { root: "[data-test-discovery-drawer]", theme: where.theme, view: "filters-open" });

	await page.keyboard.press("Escape");
	await expect(openDrawer).toBeHidden({ timeout: SETTLE_MS });
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
		const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: "Finance" } });
		assert.equal(created.status(), 200, "a readlist must exist for the cards to offer a move");

		const viewUrls = {
			"to-read": `${BASE_URL}/queue`,
			done: `${BASE_URL}/queue?tab=done`,
			"save-error": `${BASE_URL}/queue?error_code=save_failed`,
			"alert-limit": `${BASE_URL}/queue?queue_error=limit`,
			"import-result": `${BASE_URL}/queue?import_imported=42&import_total=50&import_skipped=25`,
		} as const;
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const view of ["to-read", "done", "save-error", "alert-limit", "import-result"] as const) {
				if (view === "import-result") {
					const skipped = [
						{ code: "unsupported_scheme" as const, url: "chrome://extensions/" },
						{ code: "private_network" as const, url: "http://192.168.1.10/admin" },
						{ code: "malformed_url" as const, url: "invalid-link-".padEnd(150, "x") },
					];
					await page.context().addCookies([{
						name: IMPORT_SKIPPED_COOKIE_NAME,
						value: encodeImportSkippedCookie(Array.from({ length: 25 }, (_, index) => skipped[index % skipped.length])),
						domain: new URL(BASE_URL).hostname,
						path: "/queue",
					}]);
				}
				await page.goto(viewUrls[view], { waitUntil: "domcontentloaded" });
				if (view === "save-error") {
					await expect(page.locator("[data-test-save-error]")).toBeVisible({
						timeout: SETTLE_MS,
					});
				}
				if (view === "alert-limit") {
					await expect(page.locator('[data-test-alert="readlist"]')).toBeVisible({ timeout: SETTLE_MS });
				}
				if (view === "import-result") {
					await expect(page.locator("[data-test-import-skipped-row]")).toHaveCount(20);
					await expect(page.locator("[data-test-import-skipped-more]")).toHaveText("And 5 more.");
					await expect(page.locator("[data-test-import-flash]")).toHaveText("42 of 50 links imported. 25 couldn't be imported.");
				}
				await auditReadlistQueue(page, { theme, view });
			}
			await auditCreateReadlistDialog(page, { theme, view: "create-readlist" });
			await auditReadlistDiscovery(page, { theme });
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
				{ key: "oauth_state", url: `${BASE_URL}/newsletters?error=oauth_state`, variant: "error" },
				{ key: "gmail_disconnected", url: `${BASE_URL}/newsletters?notice=gmail_disconnected`, variant: "info" },
				{ key: "connected", url: `${BASE_URL}/newsletters/gmail?notice=connected`, variant: "success" },
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

async function createChipReader(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201);
	return CreatedReader.parse(await created.json()).userId;
}

async function loginChipReader(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

test.describe("Chip tones hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	for (const state of ["cancellation-scheduled", "inactive"] as const) {
		test(`the ${state} status chip clears its contrast minimum`, async ({ page }, testInfo) => {
			const email = `colour-contrast-chip-${state}-${testInfo.workerIndex}-${Date.now()}@example.com`;
			const userId = await createChipReader(page, email);
			const seeded = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
				data: { userId, state, at: "2027-03-01T00:00:00.000Z" },
			});
			assert.equal(seeded.status(), 201);
			await loginChipReader(page, email);

			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
				await expect(page.locator(`[data-test-subscription-chip="${state}"]`)).toBeVisible({ timeout: SETTLE_MS });
				await auditRoot(page, { root: "[data-test-subscription-banner]", theme, view: `chip/${state}` });
			}
		});
	}

	test("the setup guide's neutral tag clears its contrast minimum", async ({ page }, testInfo) => {
		const email = `colour-contrast-chip-tag-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createChipReader(page, email);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-inbox-article-queued`, { data: { userId } });
		assert.equal(seeded.status(), 201);
		await page.context().addCookies(
			[
				{ name: ALIVE_COOKIE_NAME, value: ALIVE_COOKIE_VALUE },
				{ name: SAVE_COOKIE_NAME, value: SAVE_COOKIE_VALUE },
			].map((cookie) => ({ ...cookie, url: BASE_URL })),
		);
		await loginChipReader(page, email);

		// Resolve Gmail too so the Next Read task exposes the chip being audited.
		const dismissed = await page.request.post(`${BASE_URL}/queue/onboarding/gmail/dismiss`);
		assert.equal(dismissed.status(), 200);

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("[data-test-onboarding-chip]")).toBeVisible({ timeout: SETTLE_MS });
			await auditRoot(page, { root: "[data-test-setup-guide]", theme, view: "chip/setup-guide" });
		}
	});

	test("the reader's accent tag and accent badges clear their contrast minimum", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `colour-contrast-chip-reader-${run}@example.com`;
		const userId = await createChipReader(page, email);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/colour-contrast-chip-${run}`,
				title: "Chip tones in the reader",
				content: "<p>Seeded body for the chip contrast sweep.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedByUserId: userId,
				crawlVersions: [
					{ crawledAtMinute: "2026-07-10T09:14Z", authorUserId: userId },
					{ crawledAtMinute: "2026-06-28T22:01Z" },
				],
				generatedSummary: { summary: "Seeded summary.", excerpt: "Seeded summary." },
			},
		});
		assert.equal(seeded.status(), 201);
		const { articleId } = z.object({ articleId: z.string() }).parse(await seeded.json());
		await loginChipReader(page, email);
		await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
		await page.locator("[data-test-readlists-trigger]").click({ timeout: SETTLE_MS });
		await page.locator("[data-test-readlist-create-name]").fill("Weekend");
		await page.locator('[data-test-action="readlist-create-assign"]').click();
		await expect(page.locator("[data-test-readlist-tag]")).toBeVisible({ timeout: SETTLE_MS });

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("[data-test-readlist-tag]")).toBeVisible({ timeout: SETTLE_MS });
			await expect(page.locator("[data-test-crawl-bookmark-badge]")).toHaveText(["Best", "Me"]);
			await auditRoot(page, { root: "#article-header", theme, view: "chip/readlist-tag" });
			await auditRoot(page, { root: ".crawl-bookmark", theme, view: "chip/crawl-badges" });
		}
	});

	test("the readlist card's topic tags clear their contrast minimum", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `colour-contrast-chip-topics-${run}@example.com`;
		const userId = await createChipReader(page, email);
		const topics = ["Productivity", "Focus", "Lifestyle"];
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/colour-contrast-topics-${run}`,
				title: "Topic tags on a readlist card",
				content: "<p>Seeded body for the topic contrast sweep.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedByUserId: userId,
				generatedSummary: { summary: "Seeded summary.", excerpt: "Seeded summary.", topics },
			},
		});
		assert.equal(seeded.status(), 201);
		await loginChipReader(page, email);

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("[data-test-article-topic]")).toHaveText(topics, { timeout: SETTLE_MS });
			await auditRoot(page, { root: "[data-test-article-topics]", theme, view: "chip/topic-tags" });
		}
	});
});

test.describe("Plan choice holds its WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("the open subscribe plans dialog clears its contrast minimum", async ({ page }, testInfo) => {
		const email = `colour-contrast-plans-${testInfo.workerIndex}-${Date.now()}@example.com`;
		const userId = await createChipReader(page, email);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-subscription-state`, {
			data: { userId, state: "trialing" },
		});
		assert.equal(seeded.status(), 201);
		await loginChipReader(page, email);
		const panel = '[data-test-confirm-popover="subscribe-plans"]';

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			await page.locator('[data-test-action="subscribe-plans-open"]').click({ timeout: SETTLE_MS });
			await expect(page.locator(`${panel}:popover-open`)).toBeVisible({ timeout: SETTLE_MS });
			await auditRoot(page, { root: panel, theme, view: "queue/subscribe-plans" });
			await page.keyboard.press("Escape");
			await expect(page.locator(`${panel}:popover-open`)).toBeHidden({ timeout: SETTLE_MS });
		}
	});
});

test.describe("Readlist preferences colour roles hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("every rendered preferences surface clears its contrast minimum", async ({ page }, testInfo) => {
		const email = `colour-contrast-preferences-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await createChipReader(page, email);
		await loginChipReader(page, email);
		const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: "Weekend" } });
		assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
		const slug = new URL(created.url()).searchParams.get("queue");
		assert(slug, "creating a readlist must land the reader on it");
		const preferencesUrl = `${BASE_URL}/queue/queues/${slug}/preferences?feature=pref`;
		const preferences = "[data-test-readlist-preferences]";

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(preferencesUrl, { waitUntil: "domcontentloaded" });
			await expect(page.locator(preferences)).toHaveAttribute("data-test-preferences-state", "unset");
			await auditRoot(page, { root: preferences, theme, view: "preferences/unset" });
		}

		const saved = await page.request.post(preferencesUrl, {
			form: { purpose: "Long-form essays about how teams actually ship software." },
		});
		assert.equal(saved.status(), 200, "a saved purpose must land back on the preferences tab");
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(preferencesUrl, { waitUntil: "domcontentloaded" });
			await expect(page.locator(preferences)).toHaveAttribute("data-test-preferences-state", "set");
			await auditRoot(page, { root: preferences, theme, view: "preferences/set" });
			await page.locator('[data-test-action="readlist-preferences-menu"]').click({ timeout: SETTLE_MS });
			await expect(page.locator('[data-test-action="readlist-preferences-edit"]')).toBeVisible({ timeout: SETTLE_MS });
			await auditRoot(page, { root: preferences, theme, view: "preferences/menu-open" });
		}
	});
});

const GMAIL_ROOT = "main.gmail";
const ADMIN_INDEX_ROOT = "main.admin-index";
const ADMIN_NEWSLETTERS_ROOT = "main.admin-newsletters";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_AT = "2026-09-01T00:00:00.000Z";
const CreatedReader = z.object({ ok: z.literal(true), userId: z.string() });

async function seedNewsletterCatalog(
	page: Page,
	input: {
		namespace: string;
		mode: "available" | "unavailable";
		records: { from: string; name: string; status: "pending" | "approved" | "rejected"; replacedBy?: string }[];
	},
): Promise<void> {
	await page.context().addCookies([{ name: CATALOG_COOKIE, value: input.namespace, url: BASE_URL }]);
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace: input.namespace,
			mode: input.mode,
			records: input.records.map((record) => ({
				...record,
				evidence: [{ kind: "admin", url: "https://publisher.example/newsletter", note: "Seen in the From header", addedAt: CATALOG_AT }],
				createdAt: CATALOG_AT,
				updatedAt: CATALOG_AT,
			})),
		},
	});
	assert.equal(seeded.status(), 201);
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

test.describe("GMail Newsletters colour roles hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("the open pickers and every mapping row clear their contrast minimum", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		await seedNewsletterCatalog(page, {
			namespace: `colour-contrast-gmail-${run}`,
			mode: "available",
			records: [
				{ from: "dan@tldr.tech", name: "TLDR", status: "approved" },
				{ from: "crew@morningbrew.com", name: "Morning Brew", status: "approved" },
			],
		});
		const email = `colour-contrast-gmail-${run}@example.com`;
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email, password: PASSWORD, verified: true },
		});
		assert.equal(created.status(), 201);
		const { userId } = CreatedReader.parse(await created.json());
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
			data: {
				userId,
				filter: "failed-rejected",
				readlists: ["Tech"],
				discoveredSenders: [
					{ email: "dan@tldr.tech", name: "TLDR" },
					{ email: "crew@morningbrew.com", name: "Morning Brew" },
				],
				mappings: [
					{ destination: "readlist", email: "awaiting@publisher.example", readlist: "Tech" },
					{ destination: "readlist", email: "running@publisher.example", readlist: "Tech" },
					{ destination: "readlist", email: "complete@publisher.example", readlist: "All" },
					{ destination: "readlist", email: "failed@publisher.example", readlist: "All" },
					{ destination: "missing", email: "missing@publisher.example" },
					{ destination: "readlist", email: "pending@publisher.example", readlist: "All", pending: true },
				],
				imports: [
					{ sender: "awaiting@publisher.example", state: "awaiting-permission" },
					{ sender: "running@publisher.example", state: "running", counts: { listed: 9, imported: 3 } },
					{ sender: "complete@publisher.example", state: "complete", counts: { imported: 4, alreadyImported: 1, failed: 1 } },
					{ sender: "failed@publisher.example", state: "failed", failureReason: "gmail-rejected" },
				],
			},
		});
		assert.equal(seeded.status(), 201);
		await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
		await page.locator("#email").fill(email);
		await page.locator("#password").fill(PASSWORD);
		await page.locator('[data-test-form="login"] button[type="submit"]').click();
		await page.waitForSelector("body.page-readlist");

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/newsletters/gmail?discovery=started&notice=sender_mapped&sender=dan%40tldr.tech`, {
				waitUntil: "domcontentloaded",
			});
			await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
			await expect(page.locator("[data-test-gmail-import-consent]").first()).toBeVisible({ timeout: SETTLE_MS });

			await page.locator("[data-test-gmail-sender-picker] summary").click();
			await expect(page.locator('[data-test-gmail-sender-results][data-results-state="listed"]')).toBeVisible({
				timeout: SETTLE_MS,
			});
			await auditRoot(page, { root: GMAIL_ROOT, theme, view: "gmail/sender-picker" });

			await page.keyboard.press("Escape");
			await expect(page.locator("[data-test-gmail-sender-picker]")).not.toHaveAttribute("open");
			const readlistPicker = page.locator("[data-test-gmail-readlist-picker]");
			if ((await readlistPicker.getAttribute("open")) === null) await readlistPicker.locator("summary").click();
			await expect(page.locator("[data-test-gmail-readlist-create]")).toBeVisible({ timeout: SETTLE_MS });
			await auditRoot(page, { root: GMAIL_ROOT, theme, view: "gmail/readlist-picker" });
		}
	});
});

test.describe("Admin newsletter colour roles hold their WCAG contrast in both themes", () => {
	test.use({ timezoneId: "UTC", viewport: VIEWPORT });

	test("the admin index, every status list, the review form and the failure alerts clear their contrast minimum", async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const created = await page.request.post(`${BASE_URL}/e2e/users`, {
			data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
		});
		assert.equal(created.status(), 201);
		await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
		await page.locator("#email").fill(E2E_ADMIN_EMAIL);
		await page.locator("#password").fill(E2E_ADMIN_PASSWORD);
		await page.locator('[data-test-form="login"] button[type="submit"]').click();
		await page.waitForSelector("body.page-readlist");

		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
			await page.waitForSelector("body.page-admin");
			await auditRoot(page, { root: ADMIN_INDEX_ROOT, theme, view: "admin/index" });

			await seedNewsletterCatalog(page, {
				namespace: `colour-contrast-admin-${theme}-${run}`,
				mode: "available",
				records: [
					{ from: "pending@publisher.example", name: "Pending Weekly", status: "pending" },
					{ from: "approved@publisher.example", name: "Approved Daily", status: "approved" },
					{ from: "old@publisher.example", name: "Replaced Digest", status: "rejected", replacedBy: "approved@publisher.example" },
				],
			});
			await page.goto(`${BASE_URL}/admin/newsletters?list_status=all&notice=approved`, { waitUntil: "domcontentloaded" });
			await expect(page.locator('[data-test-alert="newsletter-notice"]')).toBeVisible({ timeout: SETTLE_MS });
			await expect(page.locator("[data-test-admin-newsletter-row]")).toHaveCount(3);
			await auditRoot(page, { root: ADMIN_NEWSLETTERS_ROOT, theme, view: "admin/all-statuses" });

			await page.goto(`${BASE_URL}/admin/newsletters?new=1`, { waitUntil: "domcontentloaded" });
			const form = page.locator('[data-test-admin-newsletter-form="create"]');
			await form.locator('input[name="from"]').fill("no-evidence@publisher.example");
			await form.locator("[data-test-admin-newsletter-submit]").click();
			await expect(page.locator('[data-test-admin-newsletter-form="create"] [data-test-error="evidence_note"]')).toBeVisible({
				timeout: SETTLE_MS,
			});
			await auditRoot(page, { root: ADMIN_NEWSLETTERS_ROOT, theme, view: "admin/create-validation" });

			await page.goto(`${BASE_URL}/admin/newsletters?list_status=approved&edit=${encodeURIComponent("approved@publisher.example")}`, {
				waitUntil: "domcontentloaded",
			});
			const edit = page.locator('[data-test-admin-newsletter-form="edit"]');
			await edit.locator('input[name="updated_at"]').evaluate((input: HTMLInputElement) => {
				input.value = "2026-01-01T00:00:00.000Z";
			});
			await edit.locator("[data-test-admin-newsletter-submit]").click();
			await expect(page.locator("[data-test-admin-newsletter-conflict]")).toBeVisible({ timeout: SETTLE_MS });
			await auditRoot(page, { root: ADMIN_NEWSLETTERS_ROOT, theme, view: "admin/conflict" });

			await seedNewsletterCatalog(page, {
				namespace: `colour-contrast-admin-unavailable-${theme}-${run}`,
				mode: "unavailable",
				records: [],
			});
			await page.goto(`${BASE_URL}/admin/newsletters`, { waitUntil: "domcontentloaded" });
			await expect(page.locator('[data-test-alert="newsletter-storage"]')).toBeVisible({ timeout: SETTLE_MS });
			await auditRoot(page, { root: ADMIN_NEWSLETTERS_ROOT, theme, view: "admin/storage-failure" });
		}
	});
});
