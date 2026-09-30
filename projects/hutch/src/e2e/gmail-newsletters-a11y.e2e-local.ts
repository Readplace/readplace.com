import assert from "node:assert/strict";
import { expect, pinCdnFixtures, test } from "@packages/e2e-harness";
import { GMAIL_READONLY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { requireEnv } from "@packages/require-env";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { z } from "zod";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./admin-extend-trial/admin-e2e-user";
import { pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const GMAIL_PAGE = `${BASE_URL}/integrations/gmail`;
const ADMIN_NEWSLETTERS = `${BASE_URL}/admin/newsletters`;
const PASSWORD = "password123";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_TIMESTAMP = "2026-09-01T00:00:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MAX_TAB_PRESSES = 80;
const TLDR = "dan@tldr.tech";
const BREW = "crew@morningbrew.com";
const KALE = "kale@hackernewsletter.com";
const LONG_SENDER = "the-extraordinarily-long-weekly-digest@newsletters.an-exceptionally-long-publisher-domain.example";
const LONG_NAME = "The Extraordinarily Long Weekly Engineering Digest From A Very Wordy Publisher";
const LONG_READLIST = "Longform Engineering Rd";
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const READLIST_PICKER = "[data-test-gmail-readlist-picker]";
const SENDER_OPTION = "[data-test-gmail-sender-option]";
const MAPPING_ROWS = "[data-test-gmail-mapping-row]";
const GOOGLE_CONSENT_STAND_IN = '<!doctype html><title>Google consent</title><body class="google-consent"></body>';
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

type CatalogStatus = "pending" | "approved" | "rejected";

interface CatalogRecord {
	from: string;
	name?: string;
	status: CatalogStatus;
	evidence?: { kind: "seed" | "user-submission" | "admin"; url?: string; note?: string; addedAt: string }[];
	replacedBy?: string;
}

interface GmailSeed {
	connection?: "setup" | "awaiting-confirmation" | "confirm-failed" | "connected" | "revoked" | "disconnecting";
	grantedScopes?: ("settings" | "metadata" | "readonly")[];
	discoveredSenders?: { email: string; name?: string }[];
	discoveryState?: "idle" | "running" | "complete" | "failed";
	discoveryRequiresReconnect?: boolean;
	discoveryCheckedMessages?: number;
	filter?: "none" | "live" | "updating" | "failed-too-long" | "failed-rejected";
	readlists?: string[];
	mappings?: (
		| { destination: "readlist" | "disabled"; email: string; readlist: string; pending?: boolean }
		| { destination: "legacy-inbox"; email: string; readlist: string; inboxName: string }
		| { destination: "missing"; email: string }
	)[];
	imports?: {
		sender: string;
		state: "awaiting-permission" | "queued" | "running" | "complete" | "failed" | "cancelled";
		counts?: Partial<Record<"listed" | "imported" | "alreadyImported" | "skippedNoMessageId" | "skippedSenderMismatch" | "failed" | "cancelled", number>>;
		failureReason?: "gmail-rejected" | "permission-revoked" | "dead-lettered";
		cancelReason?: "user-cancelled" | "mapping-removed" | "destination-changed" | "disconnected" | "account-changed";
	}[];
}

function uniqueStamp(label: string, workerIndex: number): string {
	return `${label}-${workerIndex}-${Date.now()}`;
}

async function useCatalog(
	context: BrowserContext,
	input: { namespace: string; records: readonly CatalogRecord[]; mode?: "available" | "unavailable" },
): Promise<void> {
	await context.addCookies([{ name: CATALOG_COOKIE, value: input.namespace, url: BASE_URL }]);
	const seeded = await context.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace: input.namespace,
			mode: input.mode ?? "available",
			records: input.records.map((record) => ({
				evidence: [],
				createdAt: CATALOG_TIMESTAMP,
				updatedAt: CATALOG_TIMESTAMP,
				...record,
			})),
		},
	});
	assert.equal(seeded.status(), 201, "the newsletter catalog namespace must be seeded");
}

function approved(from: string, name: string): CatalogRecord {
	return { from, name, status: "approved" };
}

async function createReader(context: BrowserContext, email: string): Promise<string> {
	const created = await context.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must create the reader");
	return CreatedUser.parse(await created.json()).userId;
}

async function signIn(page: Page, input: { email: string; password: string }): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(input.email);
	await page.locator('input[name="password"]').fill(input.password);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await expect(page.locator("body.page-readlist")).toHaveCount(1);
}

async function signInGmailReader(page: Page, input: { stamp: string; catalog: readonly CatalogRecord[]; catalogMode?: "available" | "unavailable"; seed: GmailSeed }): Promise<void> {
	await useCatalog(page.context(), { namespace: `a11y-${input.stamp}`, records: input.catalog, mode: input.catalogMode });
	const email = `gmail-a11y-${input.stamp}@example.com`;
	const userId = await createReader(page.context(), email);
	const seeded = await page.context().request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: { userId, ...input.seed },
	});
	assert.equal(seeded.status(), 201, `the gmail state must be seeded: ${await seeded.text()}`);
	await signIn(page, { email, password: PASSWORD });
}

async function openGmailPage(page: Page, query: Record<string, string>): Promise<void> {
	const url = new URL(GMAIL_PAGE);
	for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
	await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
	await expect(page.locator("body.page-integrations-gmail")).toHaveCount(1);
}

async function signInAdmin(page: Page): Promise<void> {
	const created = await page.context().request.post(`${BASE_URL}/e2e/users`, {
		data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
	});
	assert.equal(created.status(), 201, "the admin fixture must answer the create request");
	await signIn(page, { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD });
}

async function isFocused(locator: Locator): Promise<boolean> {
	return locator.evaluate((element) => element === document.activeElement);
}

async function tabTo(page: Page, locator: Locator): Promise<void> {
	await expect(locator).toHaveCount(1);
	for (let presses = 0; presses < MAX_TAB_PRESSES; presses += 1) {
		if (await isFocused(locator)) return;
		await page.keyboard.press("Tab");
	}
	assert.fail(`Tab never reached ${locator.toString()} within ${MAX_TAB_PRESSES} presses`);
}

async function withoutJavaScript(browser: Browser, run: (page: Page) => Promise<void>): Promise<void> {
	const context = await browser.newContext({ javaScriptEnabled: false, viewport: DESKTOP, timezoneId: "UTC" });
	try {
		await pinCdnFixtures(context);
		await run(await context.newPage());
	} finally {
		await context.close();
	}
}

function mappingRow(page: Page, sender: string): Locator {
	return page.locator(`[data-test-gmail-mapping-row="${sender}"]`);
}

test.describe("GMail Newsletters with the keyboard alone", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("chooses a newsletter, picks and creates readlists, saves and removes the mapping without a pointer", async ({ page }, testInfo) => {
		await signInGmailReader(page, {
			stamp: uniqueStamp("keyboard", testInfo.workerIndex),
			catalog: [approved(TLDR, "TLDR"), approved(BREW, "Morning Brew")],
			seed: {
				readlists: ["Tech"],
				discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW, name: "Morning Brew" }, { email: KALE }],
			},
		});
		await openGmailPage(page, { discovery: "started" });
		await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");

		const senderTrigger = page.locator(`${SENDER_PICKER} summary`);
		const search = page.locator("#gmail-sender-search");
		await tabTo(page, senderTrigger);
		await page.keyboard.press("Enter");
		await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
		await expect(search).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(page.locator(SENDER_PICKER)).not.toHaveAttribute("open");
		await expect(senderTrigger).toBeFocused();
		await page.keyboard.press("Space");
		await expect(search).toBeFocused();

		await page.keyboard.type("brew");
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await page.keyboard.press("ArrowDown");
		const brewOption = page.locator(`[data-test-gmail-sender-option="${BREW}"]`);
		await expect(brewOption).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(search).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");
		await expect(page.locator("#gmail-sender-choice")).toContainText(BREW);

		const readlistTrigger = page.locator(`${READLIST_PICKER} summary`);
		const readlistName = page.locator('[data-test-gmail-readlist-create] input[name="readlist_name"]');
		await tabTo(page, readlistTrigger);
		await page.keyboard.press("Space");
		await expect(page.locator(READLIST_PICKER)).toHaveAttribute("open", "");
		await expect(readlistName).toBeFocused();
		await page.keyboard.press("ArrowUp");
		const techOption = page.locator('[data-test-gmail-readlist-option]:not([data-test-gmail-readlist-option="default"])');
		await expect(techOption).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("Tech");

		await tabTo(page, page.locator(`${READLIST_PICKER} summary`));
		await page.keyboard.press("Enter");
		await expect(readlistName).toBeFocused();
		await page.keyboard.type("Science");
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-test-alert="readlist_created"]')).toBeVisible();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("Science");
		await expect(page.locator("#gmail-sender-choice")).toContainText(BREW);

		const importChoice = page.locator('[data-test-gmail-save-mapping] input[name="import"]');
		await tabTo(page, importChoice);
		await expect(importChoice).not.toBeChecked();
		await page.keyboard.press("Space");
		await expect(importChoice).toBeChecked();
		await page.keyboard.press("Space");
		await expect(importChoice).not.toBeChecked();
		await tabTo(page, page.locator("[data-test-gmail-save]"));
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-test-alert="sender_mapped"]')).toBeVisible();
		const destination = mappingRow(page, BREW).locator("[data-test-gmail-mapping-destination]");
		await expect(destination).toHaveAttribute("data-destination-kind", "readlist");
		await expect(destination).toContainText("Science");
		await expect(mappingRow(page, BREW).locator("[data-test-gmail-import-state]")).toHaveAttribute("data-test-gmail-import-state", "none");

		await tabTo(page, mappingRow(page, BREW).locator('[data-test-gmail-mapping-action="remove"]'));
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-test-alert="sender_removed"]')).toBeVisible();
		await expect(page.locator(MAPPING_ROWS)).toHaveCount(0);
		await expect(page.locator("[data-test-gmail-mappings-empty]")).toBeVisible();
	});
});

test.describe("GMail Newsletters without JavaScript", () => {
	test("searches, chooses, saves a mapping with its import and asks Google only for read access", async ({ browser }, testInfo) => {
		await withoutJavaScript(browser, async (page) => {
			const consentLocations: string[] = [];
			await page.route("**/integrations/gmail/connect?**", async (route) => {
				const connect = await route.fetch({ maxRedirects: 0 });
				consentLocations.push(connect.headers().location);
				await route.fulfill({ status: 200, contentType: "text/html", body: GOOGLE_CONSENT_STAND_IN });
			});
			await signInGmailReader(page, {
				stamp: uniqueStamp("nojs-gmail", testInfo.workerIndex),
				catalog: [approved(TLDR, "TLDR")],
				seed: {
					readlists: ["Tech"],
					discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: KALE, name: "Hacker Newsletter" }],
				},
			});
			await openGmailPage(page, {});
			await expect(page.locator(SENDER_OPTION)).toHaveCount(1);

			await page.locator(`${SENDER_PICKER} summary`).click();
			await page.locator("#gmail-sender-search").fill("kale");
			await page.locator('#gmail-sender-search-form button[type="submit"]').click();
			await expect(page.locator("#gmail-sender-search")).toHaveValue("kale");
			await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
			await page.locator(`${SENDER_PICKER} summary`).click();
			await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
			await expect(page.locator("#gmail-sender-choice")).toContainText(KALE);

			await page.locator(`${READLIST_PICKER} summary`).click();
			await page.locator('[data-test-gmail-readlist-option]:not([data-test-gmail-readlist-option="default"])').click();
			await expect(page.locator("#gmail-readlist-choice")).toHaveText("Tech");
			await page.locator('[data-test-gmail-save-mapping] input[name="import"]').check();
			await page.locator("[data-test-gmail-save]").click();

			await expect(page.locator('[data-test-alert="import_permission_needed"]')).toBeVisible();
			await expect(page.locator("#gmail-sender-search")).toHaveValue("kale");
			const row = mappingRow(page, KALE);
			await expect(row.locator("[data-test-gmail-mapping-destination]")).toContainText("Tech");
			await expect(row.locator("[data-test-gmail-import-state]")).toHaveAttribute("data-test-gmail-import-state", "awaiting-permission");
			await expect(row.locator("[data-test-gmail-import-consent]")).toBeVisible();

			await row.locator('[data-test-gmail-mapping-action="grant-import-permission"]').click();
			await expect(page.locator("body.google-consent")).toHaveCount(1);
			assert.equal(consentLocations.length, 1, "granting permission must send the reader to Google once");
			const consent = new URL(consentLocations[0]);
			assert.equal(`${consent.origin}${consent.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
			assert.equal(consent.searchParams.get("scope"), GMAIL_READONLY_SCOPE);
			assert.equal(consent.searchParams.get("include_granted_scopes"), "true");
			assert.equal(consent.searchParams.get("login_hint"), "reader@gmail.com");
		});
	});

	test("an admin adds a newsletter and approves it through ordinary forms", async ({ browser }, testInfo) => {
		await withoutJavaScript(browser, async (page) => {
			const from = `digest-${testInfo.workerIndex}-${Date.now()}@nojs-publisher.example`;
			await useCatalog(page.context(), { namespace: uniqueStamp("nojs-admin", testInfo.workerIndex), records: [] });
			await signInAdmin(page);
			await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("body.page-admin")).toHaveCount(1);
			await page.locator('[data-test-admin-link="newsletters"]').click();
			await expect(page.locator("body.page-admin-newsletters")).toHaveCount(1);
			await expect(page.locator('[data-test-admin-newsletters-empty="pending"]')).toHaveAttribute("data-empty", "true");

			await page.locator("[data-test-admin-newsletters-add] button").click();
			const form = page.locator('[data-test-admin-newsletter-form="create"]');
			await form.locator('input[name="from"]').fill(from);
			await form.locator('input[name="name"]').fill("No Script Weekly");
			await form.locator('input[name="evidence_url"]').fill("https://nojs-publisher.example/newsletter");
			await form.locator("[data-test-admin-newsletter-submit]").click();
			await expect(page.locator('[data-test-alert="newsletter-notice"]')).toBeVisible();
			const pendingRow = page.locator(`[data-test-admin-newsletter-row="${from}"]`);
			await expect(pendingRow).toHaveAttribute("data-status", "pending");

			await pendingRow.locator('[data-test-admin-newsletter-action="approve"]').click();
			await expect(page.locator('[data-test-alert="newsletter-notice"]')).toBeVisible();
			await expect(page.locator('[data-test-admin-newsletters-empty="pending"]')).toHaveAttribute("data-empty", "true");
			await page.locator('[data-test-admin-newsletters-tab="approved"]').click();
			await expect(page.locator('[data-test-admin-newsletters-tab="approved"]')).toHaveAttribute("aria-current", "page");
			await expect(page.locator(`[data-test-admin-newsletter-row="${from}"]`)).toHaveAttribute("data-status", "approved");
		});
	});
});

test.describe("GMail Newsletters polling keeps the reader's choices", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("discovery and import polls keep search, advanced mode, the newsletter and the readlist in the URL and the page", async ({ page }, testInfo) => {
		await signInGmailReader(page, {
			stamp: uniqueStamp("polling", testInfo.workerIndex),
			catalog: [approved(TLDR, "TLDR"), approved(BREW, "Morning Brew")],
			seed: {
				readlists: ["Tech"],
				discoveryState: "running",
				discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW, name: "Morning Brew" }, { email: KALE, name: "Hacker Newsletter" }],
				mappings: [{ destination: "readlist", email: TLDR, readlist: "Tech" }],
				imports: [{ sender: TLDR, state: "running", counts: { listed: 4, imported: 1 } }],
			},
		});
		await openGmailPage(page, { search: "news", advanced: "1", discovery: "started" });
		await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
		await expect(page.locator("[data-test-gmail-mappings]")).toHaveAttribute("data-imports-polling", "true");

		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(page.locator("#gmail-sender-choice")).toContainText(KALE);
		await page.locator(`${READLIST_PICKER} summary`).click();
		const techOption = page.locator('[data-test-gmail-readlist-option]:not([data-test-gmail-readlist-option="default"])');
		const techSlug = await techOption.getAttribute("data-test-gmail-readlist-option");
		assert(techSlug, "the Tech readlist option must name its slug");
		await techOption.click();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("Tech");
		const chosenUrl = page.url();

		const discoveryPolls: string[] = [];
		const importPolls: string[] = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			if (url.pathname === "/integrations/gmail/senders" && url.searchParams.has("poll")) discoveryPolls.push(request.url());
			if (url.pathname === "/integrations/gmail" && url.searchParams.has("imports_poll")) importPolls.push(request.url());
		});
		await expect.poll(() => discoveryPolls.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
		await expect.poll(() => importPolls.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
		await expect(page.locator("#gmail-sender-results")).toHaveAttribute("hx-get", /poll=[3-9]/);
		await expect(page.locator("[data-test-gmail-mappings]")).toHaveAttribute("hx-get", /imports_poll=[3-9]/);

		for (const polled of [...discoveryPolls, ...importPolls]) {
			const params = new URL(polled).searchParams;
			assert.equal(params.get("search"), "news", `${polled} must keep the search`);
			assert.equal(params.get("advanced"), "1", `${polled} must keep advanced mode`);
			assert.equal(params.get("sender"), KALE, `${polled} must keep the chosen newsletter`);
			assert.equal(params.get("readlist"), techSlug, `${polled} must keep the chosen readlist`);
		}
		assert.equal(page.url(), chosenUrl, "a poll must not rewrite the address bar");
		const address = new URL(page.url()).searchParams;
		assert.equal(address.get("search"), "news");
		assert.equal(address.get("advanced"), "1");
		assert.equal(address.get("sender"), KALE);
		assert.equal(address.get("readlist"), techSlug);
		await expect(page.locator("#gmail-sender-search")).toHaveValue("news");
		await expect(page.locator('#gmail-sender-search-form input[name="advanced"]')).toHaveValue("1");
		await expect(page.locator("#gmail-sender-choice")).toContainText(KALE);
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("Tech");
		const optionFields = page.locator(`[data-test-gmail-sender-option="${KALE}"]`).locator("xpath=ancestor::form[1]");
		await expect(optionFields.locator('input[name="readlist"]')).toHaveValue(techSlug);
		await expect(optionFields.locator('input[name="search"]')).toHaveValue("news");
		await expect(optionFields.locator('input[name="advanced"]')).toHaveValue("1");
		await expect(page.locator('[data-test-gmail-save-mapping] input[name="sender"]')).toHaveValue(KALE);
		await expect(page.locator('[data-test-gmail-save-mapping] input[name="readlist"]')).toHaveValue(techSlug);
		await expect(mappingRow(page, TLDR).locator("[data-test-gmail-import-state]")).toHaveAttribute("data-test-gmail-import-state", "running");

		await page.goBack();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("Choose a readlist");
		await expect(page.locator("#gmail-sender-choice")).toContainText(KALE);
		await expect(page.locator("#gmail-sender-search")).toHaveValue("news");
		await page.goForward();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("Tech");
		await expect(page.locator("#gmail-sender-choice")).toContainText(KALE);
		assert.equal(page.url(), chosenUrl, "going forward must return to the chosen newsletter and readlist");
	});
});

interface OverflowScenario {
	name: string;
	shows: string;
	open: (page: Page, stamp: string) => Promise<void>;
}

const MANY_APPROVED = Array.from({ length: 30 }, (_, index) => ({
	email: `weekly-${index}-${"digest".repeat(4)}@publisher-${index}.an-exceptionally-long-domain.example`,
	name: `${LONG_NAME.slice(0, 60)} ${index}`,
}));

const EVERY_ROW_STATE: GmailSeed = {
	filter: "failed-too-long",
	readlists: [LONG_READLIST],
	discoveredSenders: [{ email: LONG_SENDER, name: LONG_NAME }],
	mappings: [
		{ destination: "readlist", email: LONG_SENDER, readlist: LONG_READLIST },
		{ destination: "readlist", email: "queued@publisher-with-a-long-domain-name.example", readlist: LONG_READLIST },
		{ destination: "readlist", email: "running@publisher-with-a-long-domain-name.example", readlist: LONG_READLIST },
		{ destination: "readlist", email: "complete@publisher-with-a-long-domain-name.example", readlist: LONG_READLIST },
		{ destination: "readlist", email: "failed@publisher-with-a-long-domain-name.example", readlist: LONG_READLIST },
		{ destination: "readlist", email: "cancelled@publisher-with-a-long-domain-name.example", readlist: LONG_READLIST },
		{ destination: "legacy-inbox", email: "legacy@publisher-with-a-long-domain-name.example", readlist: LONG_READLIST, inboxName: "legacyinbox" },
		{ destination: "disabled", email: "disabled@publisher-with-a-long-domain-name.example", readlist: "Switched off" },
		{ destination: "missing", email: "missing@publisher-with-a-long-domain-name.example" },
		{ destination: "readlist", email: "pending@publisher-with-a-long-domain-name.example", readlist: "All", pending: true },
	],
	imports: [
		{ sender: LONG_SENDER, state: "awaiting-permission" },
		{ sender: "queued@publisher-with-a-long-domain-name.example", state: "queued" },
		{ sender: "running@publisher-with-a-long-domain-name.example", state: "running", counts: { listed: 1_234_567, imported: 234_567 } },
		{
			sender: "complete@publisher-with-a-long-domain-name.example",
			state: "complete",
			counts: { imported: 1_234_567, alreadyImported: 34_567, skippedNoMessageId: 4_567, skippedSenderMismatch: 567, failed: 67 },
		},
		{ sender: "failed@publisher-with-a-long-domain-name.example", state: "failed", failureReason: "permission-revoked", counts: { imported: 12, failed: 3 } },
		{ sender: "cancelled@publisher-with-a-long-domain-name.example", state: "cancelled", cancelReason: "user-cancelled", counts: { imported: 5, cancelled: 1_234 } },
	],
};

function gmailScenario(input: {
	name: string;
	seed: GmailSeed;
	query?: Record<string, string>;
	catalog?: readonly CatalogRecord[];
	catalogMode?: "available" | "unavailable";
	shows: string;
	prepare?: (page: Page) => Promise<void>;
}): OverflowScenario {
	return {
		name: input.name,
		shows: input.shows,
		open: async (page, stamp) => {
			await signInGmailReader(page, {
				stamp,
				catalog: input.catalog ?? [approved(LONG_SENDER, LONG_NAME), approved(TLDR, "TLDR")],
				catalogMode: input.catalogMode,
				seed: input.seed,
			});
			await openGmailPage(page, input.query ?? { discovery: "started" });
			await input.prepare?.(page);
		},
	};
}

async function openSenderPicker(page: Page): Promise<void> {
	await page.locator(`${SENDER_PICKER} summary`).click();
	await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
}

async function openReadlistPicker(page: Page): Promise<void> {
	const picker = page.locator(READLIST_PICKER);
	if ((await picker.getAttribute("open")) === null) await picker.locator("summary").click();
	await expect(picker).toHaveAttribute("open", "");
}

const GMAIL_OVERFLOW_SCENARIOS: readonly OverflowScenario[] = [
	gmailScenario({ name: "connection-setup", shows: "[data-test-gmail-step]", seed: { connection: "setup", filter: "none" } }),
	gmailScenario({ name: "connection-confirmation-waiting", shows: "[data-test-gmail-step]", seed: { connection: "awaiting-confirmation", filter: "none" } }),
	gmailScenario({ name: "connection-confirmation-failed", shows: '[data-test-alert="confirm_failed"]', seed: { connection: "confirm-failed", filter: "none" } }),
	gmailScenario({ name: "connection-revoked", shows: "[data-test-gmail-reconnect]", seed: { connection: "revoked" } }),
	gmailScenario({ name: "connection-missing-permission", shows: "[data-test-gmail-metadata-reconnect]", seed: { grantedScopes: ["settings"] } }),
	{
		name: "integrations-disconnecting",
		shows: '[data-test-integration="gmail"]',
		open: async (page, stamp) => {
			await signInGmailReader(page, { stamp, catalog: [], seed: { connection: "disconnecting" } });
			await page.goto(`${BASE_URL}/integrations`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("body.page-integrations")).toHaveCount(1);
		},
	},
	gmailScenario({ name: "discovery-idle", shows: "[data-test-gmail-discovery-status]", seed: { discoveryState: "idle" }, query: {}, prepare: openSenderPicker }),
	gmailScenario({
		name: "discovery-loading",
		shows: '[data-test-gmail-discovery-status][data-discovery-state="running"] [data-test-gmail-checked-count]',
		seed: { discoveryState: "running", discoveryCheckedMessages: 12_345_678, discoveredSenders: [{ email: LONG_SENDER, name: LONG_NAME }] },
		prepare: openSenderPicker,
	}),
	gmailScenario({ name: "discovery-failed", shows: '[data-test-gmail-discovery-status][data-discovery-state="failed"]', seed: { discoveryState: "failed" }, prepare: openSenderPicker }),
	gmailScenario({ name: "discovery-reconnect", shows: "[data-test-gmail-metadata-reconnect]", seed: { discoveryState: "failed", discoveryRequiresReconnect: true } }),
	gmailScenario({
		name: "picker-open-named-newsletters",
		shows: '[data-test-gmail-sender-results][data-results-state="listed"]',
		catalog: MANY_APPROVED.map((sender) => approved(sender.email, sender.name)),
		seed: { discoveredSenders: MANY_APPROVED },
		prepare: openSenderPicker,
	}),
	gmailScenario({ name: "picker-no-recognized", shows: '[data-test-gmail-sender-results][data-results-state="no-recognized-newsletters"]', catalog: [], seed: { discoveredSenders: [{ email: LONG_SENDER }] }, prepare: openSenderPicker }),
	gmailScenario({ name: "picker-no-discovered-senders", shows: '[data-test-gmail-sender-results][data-results-state="no-discovered-senders"]', seed: { discoveredSenders: [] }, prepare: openSenderPicker }),
	gmailScenario({
		name: "picker-no-matches",
		shows: '[data-test-gmail-sender-results][data-results-state="no-matches"]',
		seed: { discoveredSenders: [{ email: LONG_SENDER, name: LONG_NAME }] },
		query: { search: "an-address-nobody-sends-from-and-nobody-ever-will" },
		prepare: openSenderPicker,
	}),
	gmailScenario({
		name: "picker-advanced-result-limit",
		shows: "[data-test-gmail-refine-search]",
		seed: {
			discoveredSenders: Array.from({ length: 105 }, (_, index) => ({
				email: `sender-${index}@a-publisher-with-an-exceptionally-long-domain-name.example`,
			})),
		},
		query: { advanced: "1" },
		prepare: openSenderPicker,
	}),
	gmailScenario({
		name: "picker-catalog-unavailable",
		shows: "[data-test-gmail-browse-all]",
		catalogMode: "unavailable",
		seed: { discoveredSenders: [{ email: LONG_SENDER, name: LONG_NAME }] },
		prepare: openSenderPicker,
	}),
	gmailScenario({
		name: "mapping-destination-open",
		shows: "[data-test-gmail-readlist-create]",
		seed: { readlists: [LONG_READLIST], discoveredSenders: [{ email: LONG_SENDER, name: LONG_NAME }] },
		query: { sender: LONG_SENDER, readlist: "default" },
		prepare: openReadlistPicker,
	}),
	gmailScenario({
		name: "mapping-validation",
		shows: '[data-test-alert="readlist_name_invalid"]',
		seed: { readlists: [LONG_READLIST], discoveredSenders: [{ email: LONG_SENDER, name: LONG_NAME }] },
		query: { sender: LONG_SENDER, error: "readlist_name_invalid", readlist_name: "A".repeat(24) },
		prepare: openReadlistPicker,
	}),
	gmailScenario({
		name: "mapping-readlist-cap",
		shows: "[data-test-gmail-readlist-limit]",
		seed: {
			readlists: Array.from({ length: 7 }, (_, index) => `${LONG_READLIST.slice(0, 20)} ${index}`),
			discoveredSenders: [{ email: LONG_SENDER, name: LONG_NAME }],
		},
		query: { sender: LONG_SENDER, edit: "1" },
		prepare: openReadlistPicker,
	}),
	gmailScenario({ name: "mappings-every-row-state", shows: "[data-test-gmail-import-consent]", seed: EVERY_ROW_STATE, query: { error: "import_reconnect_required" } }),
	gmailScenario({
		name: "mappings-filter-rejected",
		shows: '[data-test-alert="import_permission_refused"]',
		seed: { filter: "failed-rejected", mappings: [{ destination: "readlist", email: LONG_SENDER, readlist: "All" }] },
		query: { notice: "import_permission_refused" },
	}),
];

async function adminCatalogPage(page: Page, input: { stamp: string; records: readonly CatalogRecord[]; mode?: "available" | "unavailable"; query: string }): Promise<void> {
	await useCatalog(page.context(), { namespace: `a11y-admin-${input.stamp}`, records: input.records, mode: input.mode });
	await signInAdmin(page);
	await page.goto(`${ADMIN_NEWSLETTERS}${input.query}`, { waitUntil: "domcontentloaded" });
	await expect(page.locator("body.page-admin-newsletters")).toHaveCount(1);
}

const LONG_EVIDENCE = [
	{
		kind: "admin" as const,
		url: `https://an-exceptionally-long-publisher-domain.example/newsletters/${"archive-".repeat(8)}issue-1`,
		note: `Seen in the From header of ${"a very long issue title ".repeat(6)}`,
		addedAt: CATALOG_TIMESTAMP,
	},
];

const ADMIN_RECORDS: readonly CatalogRecord[] = [
	...Array.from({ length: 55 }, (_, index) => ({
		from: `pending-${index}-${"digest".repeat(3)}@an-exceptionally-long-publisher-domain.example`,
		name: `${LONG_NAME.slice(0, 60)} ${index}`,
		status: "pending" as const,
		evidence: LONG_EVIDENCE,
	})),
	{ from: LONG_SENDER, name: LONG_NAME, status: "approved", evidence: LONG_EVIDENCE },
	{ from: "old-address@an-exceptionally-long-publisher-domain.example", name: LONG_NAME, status: "rejected", replacedBy: LONG_SENDER, evidence: LONG_EVIDENCE },
];

function adminScenario(input: { name: string; shows: string; query: string; records?: readonly CatalogRecord[]; mode?: "available" | "unavailable"; prepare?: (page: Page) => Promise<void> }): OverflowScenario {
	return {
		name: input.name,
		shows: input.shows,
		open: async (page, stamp) => {
			await adminCatalogPage(page, { stamp, records: input.records ?? ADMIN_RECORDS, mode: input.mode, query: input.query });
			await input.prepare?.(page);
		},
	};
}

const ADMIN_OVERFLOW_SCENARIOS: readonly OverflowScenario[] = [
	{
		name: "admin-index",
		shows: '[data-test-admin-link="newsletters"]',
		open: async (page) => {
			await signInAdmin(page);
			await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("body.page-admin")).toHaveCount(1);
		},
	},
	adminScenario({ name: "admin-empty-pending", shows: '[data-test-admin-newsletters-empty="pending"][data-empty="true"]', query: "", records: [] }),
	adminScenario({ name: "admin-populated-pending", shows: '[data-test-admin-newsletter-row][data-status="pending"]', query: "?list_status=pending" }),
	adminScenario({ name: "admin-pagination-page-2", shows: '[data-test-pagination-page="2"]', query: "?list_status=pending&page=2" }),
	adminScenario({ name: "admin-approved", shows: '[data-test-admin-newsletter-row][data-status="approved"]', query: "?list_status=approved" }),
	adminScenario({ name: "admin-rejected", shows: "[data-test-admin-newsletter-replaced-by]", query: "?list_status=rejected" }),
	adminScenario({ name: "admin-all-search", shows: "[data-test-admin-newsletter-row]", query: `?list_status=all&q=${encodeURIComponent("exceptionally-long")}` }),
	adminScenario({ name: "admin-create", shows: '[data-test-admin-newsletter-form="create"]', query: "?new=1" }),
	adminScenario({ name: "admin-edit", shows: '[data-test-admin-newsletter-form="edit"]', query: `?list_status=approved&edit=${encodeURIComponent(LONG_SENDER)}` }),
	adminScenario({ name: "admin-correct-from", shows: '[data-test-admin-newsletter-form="correct"]', query: `?list_status=approved&correct=${encodeURIComponent(LONG_SENDER)}` }),
	adminScenario({
		name: "admin-validation",
		shows: '[data-test-admin-newsletter-form="create"] [data-test-error]',
		query: "?new=1",
		prepare: async (page) => {
			const form = page.locator('[data-test-admin-newsletter-form="create"]');
			await form.locator('input[name="from"]').fill(`validation@${"a-very-long-label".repeat(3)}.example`);
			await form.locator("[data-test-admin-newsletter-submit]").click();
		},
	}),
	adminScenario({
		name: "admin-conflict",
		shows: "[data-test-admin-newsletter-conflict]",
		query: `?list_status=approved&edit=${encodeURIComponent(LONG_SENDER)}`,
		prepare: async (page) => {
			const form = page.locator('[data-test-admin-newsletter-form="edit"]');
			await form.locator('input[name="updated_at"]').evaluate((input: HTMLInputElement) => {
				input.value = "2026-01-01T00:00:00.000Z";
			});
			await form.locator("[data-test-admin-newsletter-submit]").click();
		},
	}),
	adminScenario({
		name: "admin-approved-notice",
		shows: '[data-test-alert="newsletter-notice"]',
		query: "?list_status=pending",
		prepare: async (page) => {
			await page.locator('[data-test-admin-newsletter-action="approve"]').first().click();
		},
	}),
	adminScenario({ name: "admin-storage-failure", shows: '[data-test-alert="newsletter-storage"]', query: "?list_status=pending", mode: "unavailable" }),
	{
		name: "admin-forbidden",
		shows: "body",
		open: async (page, stamp) => {
			const email = `not-an-admin-${stamp}@example.com`;
			await createReader(page.context(), email);
			await signIn(page, { email, password: PASSWORD });
			const response = await page.goto(ADMIN_NEWSLETTERS, { waitUntil: "domcontentloaded" });
			assert.equal(response?.status(), 403, "a reader who is not an admin must be refused");
		},
	},
];

test.describe("GMail Newsletters and admin pages never scroll sideways on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: MOBILE });

	for (const scenario of [...GMAIL_OVERFLOW_SCENARIOS, ...ADMIN_OVERFLOW_SCENARIOS]) {
		test(`${scenario.name} fits a ${MOBILE.width}px screen`, async ({ page }, testInfo) => {
			await scenario.open(page, uniqueStamp(scenario.name, testInfo.workerIndex));
			await expect(page.locator(scenario.shows).first()).toBeVisible();
			assert.equal(
				await page.evaluate(pageOverflowsSideways),
				false,
				`${scenario.name} must not scroll sideways at ${MOBILE.width}px`,
			);
		});
	}
});
