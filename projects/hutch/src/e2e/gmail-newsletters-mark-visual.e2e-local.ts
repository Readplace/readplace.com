import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	type CaptureMode,
	captureCheckpoint,
	expect,
	measuredBox,
	test,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { z } from "zod";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { blockTimerPolls, mappingRouteGaps, removeVolatileChrome, scrollBoxTo } from "./gmail-newsletters-visual.browser";
import { pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TLDR = "dan@tldr.tech";
const BREW = "crew@morningbrew.com";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_TIMESTAMP = "2026-09-01T00:00:00.000Z";
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

const GMAIL_PAGE = "body.page-integrations-gmail";
const MAPPINGS = "#gmail-mappings";
const DIALOG = "#gmail-dialog";
const OPEN_DIALOG = "#gmail-dialog:popover-open";
const DIALOG_FOOTER = "[data-test-gmail-dialog-footer]";
const TLDR_ROW = `[data-test-gmail-mapping-row="${TLDR}"]`;
const MARK_STATE = `${TLDR_ROW} [data-test-gmail-mark-state]`;
const MARK_BOX = `${TLDR_ROW} [data-test-gmail-mark-checkbox="card"]`;
const MARK_BACKFILL = `${TLDR_ROW} [data-test-gmail-mark-backfill]`;
const DIALOG_MARK_BOX = '[data-test-gmail-mark-checkbox="dialog"]';
const ROUTE_GAP_PX = 8;

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const WIDTHS = [
	{ name: "desktop", viewport: { width: 1280, height: 900 } },
	{ name: "mobile", viewport: { width: 390, height: 844 } },
] as const;
const THEMES = ["light", "dark"] as const;

type BackfillCounts = Partial<Record<"marked" | "alreadyMarked" | "notFound" | "unlocatable" | "notSaved" | "failed", number>>;

type SeedBackfill =
	| { sender: string; state: "running" | "complete"; counts?: BackfillCounts }
	| { sender: string; state: "failed"; failureReason: "permission-revoked" | "gmail-rejected" | "dead-lettered"; counts?: BackfillCounts };

interface MarkSeed {
	modify: boolean;
	mark: boolean;
	backfills: SeedBackfill[];
}

async function openMark(
	page: Page,
	input: { stamp: string; seed: MarkSeed; query?: string },
): Promise<void> {
	const namespace = `gmail-mark-${input.stamp}`;
	await page.context().addCookies([{ name: CATALOG_COOKIE, value: namespace, url: BASE_URL }]);
	const catalog = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace,
			records: [
				{ from: TLDR, name: "TLDR", status: "approved", evidence: [], createdAt: CATALOG_TIMESTAMP, updatedAt: CATALOG_TIMESTAMP },
				{ from: BREW, name: "Morning Brew", status: "approved", evidence: [], createdAt: CATALOG_TIMESTAMP, updatedAt: CATALOG_TIMESTAMP },
			],
		},
	});
	assert.equal(catalog.status(), 201, "the catalog seed must be accepted");

	const email = `gmail-mark-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId,
			grantedScopes: input.seed.modify ? ["settings", "metadata", "modify"] : ["settings", "metadata"],
			readlists: ["Tech"],
			discoveredSenders: [
				{ email: TLDR, name: "TLDR" },
				{ email: BREW, name: "Morning Brew" },
			],
			mappings: [{ destination: "readlist", email: TLDR, readlist: "Tech", mark: input.seed.mark }],
			backfills: input.seed.backfills,
		},
	});
	assert.equal(seeded.status(), 201, `the gmail state seed must be accepted: ${await seeded.text()}`);

	await page.addInitScript(blockTimerPolls);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/newsletters/gmail?discovery=started${input.query ?? ""}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector(GMAIL_PAGE);
	await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
	await expect(page.locator(MAPPINGS)).toBeVisible();
}

async function settledGmailPage(page: Page): Promise<void> {
	await page.waitForSelector(GMAIL_PAGE);
	await expect(page.locator(".htmx-request, .htmx-swapping, .htmx-settling")).toHaveCount(0);
	await page.evaluate(removeVolatileChrome, VOLATILE_CHROME);
	await page.mouse.move(0, 0);
}

async function panelFitsViewport(page: Page): Promise<void> {
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the Gmail page must never scroll sideways");
	const viewport = page.viewportSize();
	assert.ok(viewport, "mark checkpoints run with an explicit viewport");
	const panel = await measuredBox(page, DIALOG);
	const footer = await measuredBox(page, DIALOG_FOOTER);
	const lastOption = await measuredBox(page, ".gmail__import-option >> nth=-1");
	assert.ok(panel.x >= 0 && panel.x + panel.width <= viewport.width + 0.5, "the panel must fit the viewport sideways");
	assert.ok(panel.y >= 0 && panel.y + panel.height <= viewport.height + 0.5, "the panel must fit the viewport");
	assert.ok(
		await page.locator(DIALOG).evaluate((element) => element.scrollWidth <= element.clientWidth),
		"the panel must never scroll sideways",
	);
	assert.ok(lastOption.y + lastOption.height <= footer.y + 0.5, "the import and mark-read options must sit above Cancel and Save");
	assert.ok(
		footer.y >= panel.y && footer.y + footer.height <= panel.y + panel.height + 0.5,
		"Cancel and Save must stay visible at the panel bottom",
	);
}

function fitsViewport(target: string): (page: Page) => Promise<void> {
	return async (page) => {
		assert.equal(await page.evaluate(pageOverflowsSideways), false, "the Gmail page must never scroll sideways");
		const viewport = page.viewportSize();
		assert.ok(viewport, "mark checkpoints run with an explicit viewport");
		const box = await measuredBox(page, target);
		assert.ok(box.x >= 0, `"${target}" must start inside the viewport`);
		assert.ok(box.x + box.width <= viewport.width + 0.5, `"${target}" must end inside the viewport`);
		const gaps = await page.locator("[data-test-gmail-mapping-row]").evaluateAll(mappingRouteGaps);
		for (const gap of gaps) {
			assert.ok(gap <= ROUTE_GAP_PX + 0.5, `the readlist must follow its newsletter closely, got a ${gap}px gap`);
		}
	};
}

async function captureMatrix(
	page: Page,
	input: { state: string; target: string; capture: CaptureMode },
): Promise<void> {
	for (const width of WIDTHS) {
		await fitViewportToPage(page, width.viewport);
		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await captureCheckpoint(page, {
				name: `gmail-mark-${input.state}-${width.name}-${theme}`,
				settled: settledGmailPage,
				geometry: fitsViewport(input.target),
				target: input.target,
				capture: input.capture,
				pinnedText: [],
			});
		}
	}
	await page.setViewportSize(WIDTHS[0].viewport);
}

async function capturePopupScrolledToSave(page: Page, state: string): Promise<void> {
	for (const width of WIDTHS) {
		await page.setViewportSize(width.viewport);
		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await captureCheckpoint(page, {
				name: `gmail-mark-${state}-${width.name}-${theme}`,
				settled: async (settling) => {
					await expect(settling.locator(OPEN_DIALOG)).toBeVisible();
					await settledGmailPage(settling);
					await settling.evaluate(scrollBoxTo, { selector: DIALOG, top: Number.MAX_SAFE_INTEGER });
				},
				geometry: panelFitsViewport,
				target: DIALOG,
				capture: "element",
				pinnedText: [],
			});
		}
	}
	await page.setViewportSize(WIDTHS[0].viewport);
}

function alert(key: string): string {
	return `[data-test-alert="${key}"]`;
}

function rowAction(key: string): string {
	return `${TLDR_ROW} [data-test-gmail-mapping-action="${key}"]`;
}

function stampFor(label: string): string {
	return `${label}-${test.info().workerIndex}-${Date.now()}`;
}

test.describe("GMail Newsletters mark-as-read option", () => {
	test.use({ timezoneId: "UTC", viewport: WIDTHS[0].viewport });

	test("card off: a mapped newsletter offers the option unticked", async ({ page }) => {
		await openMark(page, { stamp: stampFor("card-off"), seed: { modify: true, mark: false, backfills: [] } });
		await expect(page.locator(MARK_STATE)).toHaveAttribute("data-test-gmail-mark-state", "off");
		await expect(page.locator(MARK_BOX)).not.toBeChecked();
		await expect(page.locator(MARK_BOX)).toBeEnabled();
		await expect(page.locator(MARK_BACKFILL)).toHaveCount(0);

		await captureMatrix(page, { state: "card-off", target: MAPPINGS, capture: "element" });
	});

	test("card on: the ticked option offers to update earlier emails", async ({ page }) => {
		await openMark(page, { stamp: stampFor("card-on"), seed: { modify: true, mark: true, backfills: [] } });
		await expect(page.locator(MARK_STATE)).toHaveAttribute("data-test-gmail-mark-state", "on");
		await expect(page.locator(MARK_BOX)).toBeChecked();
		await expect(page.locator(MARK_BACKFILL)).toHaveAttribute("data-test-gmail-mark-backfill", "offer");
		await expect(page.locator(rowAction("mark-read-backfill"))).toBeVisible();

		await captureMatrix(page, { state: "card-on", target: MAPPINGS, capture: "element" });
	});

	test("backfill running: earlier emails are being updated", async ({ page }) => {
		await openMark(page, {
			stamp: stampFor("backfill-running"),
			seed: {
				modify: true,
				mark: true,
				backfills: [{ sender: TLDR, state: "running", counts: { marked: 6, alreadyMarked: 1, notFound: 1 } }],
			},
		});
		await expect(page.locator(MARK_BACKFILL)).toHaveAttribute("data-test-gmail-mark-backfill", "running");
		await expect(page.locator(MAPPINGS)).toHaveAttribute("data-imports-polling", "true");
		await expect(page.locator(`${TLDR_ROW} [data-test-gmail-mark-backfill-count="marked"]`)).toBeVisible();

		await captureMatrix(page, { state: "backfill-running", target: MAPPINGS, capture: "element" });
	});

	test("backfill done: earlier emails were updated", async ({ page }) => {
		await openMark(page, {
			stamp: stampFor("backfill-done"),
			seed: {
				modify: true,
				mark: true,
				backfills: [{ sender: TLDR, state: "complete", counts: { marked: 12, notFound: 2 } }],
			},
		});
		await expect(page.locator(MARK_BACKFILL)).toHaveAttribute("data-test-gmail-mark-backfill", "done");
		await expect(page.locator(MAPPINGS)).toHaveAttribute("data-imports-polling", "false");
		await expect(page.locator(`${TLDR_ROW} [data-test-gmail-mark-backfill-count="marked"]`)).toBeVisible();

		await captureMatrix(page, { state: "backfill-done", target: MAPPINGS, capture: "element" });
	});

	test("backfill failed: Google took the permission away and the update can be tried again", async ({ page }) => {
		await openMark(page, {
			stamp: stampFor("backfill-failed"),
			seed: {
				modify: true,
				mark: true,
				backfills: [{ sender: TLDR, state: "failed", failureReason: "permission-revoked", counts: { marked: 3 } }],
			},
		});
		await expect(page.locator(MARK_BACKFILL)).toHaveAttribute("data-test-gmail-mark-backfill", "failed");
		await expect(page.locator(rowAction("mark-read-retry"))).toBeVisible();

		await captureMatrix(page, { state: "backfill-failed", target: MAPPINGS, capture: "element" });
	});

	test("permission lost: the ticked option asks to allow it in Gmail again", async ({ page }) => {
		await openMark(page, { stamp: stampFor("permission-lost"), seed: { modify: false, mark: true, backfills: [] } });
		await expect(page.locator(MARK_STATE)).toHaveAttribute("data-test-gmail-mark-state", "permission-lost");
		await expect(page.locator(MARK_BOX)).toBeChecked();
		await expect(page.locator(`${TLDR_ROW} [data-test-gmail-mark-hint]`)).toBeVisible();
		await expect(page.locator(rowAction("grant-mark-permission"))).toBeVisible();
		await expect(page.locator(MARK_BACKFILL)).toHaveCount(0);

		await captureMatrix(page, { state: "permission-lost", target: MAPPINGS, capture: "element" });
	});

	test("dialog: with the permission granted the option starts ticked", async ({ page }) => {
		await openMark(page, {
			stamp: stampFor("dialog-default-ticked"),
			seed: { modify: true, mark: false, backfills: [] },
			query: "&add=1",
		});
		await expect(page.locator(OPEN_DIALOG)).toHaveAttribute("data-test-confirm-popover", "gmail-add");
		const brewTick = page.locator(`[data-test-gmail-checklist-group="known"] [data-test-gmail-checklist-sender="${BREW}"]`);
		await brewTick.check();
		await expect(brewTick).toBeChecked();
		await expect(page.locator(DIALOG_MARK_BOX)).toBeChecked();
		await expect(page.locator(DIALOG_MARK_BOX)).toBeEnabled();

		await capturePopupScrolledToSave(page, "dialog-default-ticked");
	});

	test("refused: ticking without the permission waits unticked when Google refuses", async ({ page }) => {
		await page.context().route(
			(url) => url.hostname === "accounts.google.com",
			(route) => {
				const state = new URL(route.request().url()).searchParams.get("state");
				assert.ok(state, "the Gmail consent request must carry its signed state");
				return route.fulfill({
					status: 302,
					headers: {
						location: `${BASE_URL}/integrations/gmail/callback?error=access_denied&state=${encodeURIComponent(state)}`,
					},
				});
			},
		);
		await openMark(page, { stamp: stampFor("refused"), seed: { modify: false, mark: false, backfills: [] } });
		await expect(page.locator(MARK_BOX)).not.toBeChecked();
		await page.locator(MARK_BOX).click();
		await expect(page.locator(alert("mark_permission_refused"))).toBeVisible();
		await expect(page.locator(MARK_STATE)).toHaveAttribute("data-test-gmail-mark-state", "off");
		await expect(page.locator(MARK_BOX)).not.toBeChecked();

		await captureMatrix(page, { state: "refused-notice", target: alert("mark_permission_refused"), capture: "element" });
	});
});
