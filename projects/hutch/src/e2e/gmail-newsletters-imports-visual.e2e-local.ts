import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	type CaptureMode,
	captureCheckpoint,
	expect,
	measuredBox,
	test,
} from "@packages/e2e-harness";
import { GMAIL_HISTORY_IMPORT_MAX_POLLS } from "@packages/domain/gmail";
import { requireEnv } from "@packages/require-env";
import { z } from "zod";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { blockTimerPolls, mappingRouteGaps, removeVolatileChrome } from "./gmail-newsletters-visual.browser";
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
const MAPPING_FORM = ".gmail__mapping-form";
const TLDR_ROW = `[data-test-gmail-mapping-row="${TLDR}"]`;
const IMPORT_STATE = `${TLDR_ROW} [data-test-gmail-import-state]`;
const IMPORT_CHECKBOX = '[data-test-gmail-save-mapping] input[name="import"]';
const ROUTE_GAP_PX = 8;

const VOLATILE_CHROME = [
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const WIDTHS = [
	{ name: "desktop", viewport: { width: 1280, height: 900 } },
	{ name: "mobile", viewport: { width: 390, height: 844 } },
] as const;
const THEMES = ["light", "dark"] as const;

type ImportCounts = Partial<
	Record<"imported" | "alreadyImported" | "skippedNoMessageId" | "skippedSenderMismatch" | "failed" | "cancelled", number>
>;

type SeedImport =
	| { sender: string; state: "awaiting-permission" | "queued" | "running" | "complete"; counts?: ImportCounts }
	| { sender: string; state: "failed"; failureReason: "gmail-rejected" | "permission-revoked" | "dead-lettered"; counts?: ImportCounts };

interface ImportsSeed {
	readonly: boolean;
	mapped: boolean;
	imports: SeedImport[];
}

async function openImports(
	page: Page,
	input: { stamp: string; seed: ImportsSeed; query?: string },
): Promise<void> {
	const namespace = `gmail-imports-${input.stamp}`;
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

	const email = `gmail-imports-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId,
			grantedScopes: input.seed.readonly ? ["settings", "metadata", "readonly"] : ["settings", "metadata"],
			readlists: ["Tech"],
			discoveredSenders: [
				{ email: TLDR, name: "TLDR" },
				{ email: BREW, name: "Morning Brew" },
			],
			mappings: input.seed.mapped ? [{ destination: "readlist", email: TLDR, readlist: "Tech" }] : [],
			imports: input.seed.imports,
		},
	});
	assert.equal(seeded.status(), 201, "the gmail state seed must be accepted");

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

function fitsViewport(target: string): (page: Page) => Promise<void> {
	return async (page) => {
		assert.equal(await page.evaluate(pageOverflowsSideways), false, "the Gmail page must never scroll sideways");
		const viewport = page.viewportSize();
		assert.ok(viewport, "import checkpoints run with an explicit viewport");
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
				name: `gmail-imports-${input.state}-${width.name}-${theme}`,
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

function alert(key: string): string {
	return `[data-test-alert="${key}"]`;
}

function rowAction(key: string): string {
	return `${TLDR_ROW} [data-test-gmail-mapping-action="${key}"]`;
}

async function expectCounts(page: Page, expected: Record<string, string>): Promise<void> {
	for (const [key, label] of Object.entries(expected)) {
		await expect(page.locator(`${TLDR_ROW} [data-test-gmail-import-count="${key}"]`)).toHaveText(label);
	}
}

function stampFor(label: string): string {
	return `${label}-${test.info().workerIndex}-${Date.now()}`;
}

test.describe("GMail Newsletters import states", () => {
	test.use({ timezoneId: "UTC", viewport: WIDTHS[0].viewport });

	test("consent: a new mapping offers the import, asks for permission, and waits when Google refuses", async ({
		page,
	}) => {
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
		await openImports(page, {
			stamp: stampFor("consent"),
			seed: { readonly: false, mapped: false, imports: [] },
		});

		await page.locator("[data-test-gmail-sender-picker] summary").click();
		await page.locator(`[data-test-gmail-sender-option="${TLDR}"]`).click();
		await expect(page.locator("#gmail-sender-choice")).toContainText(TLDR);
		const readlistPicker = page.locator("[data-test-gmail-readlist-picker]");
		await expect(readlistPicker).not.toHaveAttribute("open", "");
		await readlistPicker.locator("summary").click();
		await expect(readlistPicker).toHaveAttribute("open", "");
		await page.locator('[data-test-gmail-readlist-option]:not([data-test-gmail-readlist-option="default"])').click();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, Tech");
		await expect(page.locator(IMPORT_CHECKBOX)).not.toBeChecked();
		await page.locator(IMPORT_CHECKBOX).check();
		await expect(page.locator("[data-test-gmail-sender-picker]")).not.toHaveAttribute("open", "");
		await expect(readlistPicker).not.toHaveAttribute("open", "");
		await captureMatrix(page, { state: "consent-checkbox", target: MAPPING_FORM, capture: "element" });

		await page.locator("[data-test-gmail-save]").click();
		await expect(page.locator(alert("import_permission_needed"))).toBeVisible();
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "awaiting-permission");
		await expect(page.locator(`${TLDR_ROW} [data-test-gmail-import-consent]`)).toBeVisible();
		await captureMatrix(page, { state: "consent-notice", target: alert("import_permission_needed"), capture: "element" });
		await captureMatrix(page, { state: "permission-waiting", target: MAPPINGS, capture: "element" });

		await page.locator(rowAction("grant-import-permission")).click();
		await expect(page.locator(alert("import_permission_refused"))).toBeVisible();
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "awaiting-permission");
		await captureMatrix(page, { state: "permission-refused", target: alert("import_permission_refused"), capture: "element" });
	});

	test("queued: the import waits for its first page", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("queued"),
			seed: { readonly: true, mapped: true, imports: [{ sender: TLDR, state: "queued" }] },
		});
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "queued");
		await expect(page.locator(MAPPINGS)).toHaveAttribute("data-imports-polling", "true");
		await expect(page.locator(rowAction("cancel-import"))).toBeVisible();

		await captureMatrix(page, { state: "queued", target: MAPPINGS, capture: "element" });
	});

	test("running: counts grow while unread messages are imported", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("running"),
			seed: {
				readonly: true,
				mapped: true,
				imports: [{ sender: TLDR, state: "running", counts: { imported: 6, alreadyImported: 1, skippedNoMessageId: 1 } }],
			},
		});
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "running");
		await expect(page.locator(MAPPINGS)).toHaveAttribute("data-imports-polling", "true");
		await expectCounts(page, { imported: "6 imported", "already-imported": "1 already imported" });

		await captureMatrix(page, { state: "running", target: MAPPINGS, capture: "element" });
	});

	test("no unread mail: the last 30 days held nothing to import", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("no-unread"),
			seed: { readonly: true, mapped: true, imports: [{ sender: TLDR, state: "complete" }] },
		});
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "no-unread");
		await expect(page.locator(`${TLDR_ROW} [data-test-gmail-import-count]`)).toHaveCount(0);

		await captureMatrix(page, { state: "no-unread", target: MAPPINGS, capture: "element" });
	});

	test("duplicate and skipped counts: already imported and messages without a Message-ID are counted apart", async ({
		page,
	}) => {
		await openImports(page, {
			stamp: stampFor("duplicate-skipped"),
			seed: {
				readonly: true,
				mapped: true,
				imports: [
					{
						sender: TLDR,
						state: "complete",
						counts: { imported: 9, alreadyImported: 4, skippedNoMessageId: 3, skippedSenderMismatch: 1 },
					},
				],
			},
		});
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "complete");
		await expectCounts(page, {
			imported: "9 imported",
			"already-imported": "4 already imported",
			"skipped-no-message-id": "3 skipped (no message ID)",
			"skipped-sender-mismatch": "1 skipped (different sender)",
			failed: "0 failed",
		});

		await captureMatrix(page, { state: "duplicate-skipped-counts", target: MAPPINGS, capture: "element" });
	});

	test("completion: imported emails may still have article links processing", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("completion"),
			seed: { readonly: true, mapped: true, imports: [{ sender: TLDR, state: "complete", counts: { imported: 14 } }] },
		});
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "complete");
		await expect(page.locator(`${TLDR_ROW} .gmail-mappings__import-message`)).toContainText(
			"Article links may still be processing.",
		);
		await expect(page.locator(MAPPINGS)).toHaveAttribute("data-imports-polling", "false");

		await captureMatrix(page, { state: "completion", target: MAPPINGS, capture: "element" });
	});

	test("partial failure then retry: failed messages are offered again and the retry queues", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("partial-failure"),
			seed: {
				readonly: true,
				mapped: true,
				imports: [{ sender: TLDR, state: "complete", counts: { imported: 10, alreadyImported: 1, failed: 2 } }],
			},
		});
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "partial-failure");
		await expectCounts(page, { failed: "2 failed" });
		await expect(page.locator(rowAction("retry-import"))).toBeVisible();
		await captureMatrix(page, { state: "partial-failure", target: MAPPINGS, capture: "element" });

		await page.locator(rowAction("retry-import")).click();
		await expect(page.locator(alert("import_started"))).toBeVisible();
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "queued");
		await captureMatrix(page, { state: "retry-notice", target: alert("import_started"), capture: "element" });
		await captureMatrix(page, { state: "retry", target: MAPPINGS, capture: "element" });
	});

	test("failed: the import stopped after repeated errors", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("failed"),
			seed: {
				readonly: true,
				mapped: true,
				imports: [{ sender: TLDR, state: "failed", failureReason: "dead-lettered", counts: { imported: 3 } }],
			},
		});
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "failed");
		await expect(page.locator(rowAction("retry-import"))).toBeVisible();

		await captureMatrix(page, { state: "failed", target: MAPPINGS, capture: "element" });
	});

	test("cancellation: a running import stops and keeps what it imported", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("cancellation"),
			seed: {
				readonly: true,
				mapped: true,
				imports: [{ sender: TLDR, state: "running", counts: { imported: 5, alreadyImported: 1 } }],
			},
		});
		await page.locator(rowAction("cancel-import")).click();
		await expect(page.locator(alert("import_cancelled"))).toBeVisible();
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "cancelled");
		await expect(page.locator(`${TLDR_ROW} [data-test-gmail-import-count="cancelled"]`)).toBeVisible();
		await expect(page.locator(rowAction("start-import"))).toBeVisible();

		await captureMatrix(page, { state: "cancellation-notice", target: alert("import_cancelled"), capture: "element" });
		await captureMatrix(page, { state: "cancellation", target: MAPPINGS, capture: "element" });
	});

	test("import started: an existing mapping imports its unread messages on request", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("import-started"),
			seed: { readonly: true, mapped: true, imports: [] },
		});
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "none");
		await page.locator(rowAction("start-import")).click();
		await expect(page.locator(alert("import_started"))).toBeVisible();
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "queued");

		await captureMatrix(page, { state: "import-started-notice", target: alert("import_started"), capture: "element" });
	});

	test("import in progress: a second start for the same newsletter is refused", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("import-in-progress"),
			seed: { readonly: true, mapped: true, imports: [{ sender: TLDR, state: "complete", counts: { imported: 2 } }] },
		});
		const staleStart = page.locator(rowAction("start-import"));
		await expect(staleStart).toBeVisible();
		const otherTab = await page.request.post(`${BASE_URL}/newsletters/gmail/imports/start`, {
			form: { sender: TLDR },
			maxRedirects: 0,
		});
		assert.equal(otherTab.status(), 303, "the import started from another tab must be accepted");

		await staleStart.click();
		await expect(page.locator(alert("import_in_progress"))).toBeVisible();
		await expect(page.locator(IMPORT_STATE)).toHaveAttribute("data-test-gmail-import-state", "queued");

		await captureMatrix(page, { state: "import-in-progress", target: alert("import_in_progress"), capture: "element" });
	});

	test("polling exhausted: a long import asks the reader to refresh", async ({ page }) => {
		await openImports(page, {
			stamp: stampFor("polling-exhausted"),
			seed: {
				readonly: true,
				mapped: true,
				imports: [{ sender: TLDR, state: "running", counts: { imported: 40, alreadyImported: 2 } }],
			},
			query: `&imports_poll=${GMAIL_HISTORY_IMPORT_MAX_POLLS}`,
		});
		await expect(page.locator("[data-test-gmail-imports-exhausted]")).toBeVisible();
		await expect(page.locator(MAPPINGS)).toHaveAttribute("data-imports-polling", "false");

		await captureMatrix(page, { state: "polling-exhausted", target: MAPPINGS, capture: "element" });
	});
});
