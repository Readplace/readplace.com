import assert from "node:assert/strict";
import type { Locator, Page } from "@playwright/test";
import { captureCheckpoint, expect, measuredBox, test, type VisualCheckpoint } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./admin-extend-trial/admin-e2e-user";
import { statusBadgeLineCounts, suppressVolatileAdminUi } from "./admin-newsletters-visual.browser";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const READER_PASSWORD = "password123";
const CATALOG_NAMESPACE_COOKIE = "e2e_catalog_ns";

const SEEDED_YEAR_PREFIX = "2025-";
const FRESH_TIME_LABEL = "2026-09-30 12:00 UTC";

const VARIANTS = [
	{ width: "desktop", theme: "light", viewport: { width: 1280, height: 900 } },
	{ width: "desktop", theme: "dark", viewport: { width: 1280, height: 900 } },
	{ width: "mobile", theme: "light", viewport: { width: 390, height: 844 } },
	{ width: "mobile", theme: "dark", viewport: { width: 390, height: 844 } },
] as const;
type Variant = (typeof VARIANTS)[number];

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	"[data-test-verify-banner]",
];

const NEWSLETTERS_MAIN = "main[data-test-admin-newsletters]";
const INDEX_MAIN = "main[data-test-admin-index]";
const FORBIDDEN_MAIN = "main[data-test-admin-forbidden]";
const STATUS_BADGES = '[data-test-admin-newsletter-row] td[data-label="Status"] > span';
const NOTICE = '[data-test-alert="newsletter-notice"]';
const CONFLICT = '[data-test-alert="newsletter-conflict"]';
const STORAGE = '[data-test-alert="newsletter-storage"]';

type EvidenceKind = "seed" | "user-submission" | "admin";

interface SeedRecord {
	from: string;
	name?: string;
	status: "pending" | "approved" | "rejected";
	evidence: { kind: EvidenceKind; url?: string; note?: string; addedAt: string }[];
	replacedBy?: string;
	createdAt: string;
	updatedAt: string;
	reviewedAt?: string;
}

const QUIET_DISPATCH = "letters@quietdispatch.example.com";
const FIELD_NOTES = "hello@fieldnotes.example.com";
const LONGREADS = "digest@longreads.example.com";
const MORNING_ESSAY = "editor@morningessay.example.com";
const BUILD_LOG = "news@buildlog.example.com";
const SHOP_DEALS = "deals@shop.example.com";
const FIELD_GUIDE_OLD = "old@fieldguide.example.com";
const FIELD_GUIDE = "issues@fieldguide.example.com";
const FIELD_NOTES_CORRECTED = "issues@fieldnotes.example.com";

const CATALOG: readonly SeedRecord[] = [
	{
		from: QUIET_DISPATCH,
		name: "The Quiet Dispatch",
		status: "pending",
		evidence: [{ kind: "user-submission", note: "Sent from a reader's Gmail connection.", addedAt: "2025-03-02T09:15:00.000Z" }],
		createdAt: "2025-03-02T09:15:00.000Z",
		updatedAt: "2025-03-02T09:15:00.000Z",
	},
	{
		from: FIELD_NOTES,
		status: "pending",
		evidence: [{ kind: "user-submission", addedAt: "2025-03-04T14:40:00.000Z" }],
		createdAt: "2025-03-04T14:40:00.000Z",
		updatedAt: "2025-03-04T14:40:00.000Z",
	},
	{
		from: LONGREADS,
		name: "Longreads Weekly",
		status: "pending",
		evidence: [
			{
				kind: "seed",
				url: "https://longreads.example.com/newsletter",
				note: "The signup page names this FROM address.",
				addedAt: "2025-03-06T08:00:00.000Z",
			},
		],
		createdAt: "2025-03-06T08:00:00.000Z",
		updatedAt: "2025-03-06T08:00:00.000Z",
	},
	{
		from: MORNING_ESSAY,
		name: "The Morning Essay",
		status: "approved",
		evidence: [
			{
				kind: "admin",
				url: "https://morningessay.example.com/about",
				note: "Checked against a delivered issue.",
				addedAt: "2025-02-10T10:00:00.000Z",
			},
		],
		createdAt: "2025-02-10T10:00:00.000Z",
		updatedAt: "2025-02-12T16:30:00.000Z",
		reviewedAt: "2025-02-12T16:30:00.000Z",
	},
	{
		from: BUILD_LOG,
		name: "Build Log",
		status: "approved",
		evidence: [{ kind: "seed", note: "Publisher confirmed the sending address.", addedAt: "2025-01-20T12:00:00.000Z" }],
		createdAt: "2025-01-20T12:00:00.000Z",
		updatedAt: "2025-01-21T09:45:00.000Z",
		reviewedAt: "2025-01-21T09:45:00.000Z",
	},
	{
		from: FIELD_GUIDE,
		name: "Field Guide",
		status: "approved",
		evidence: [{ kind: "admin", note: "Replacement for the retired sending address.", addedAt: "2025-02-01T11:00:00.000Z" }],
		createdAt: "2025-02-01T11:00:00.000Z",
		updatedAt: "2025-02-02T08:20:00.000Z",
		reviewedAt: "2025-02-02T08:20:00.000Z",
	},
	{
		from: SHOP_DEALS,
		name: "Shop Deals",
		status: "rejected",
		evidence: [{ kind: "user-submission", note: "Promotional mail, not a newsletter.", addedAt: "2025-02-15T13:00:00.000Z" }],
		createdAt: "2025-02-15T13:00:00.000Z",
		updatedAt: "2025-02-16T07:10:00.000Z",
		reviewedAt: "2025-02-16T07:10:00.000Z",
	},
	{
		from: FIELD_GUIDE_OLD,
		name: "Field Guide",
		status: "rejected",
		evidence: [{ kind: "seed", addedAt: "2025-01-05T09:00:00.000Z" }],
		replacedBy: FIELD_GUIDE,
		createdAt: "2025-01-05T09:00:00.000Z",
		updatedAt: "2025-02-01T11:00:00.000Z",
		reviewedAt: "2025-02-01T11:00:00.000Z",
	},
];

const BULK_PENDING: readonly SeedRecord[] = Array.from({ length: 55 }, (_, index) => {
	const issue = String(index + 1).padStart(2, "0");
	const at = new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString();
	return {
		from: `issue-${issue}@bulk.example.com`,
		name: `Bulk Newsletter ${issue}`,
		status: "pending",
		evidence: [{ kind: "user-submission", addedAt: at }],
		createdAt: at,
		updatedAt: at,
	};
});

type CatalogMode = "available" | "unavailable" | "fail-next-write";

interface Scenario {
	name: string;
	target: string;
	records: readonly SeedRecord[];
	mode: CatalogMode;
	open: (page: Page, namespace: string) => Promise<void>;
}

async function seedCatalog(
	page: Page,
	input: { namespace: string; records: readonly SeedRecord[]; mode: CatalogMode },
): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, { data: input });
	assert.equal(seeded.status(), 201, "the e2e catalog fixture must answer the seed request");
}

async function signIn(page: Page, input: { email: string; password: string }): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, { data: { ...input, verified: true } });
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(input.email);
	await page.locator("#password").fill(input.password);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await expect(page.locator("body.page-login")).toHaveCount(0);
}

async function openList(page: Page, query: string): Promise<void> {
	await page.goto(`${BASE_URL}/admin/newsletters${query}`, { waitUntil: "domcontentloaded" });
	await expect(page.locator("body.page-admin-newsletters")).toHaveCount(1);
}

async function submitAndExpect(page: Page, control: Locator, arrived: string): Promise<void> {
	await control.click();
	await expect(page.locator(arrived).first()).toBeVisible();
	await expect(page.locator("body.page-admin-newsletters")).toHaveCount(1);
}

function rowAction(page: Page, input: { from: string; action: string }): Locator {
	return page.locator(`[data-test-admin-newsletter-row="${input.from}"] [data-test-admin-newsletter-action="${input.action}"]`);
}

function formField(page: Page, input: { kind: "create" | "edit" | "correct"; name: string }): Locator {
	return page.locator(`[data-test-admin-newsletter-form="${input.kind}"] [name="${input.name}"]`);
}

function formSubmit(page: Page, kind: "create" | "edit" | "correct"): Locator {
	return page.locator(`[data-test-admin-newsletter-form="${kind}"] [data-test-admin-newsletter-submit]`);
}

async function openCreateForm(page: Page): Promise<void> {
	await openList(page, "");
	await submitAndExpect(page, page.locator("[data-test-admin-newsletters-add] button"), '[data-test-admin-newsletter-form="create"]');
}

async function openEditForm(page: Page): Promise<void> {
	await openList(page, "");
	await submitAndExpect(page, rowAction(page, { from: QUIET_DISPATCH, action: "edit" }), '[data-test-admin-newsletter-form="edit"]');
}

async function openCorrectForm(page: Page): Promise<void> {
	await openList(page, "");
	await submitAndExpect(page, rowAction(page, { from: FIELD_NOTES, action: "correct" }), '[data-test-admin-newsletter-form="correct"]');
}

function review(input: { query: string; from: string; action: string }): Scenario["open"] {
	return async (page) => {
		await openList(page, input.query);
		await submitAndExpect(page, rowAction(page, { from: input.from, action: input.action }), NOTICE);
		await expect(page.locator(`[data-test-admin-newsletter-row="${input.from}"]`)).toHaveCount(0);
	};
}

function listing(query: string): Scenario["open"] {
	return (page) => openList(page, query);
}

const SCENARIOS: readonly Scenario[] = [
	{ name: "empty-pending", target: NEWSLETTERS_MAIN, records: [], mode: "available", open: listing("") },
	{ name: "empty-approved", target: NEWSLETTERS_MAIN, records: [], mode: "available", open: listing("?list_status=approved") },
	{ name: "empty-rejected", target: NEWSLETTERS_MAIN, records: [], mode: "available", open: listing("?list_status=rejected") },
	{ name: "empty-all", target: NEWSLETTERS_MAIN, records: [], mode: "available", open: listing("?list_status=all") },
	{ name: "populated-pending", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: listing("") },
	{ name: "populated-approved", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: listing("?list_status=approved") },
	{ name: "populated-rejected", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: listing("?list_status=rejected") },
	{ name: "all", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: listing("?list_status=all") },
	{
		name: "search",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "available",
		open: async (page) => {
			await openList(page, "?list_status=all");
			await page.locator("#admin-newsletters-q").fill("field");
			await submitAndExpect(page, page.locator('form[role="search"] button[type="submit"]'), `[data-test-admin-newsletter-row="${FIELD_NOTES}"]`);
			await expect(page.locator("[data-test-admin-newsletter-row]")).toHaveCount(3);
		},
	},
	{
		name: "pagination-page-2",
		target: NEWSLETTERS_MAIN,
		records: BULK_PENDING,
		mode: "available",
		open: async (page) => {
			await openList(page, "");
			await submitAndExpect(page, page.locator('[data-test-admin-newsletters-page="next"]'), '[data-test-pagination-page="2"]');
		},
	},
	{ name: "create", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: openCreateForm },
	{ name: "edit", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: openEditForm },
	{
		name: "validation",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "available",
		open: async (page) => {
			await openCreateForm(page);
			await formField(page, { kind: "create", name: "from" }).fill("newsletter@localhost");
			await formField(page, { kind: "create", name: "evidence_url" }).fill("javascript:alert(1)");
			await submitAndExpect(page, formSubmit(page, "create"), '[data-test-error="from"]');
			await expect(page.locator('[data-test-error="evidence_url"]')).toBeVisible();
		},
	},
	{
		name: "duplicate",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "available",
		open: async (page) => {
			await openCreateForm(page);
			await formField(page, { kind: "create", name: "from" }).fill(MORNING_ESSAY);
			await formField(page, { kind: "create", name: "name" }).fill("The Morning Essay");
			await formField(page, { kind: "create", name: "evidence_note" }).fill("Seen in a forwarded issue.");
			await submitAndExpect(page, formSubmit(page, "create"), '[data-test-error="from"]');
		},
	},
	{ name: "approve", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: review({ query: "", from: QUIET_DISPATCH, action: "approve" }) },
	{ name: "reject", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: review({ query: "", from: FIELD_NOTES, action: "reject" }) },
	{
		name: "withdraw",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "available",
		open: review({ query: "?list_status=approved", from: MORNING_ESSAY, action: "withdraw" }),
	},
	{
		name: "reconsider",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "available",
		open: review({ query: "?list_status=rejected", from: SHOP_DEALS, action: "reconsider" }),
	},
	{ name: "correct-from", target: NEWSLETTERS_MAIN, records: CATALOG, mode: "available", open: openCorrectForm },
	{
		name: "corrected",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "available",
		open: async (page) => {
			await openCorrectForm(page);
			await formField(page, { kind: "correct", name: "new_from" }).fill(FIELD_NOTES_CORRECTED);
			await submitAndExpect(page, formSubmit(page, "correct"), NOTICE);
			await expect(page.locator(`[data-test-admin-newsletter-row="${FIELD_NOTES_CORRECTED}"]`)).toBeVisible();
		},
	},
	{
		name: "seed-imported",
		target: NEWSLETTERS_MAIN,
		records: [],
		mode: "available",
		open: async (page) => {
			await openList(page, "");
			await submitAndExpect(page, page.locator("[data-test-admin-newsletters-seed] button"), NOTICE);
			await expect(page.locator("[data-test-admin-newsletter-row]").first()).toBeVisible();
		},
	},
	{
		name: "conflict",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "available",
		open: async (page, namespace) => {
			await openEditForm(page);
			await formField(page, { kind: "edit", name: "name" }).fill("The Quiet Dispatch Weekly");
			await formField(page, { kind: "edit", name: "evidence_note" }).fill("The publisher renamed the newsletter.");
			await seedCatalog(page, {
				namespace,
				mode: "available",
				records: CATALOG.map((record) =>
					record.from === QUIET_DISPATCH
						? {
								...record,
								name: "Quiet Dispatch",
								status: "approved",
								updatedAt: "2025-03-08T10:05:00.000Z",
								reviewedAt: "2025-03-08T10:05:00.000Z",
							}
						: record,
				),
			});
			await submitAndExpect(page, formSubmit(page, "edit"), "[data-test-admin-newsletter-conflict]");
			await expect(page.locator(CONFLICT)).toBeVisible();
			await expect(formField(page, { kind: "edit", name: "name" })).toHaveValue("The Quiet Dispatch Weekly");
			await expect(formField(page, { kind: "edit", name: "updated_at" })).toHaveValue("2025-03-08T10:05:00.000Z");
		},
	},
	{
		name: "storage-failure-read",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "unavailable",
		open: async (page) => {
			await openList(page, "");
			await expect(page.locator(STORAGE)).toBeVisible();
		},
	},
	{
		name: "storage-failure-write",
		target: NEWSLETTERS_MAIN,
		records: CATALOG,
		mode: "fail-next-write",
		open: async (page) => {
			await openCreateForm(page);
			await formField(page, { kind: "create", name: "from" }).fill("letters@newdesk.example.com");
			await formField(page, { kind: "create", name: "name" }).fill("The New Desk");
			await formField(page, { kind: "create", name: "evidence_note" }).fill("Seen in a forwarded issue.");
			await submitAndExpect(page, formSubmit(page, "create"), STORAGE);
			await expect(formField(page, { kind: "create", name: "from" })).toHaveValue("letters@newdesk.example.com");
		},
	},
];

async function suppressVolatileUi(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await page.evaluate(suppressVolatileAdminUi, {
		volatile: VOLATILE_CHROME,
		seededYear: SEEDED_YEAR_PREFIX,
		freshLabel: FRESH_TIME_LABEL,
	});
}

async function staysWithinTheViewport(page: Page, target: string): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, `"${target}" must never make the page scroll sideways`);
	const box = await measuredBox(page, target);
	const viewport = page.viewportSize();
	assert.ok(viewport, "the capture runs at a fixed viewport");
	assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 0.5, `"${target}" must sit inside the viewport horizontally`);
	const badgeLineCounts = await page.evaluate(statusBadgeLineCounts, STATUS_BADGES);
	assert.ok(
		badgeLineCounts.every((lines) => lines === 1),
		`every status badge must keep its label on one line, measured ${JSON.stringify(badgeLineCounts)}`,
	);
}

function checkpoint(input: { surface: string; target: string; variant: Variant }): VisualCheckpoint {
	return {
		name: `${input.surface}-${input.variant.width}-${input.variant.theme}`,
		settled: suppressVolatileUi,
		geometry: (page) => staysWithinTheViewport(page, input.target),
		target: input.target,
		capture: "element",
		pinnedText: [],
	};
}

async function useVariant(page: Page, variant: Variant): Promise<void> {
	await page.setViewportSize(variant.viewport);
	await page.emulateMedia({ colorScheme: variant.theme });
}

test.describe("Admin newsletters visual", () => {
	test.use({ timezoneId: "UTC" });

	test("admin index lists every admin tool", async ({ page }) => {
		await signIn(page, { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD });
		for (const variant of VARIANTS) {
			await useVariant(page, variant);
			await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("body.page-admin")).toHaveCount(1);
			await expect(page.locator('[data-test-admin-link="newsletters"]')).toBeVisible();
			await fitViewportToPage(page, variant.viewport);
			await captureCheckpoint(page, checkpoint({ surface: "admin-index", target: INDEX_MAIN, variant }));
		}
	});

	for (const scenario of SCENARIOS) {
		test(`admin newsletters ${scenario.name}`, async ({ page, context }, testInfo) => {
			const namespace = `admin-visual-${scenario.name}-${testInfo.repeatEachIndex}-${testInfo.retry}`;
			await context.addCookies([{ name: CATALOG_NAMESPACE_COOKIE, value: namespace, url: BASE_URL }]);
			await signIn(page, { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD });
			for (const variant of VARIANTS) {
				await useVariant(page, variant);
				await seedCatalog(page, { namespace, records: scenario.records, mode: scenario.mode });
				await scenario.open(page, namespace);
				await fitViewportToPage(page, variant.viewport);
				await captureCheckpoint(
					page,
					checkpoint({ surface: `admin-newsletters-${scenario.name}`, target: scenario.target, variant }),
				);
			}
		});
	}

	test("a signed-in reader who is not an admin is refused", async ({ page }, testInfo) => {
		await signIn(page, {
			email: `admin-newsletters-visual-reader-${testInfo.repeatEachIndex}-${testInfo.retry}@example.com`,
			password: READER_PASSWORD,
		});
		for (const variant of VARIANTS) {
			await useVariant(page, variant);
			const response = await page.goto(`${BASE_URL}/admin/newsletters`, { waitUntil: "domcontentloaded" });
			assert.ok(response, "the admin page must answer");
			assert.equal(response.status(), 403, "a reader who is not an admin must be refused");
			await expect(page.locator("body.page-admin-forbidden")).toHaveCount(1);
			await fitViewportToPage(page, variant.viewport);
			await captureCheckpoint(page, checkpoint({ surface: "admin-newsletters-forbidden", target: FORBIDDEN_MAIN, variant }));
		}
	});
});
