import assert from "node:assert/strict";
import { measuredBox, test, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { markSenderSearchTriggers, notificationControlStyles } from "./gmail-sender-picker.browser";
import { measureBoxes } from "./page-measurements.browser";
import { recordScrollAfterSwap } from "./readlist-scroll-stability.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TLDR = "dan@tldr.tech";
const BREW = "crew@morningbrew.com";
const KALE = "kale@hackernewsletter.com";
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const READLIST_PICKER = "[data-test-gmail-readlist-picker]";
const RESULTS = "[data-test-gmail-sender-results]";
const STATUS = "#gmail-sender-status";
const DISCOVERY_FENCE = `${STATUS} > input[form="gmail-sender-search-form"][name="discovery_after"]`;
const SELECT_ALL = '[data-test-gmail-checklist-action="select"]';
const REFRESH_CHECKLIST = "[data-test-gmail-refresh-checklist]";
const SELECTION_FORM = "#gmail-readlist-selection";
const SENDER_OPTION = "[data-test-gmail-sender-option]";
const CREATE_READLIST = "[data-test-gmail-readlist-create]";
const CUSTOM_READLIST_OPTION = '[data-test-gmail-readlist-option]:not([data-test-gmail-readlist-option="default"])';
const DIALOG = "#gmail-dialog";
const OPEN_DIALOG = "#gmail-dialog:popover-open";
const ADD_NEWSLETTERS = "[data-test-gmail-add-newsletters]";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_TIMESTAMP = "2026-09-01T00:00:00.000Z";

interface GmailSeed {
	approvedNewsletters?: { from: string; name: string }[];
	discoveredSenders?: { email: string; name?: string }[];
	mappings?: (
		| { destination: "readlist"; email: string; readlist: string }
		| { destination: "legacy-inbox"; email: string; readlist: string; inboxName: string }
	)[];
	readlists?: string[];
	discoveryState?: "running" | "complete";
	discoveryMode?: "profile" | "full" | "history";
	discoveryScannedMessages?: number;
	discoveryEstimatedTotalMessages?: number;
	completeDiscoveryOnStart?: boolean;
	discoveryStartHeld?: boolean;
	enhanced?: boolean;
	closed?: boolean;
}

async function seedApprovedNewsletters(
	page: Page,
	input: { namespace: string; newsletters: { from: string; name: string }[] },
): Promise<void> {
	await page.context().addCookies([{ name: CATALOG_COOKIE, value: input.namespace, url: BASE_URL }]);
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace: input.namespace,
			records: input.newsletters.map((newsletter) => ({
				from: newsletter.from,
				name: newsletter.name,
				status: "approved",
				evidence: [],
				createdAt: CATALOG_TIMESTAMP,
				updatedAt: CATALOG_TIMESTAMP,
			})),
		},
	});
	assert.equal(seeded.status(), 201);
}

async function openGmail(page: Page, stamp: string, seed: GmailSeed = {}): Promise<{ email: string }> {
	await seedApprovedNewsletters(page, {
		namespace: `gmail-picker-${stamp}`,
		newsletters: seed.approvedNewsletters ?? [
			{ from: TLDR, name: "TLDR" },
			{ from: BREW, name: "Morning Brew" },
		],
	});
	const email = `gmail-picker-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201);
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId,
			mappings: seed.mappings ?? [],
			readlists: seed.readlists ?? [],
			discoveredSenders: seed.discoveredSenders ?? [
				{ email: TLDR, name: "TLDR" },
				{ email: BREW, name: "Morning Brew" },
				{ email: KALE, name: "Hacker Newsletter" },
			],
			discoveryState: seed.discoveryState,
			discoveryMode: seed.discoveryMode,
			discoveryScannedMessages: seed.discoveryScannedMessages,
			discoveryEstimatedTotalMessages: seed.discoveryEstimatedTotalMessages,
			completeDiscoveryOnStart: seed.completeDiscoveryOnStart,
		},
	});
	assert.equal(seeded.status(), 201);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	if (seed.discoveryStartHeld === true) {
		await page.goto(`${BASE_URL}/newsletters/gmail?add=1`, { waitUntil: "domcontentloaded" });
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
		await expect(page.locator(SENDER_PICKER)).toBeVisible();
		return { email };
	}
	await page.goto(`${BASE_URL}/newsletters`, { waitUntil: "domcontentloaded" });
	await page.locator('[data-test-integration="gmail"] [data-test-integration-action="manage"]').click();
	await expect(page.locator(ADD_NEWSLETTERS)).toBeVisible();
	if (seed.enhanced !== false) {
		await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
		await expect(page.locator("html")).toHaveAttribute("data-gmail-dialog-attached", "");
		await expect(page.locator('#gmail-add-newsletters-form input[name="discovery_after"]')).toHaveCount(1);
	}
	if (seed.closed === true) return { email };
	await page.locator(ADD_NEWSLETTERS).click();
	await expect(page.locator(SENDER_PICKER)).toBeVisible();
	if (seed.enhanced !== false) {
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
		await expect(page.locator(DISCOVERY_FENCE)).toHaveCount(1);
	}
	return { email };
}

function tick(page: Page, sender: string) {
	return page.locator(`[data-test-gmail-checklist-sender="${sender}"]`);
}

function addedTick(page: Page, sender: string) {
	return page.locator(`[data-test-gmail-checklist-group="added"] [data-test-gmail-checklist-sender="${sender}"]`);
}

async function pickSender(page: Page, input: { email: string; search: string }): Promise<void> {
	await page.locator(`${SENDER_PICKER} summary`).click();
	await page.locator("#gmail-sender-search").fill(input.search);
	await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
	await page.locator(`[data-test-gmail-sender-option="${input.email}"]`).click();
	await expect(tick(page, input.email)).toBeChecked();
}

function digestNewsletters(count: number): { email: string; name: string }[] {
	return Array.from({ length: count }, (_, index) => ({
		email: `digest-${index}@publisher-${index}.com`,
		name: `Digest ${String(index).padStart(2, "0")}`,
	}));
}

async function scrollAfterSwap(page: Page): Promise<number> {
	await expect(page.locator("html")).toHaveAttribute("data-test-scroll-after-swap", /^\d/);
	return Number(await page.locator("html").getAttribute("data-test-scroll-after-swap"));
}

async function openReadlistPicker(page: Page): Promise<void> {
	const picker = page.locator(READLIST_PICKER);
	if ((await picker.getAttribute("open")) === null) await picker.locator("summary").click();
	await expect(picker).toHaveAttribute("open", "");
}

async function saveMapping(page: Page, sender: string): Promise<void> {
	await expect(page.locator("[data-test-gmail-save]")).toBeEnabled();
	await page.locator("[data-test-gmail-save]").click();
	await expect(page.locator(`[data-test-gmail-mapping-row="${sender}"]`)).toBeVisible();
}

function mappingRow(page: Page, sender: string) {
	return page.locator(`[data-test-gmail-mapping-row="${sender}"]`);
}

test.describe("Gmail sender picker", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	for (const presentation of [
		{ label: "desktop-light", width: 1280, height: 900, scheme: "light" as const },
		{ label: "desktop-dark", width: 1280, height: 900, scheme: "dark" as const },
		{ label: "mobile-light", width: 375, height: 812, scheme: "light" as const },
		{ label: "mobile-dark", width: 375, height: 812, scheme: "dark" as const },
	]) {
		test(`dismisses notification borders at disabled Save and saves by keyboard in ${presentation.label}`, async ({ page }, testInfo) => {
			await page.setViewportSize({ width: presentation.width, height: presentation.height });
			await page.emulateMedia({ colorScheme: presentation.scheme });
			await openGmail(page, `notification-${presentation.label}-${testInfo.workerIndex}-${Date.now()}`, { readlists: ["Tech"] });
			await page.goto(`${BASE_URL}/newsletters/gmail?sender=${encodeURIComponent(TLDR)}&notification=1&discovery=started`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
			await waitForBrandFonts(page, ["Inter"]);
			await expect(page.locator("#gmail-readlist-choice")).toHaveText("All");
			const save = page.locator("[data-test-gmail-save]");
			await expect(save).toBeDisabled();
			await expect(page.locator("[data-gmail-notification-highlight]")).toHaveCount(1);
			await save.scrollIntoViewIfNeeded();
			const before = await page.evaluate(notificationControlStyles);
			assert.equal(before.controls.length, 2);
			for (const control of before.controls) {
				assert.equal(control.border, before.brand);
				assert.ok(control.shadow.includes(before.brand));
				assert.ok(control.x >= 0 && control.x + control.width <= presentation.width);
			}
			const saveBox = await measuredBox(page, "[data-test-gmail-save]");
			await page.mouse.click(saveBox.x + saveBox.width / 2, saveBox.y + saveBox.height / 2);
			await expect(page.locator("[data-gmail-notification-highlight]")).toHaveCount(0);
			const after = await page.evaluate(notificationControlStyles);
			assert.deepEqual(after.controls.map(({ x, y, width, height }) => ({ x, y, width, height })), before.controls.map(({ x, y, width, height }) => ({ x, y, width, height })));
			await page.locator(`${READLIST_PICKER} summary`).focus();
			await page.keyboard.press("Enter");
			await expect(page.locator(READLIST_PICKER)).toHaveAttribute("open", "");
			await expect(page.locator("#gmail-readlist-name")).toBeFocused();
			await page.keyboard.press("ArrowUp");
			await page.keyboard.press("ArrowUp");
			await expect(page.locator(CUSTOM_READLIST_OPTION)).toBeFocused();
			await expect(page.locator('[data-test-gmail-readlist-option="default"]')).toBeDisabled();
			await page.keyboard.press("Space");
			await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, Tech");
			await expect(page.locator("[data-gmail-notification-highlight]")).toHaveCount(0);
			await expect(save).toBeEnabled();
			await save.focus();
			await page.keyboard.press("Enter");
			await expect(mappingRow(page, TLDR)).toBeVisible();
		});
	}

	test("maps a searched sender, moves a legacy inbox mapping to All, then removes every mapping", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `mapping-${testInfo.workerIndex}-${Date.now()}`, {
			readlists: ["Tech"],
			mappings: [{ destination: "legacy-inbox", email: BREW, readlist: "Tech", inboxName: "morningbrew" }],
		});
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(mappingRow(page, BREW).locator("[data-test-gmail-mapping-destination]")).toHaveAttribute(
			"data-destination-kind",
			"readlist",
		);

		await expect(page.locator("#gmail-sender-search")).toBeFocused();
		await expect(page.locator(RESULTS)).toHaveAttribute("data-results-state", "listed");
		await expect(page.locator(SENDER_OPTION)).toHaveCount(2);
		await expect(page.locator(`[data-test-gmail-sender-option="${BREW}"]`)).toHaveCount(0);
		await page.locator("#gmail-sender-search").fill("kale@");
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(addedTick(page, KALE)).toBeChecked();

		await openReadlistPicker(page);
		await expect(page.locator("[data-test-gmail-readlist-option]")).toHaveCount(2);
		await page.locator(CUSTOM_READLIST_OPTION).click();
		await saveMapping(page, KALE);
		const kale = mappingRow(page, KALE).locator("[data-test-gmail-mapping-destination]");
		await expect(kale).toHaveAttribute("data-destination-kind", "readlist");
		await expect(kale).toContainText("Tech");

		await mappingRow(page, BREW).locator('[data-test-gmail-mapping-action="edit"]').click();
		await expect(page.locator(OPEN_DIALOG)).toHaveAttribute("data-test-confirm-popover", "gmail-edit");
		await expect(page.locator(READLIST_PICKER)).toHaveJSProperty("open", false);
		await openReadlistPicker(page);
		await page.locator(CUSTOM_READLIST_OPTION).uncheck();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All");
		await page.locator("[data-test-gmail-save]").click();
		await expect(page.locator('[data-test-alert="sender_remapped"]')).toBeVisible();
		await expect(mappingRow(page, BREW).locator("[data-test-gmail-mapping-destination]")).toContainText("All");

		const rows = page.locator("[data-test-gmail-mapping-row]");
		await expect(rows).toHaveCount(2);
		await mappingRow(page, KALE).locator('[data-test-gmail-mapping-action="remove"]').click();
		await expect(rows).toHaveCount(1);
		await mappingRow(page, BREW).locator('[data-test-gmail-mapping-action="remove"]').click();
		await expect(rows).toHaveCount(0);
		await expect(page.locator("[data-test-gmail-mappings-empty]")).toBeVisible();
	});

	test("restores Load senders when an automatic discovery completes before its redirect settles", async ({
		page,
	}, testInfo) => {
		let releaseDiscovery: (() => void) | undefined;
		const discoveryHeld = new Promise<void>((resolve) => {
			releaseDiscovery = resolve;
		});
		await page.route("**/newsletters/gmail/discovery/start**", async (route) => {
			await discoveryHeld;
			await route.continue();
		});
		const discoveryResponse = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				response.url().includes("/newsletters/gmail/discovery/start"),
		);
		await openGmail(page, `completed-${testInfo.workerIndex}-${Date.now()}`, {
			discoveryState: "running",
			discoveryMode: "full",
			discoveryScannedMessages: 4,
			discoveryEstimatedTotalMessages: 12,
			completeDiscoveryOnStart: true,
			discoveryStartHeld: true,
		});
		await expect(page.locator("#gmail-load-senders-button")).toHaveText("Checking…");
		await expect(page.locator(STATUS)).toHaveAttribute("hx-get", /poll=1/);
		assert(releaseDiscovery);
		releaseDiscovery();
		await discoveryResponse;
		await expect(page.locator("#gmail-load-senders-button")).toHaveText("Load senders");
		await expect(page.locator(STATUS)).not.toHaveAttribute("hx-get");
	});

	test("keeps a search typed during the automatic discovery start when the start lands first", async ({
		page,
	}, testInfo) => {
		let releaseDiscovery: (() => void) | undefined;
		const discoveryHeld = new Promise<void>((resolve) => {
			releaseDiscovery = resolve;
		});
		let releaseSenders: (() => void) | undefined;
		const sendersHeld = new Promise<void>((resolve) => {
			releaseSenders = resolve;
		});
		await page.route("**/newsletters/gmail/discovery/start**", async (route) => {
			await discoveryHeld;
			await route.continue();
		});
		await page.route(
			(url) => url.pathname === "/newsletters/gmail/senders",
			async (route) => {
				await sendersHeld;
				await route.continue();
			},
		);
		await page.addInitScript(markSenderSearchTriggers);
		await openGmail(page, `search-race-${testInfo.workerIndex}-${Date.now()}`, { discoveryStartHeld: true });
		await expect(page.locator("[data-test-gmail-load-senders]")).toHaveClass(/htmx-request/);

		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("hacker");
		await expect(page.locator("#gmail-sender-search-form")).toHaveAttribute("data-test-gmail-search-triggered", "");
		assert(releaseDiscovery);
		releaseDiscovery();
		await expect(page.locator(DISCOVERY_FENCE)).toHaveCount(1);
		assert(releaseSenders);
		releaseSenders();

		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await expect(page.locator(`[data-test-gmail-sender-option="${KALE}"]`)).toBeVisible();
	});

	test("ticks a sender picked from the search while the automatic discovery start is in flight", async ({
		page,
	}, testInfo) => {
		let releaseDiscovery: (() => void) | undefined;
		const discoveryHeld = new Promise<void>((resolve) => {
			releaseDiscovery = resolve;
		});
		await page.route("**/newsletters/gmail/discovery/start**", async (route) => {
			await discoveryHeld;
			await route.continue();
		});
		const discoveryResponse = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				response.url().includes("/newsletters/gmail/discovery/start"),
		);
		await openGmail(page, `polling-choice-${testInfo.workerIndex}-${Date.now()}`, {
			discoveryState: "running",
			discoveryMode: "full",
			discoveryScannedMessages: 4,
			discoveryEstimatedTotalMessages: 12,
			discoveryStartHeld: true,
		});
		await expect(page.locator("[data-test-gmail-load-senders]")).toHaveClass(/htmx-request/);
		await expect(page.locator(STATUS)).toHaveAttribute("hx-get", /poll=1/);

		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator(`[data-test-gmail-sender-option="${TLDR}"]`).click();
		await expect(tick(page, TLDR)).toBeChecked();

		assert(releaseDiscovery);
		releaseDiscovery();
		await discoveryResponse;
		await expect(tick(page, TLDR)).toBeChecked();
	});

	test("keeps an invalid readlist name in the reopened picker, then reuses and creates readlists before saving", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `create-${testInfo.workerIndex}-${Date.now()}`, { readlists: ["Tech"] });
		await tick(page, TLDR).check();
		await openReadlistPicker(page);

		const form = page.locator(CREATE_READLIST);
		const input = form.locator('input[name="readlist_name"]');
		const submit = form.locator('button[type="submit"]');
		await expect(input).toHaveAttribute("required", "");
		await expect(input).toHaveAttribute("maxlength", "24");
		const fieldBox = await measuredBox(page, `${CREATE_READLIST} input[name="readlist_name"]`);
		const submitBox = await measuredBox(page, `${CREATE_READLIST} button[type="submit"]`);
		assert.ok(submitBox.x >= fieldBox.x + fieldBox.width, "the plus button must follow the name input");
		assert.equal(Math.round(submitBox.height), Math.round(fieldBox.height));

		await input.fill("   ");
		await submit.click();
		await expect(page.locator('[data-test-alert="readlist_name_invalid"]')).toBeVisible();
		await expect(page.locator(READLIST_PICKER)).toHaveAttribute("open", "");
		await expect(tick(page, TLDR)).toBeChecked();

		await openReadlistPicker(page);
		await page.locator(`${CREATE_READLIST} input[name="readlist_name"]`).fill("Tech");
		await page.locator(`${CREATE_READLIST} button[type="submit"]`).click();
		await expect(page.locator('[data-test-alert="readlist_reused"]')).toBeVisible();
		await expect(page.locator(CUSTOM_READLIST_OPTION)).toHaveCount(1);

		await openReadlistPicker(page);
		await page.locator(`${CREATE_READLIST} input[name="readlist_name"]`).fill("Science");
		await page.locator(`${CREATE_READLIST} button[type="submit"]`).click();
		await expect(page.locator('[data-test-alert="readlist_created"]')).toBeVisible();
		await expect(page.locator(CUSTOM_READLIST_OPTION)).toHaveCount(2);
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, Tech, Science");

		await saveMapping(page, TLDR);
		await expect(mappingRow(page, TLDR).locator("[data-test-gmail-mapping-destination]")).toContainText("Science");
	});

	test("omits inline creation at the readlist cap while keeping existing readlists selectable", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `cap-${testInfo.workerIndex}-${Date.now()}`, {
			readlists: Array.from({ length: 7 }, (_, index) => `Shelf ${index}`),
		});
		await pickSender(page, { email: KALE, search: "kale@" });
		await openReadlistPicker(page);
		await expect(page.locator("[data-test-gmail-readlist-limit]")).toBeVisible();
		await expect(page.locator(CUSTOM_READLIST_OPTION)).toHaveCount(7);
		await expect(page.locator(CREATE_READLIST)).toHaveCount(0);
		const shelf = page.locator(CUSTOM_READLIST_OPTION).first();
		const shelfName = await shelf.locator("..").locator("span").first().textContent();
		assert.ok(shelfName, "a readlist option must name its readlist");
		await shelf.click();
		await saveMapping(page, KALE);
		await expect(mappingRow(page, KALE).locator("[data-test-gmail-mapping-destination]")).toContainText(shelfName);
	});

	test("keeps two ticked newsletters while a searched sender joins them, then saves all three", async ({ page }, testInfo) => {
		await openGmail(page, `bulk-${testInfo.workerIndex}-${Date.now()}`);
		await tick(page, TLDR).check();
		await tick(page, BREW).check();
		await pickSender(page, { email: KALE, search: "kale@" });
		await expect(tick(page, TLDR)).toBeChecked();
		await expect(tick(page, BREW)).toBeChecked();
		await expect(addedTick(page, KALE)).toBeChecked();
		await saveMapping(page, KALE);
		await expect(page.locator('[data-test-alert="senders_saved"]')).toBeVisible();
		await expect(page.locator("[data-test-gmail-mapping-row]")).toHaveCount(3);
		await expect(mappingRow(page, TLDR)).toBeVisible();
		await expect(mappingRow(page, BREW)).toBeVisible();
	});

	for (const viewport of [
		{ label: "desktop", width: 1280, height: 900 },
		{ label: "mobile", width: 375, height: 812 },
	]) {
		test(`removes checked and unchecked draft senders while preserving the other choices on ${viewport.label}`, async ({ page }, testInfo) => {
			const other = "news@letters.example";
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await openGmail(page, `dismiss-${viewport.label}-${testInfo.workerIndex}-${Date.now()}`, {
				readlists: ["Tech"],
				discoveredSenders: [
					{ email: TLDR, name: "TLDR" },
					{ email: BREW, name: "Morning Brew" },
					{ email: KALE, name: "Hacker Newsletter" },
					{ email: other, name: "Other Newsletter" },
				],
			});
			await tick(page, TLDR).check();
			await pickSender(page, { email: KALE, search: "kale@" });
			await pickSender(page, { email: other, search: "news@letters" });
			await openReadlistPicker(page);
			await page.locator(CUSTOM_READLIST_OPTION).check();
			await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, Tech");
			await page.locator('input[type="checkbox"][name="import"]').check();

			const remove = page.locator(`[data-test-gmail-checklist-remove="${KALE}"]`);
			let releaseRemoval: (() => void) | undefined;
			const removalHeld = new Promise<void>((resolve) => {
				releaseRemoval = resolve;
			});
			await page.route((url) => url.searchParams.has("dismiss"), async (route) => {
				assert.equal(route.request().method(), "GET");
				await removalHeld;
				await route.continue();
			});
			try {
				await remove.click();
				await expect(remove).toBeDisabled();
				await expect(remove).toHaveCSS("opacity", "1");
				await expect(remove).toHaveCSS("cursor", "progress");
			} finally {
				assert(releaseRemoval);
				releaseRemoval();
			}
			await expect(page.locator('[data-test-gmail-checklist-group="added"] [name="sender"]')).toHaveCount(1);
			await expect(addedTick(page, other)).toBeChecked();
			await expect(tick(page, TLDR)).toBeChecked();
			await expect(tick(page, BREW)).toBeChecked({ checked: false });
			await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, Tech");
			await expect(page.locator('input[type="checkbox"][name="import"]')).toBeChecked();
			await expect(page.locator("#gmail-sender-search")).toHaveValue("news@letters");
			await expect(page.locator(OPEN_DIALOG)).toBeVisible();

			await page.reload({ waitUntil: "domcontentloaded" });
			await expect(page.locator('[data-test-gmail-checklist-group="added"] [name="sender"]')).toHaveCount(1);
			await expect(addedTick(page, other)).toBeChecked();
			await pickSender(page, { email: KALE, search: "kale@" });
			await addedTick(page, KALE).uncheck();
			await remove.click();
			await expect(page.locator('[data-test-gmail-checklist-group="added"] [name="sender"]')).toHaveCount(1);
			await expect(addedTick(page, other)).toBeChecked();
			await page.locator(`[data-test-gmail-checklist-remove="${other}"]`).click();
			await expect(page.locator("[data-test-gmail-checklist-group]")).toHaveCount(1);
			await expect(page.locator("[data-test-gmail-checklist-group]")).toHaveAttribute("data-test-gmail-checklist-group", "known");
			await expect(tick(page, TLDR)).toBeChecked();
			await page.locator('input[type="checkbox"][name="import"]').uncheck();
			await saveMapping(page, TLDR);
			await expect(page.locator("[data-test-gmail-mapping-row]")).toHaveCount(1);
			await expect(mappingRow(page, TLDR).locator("[data-test-gmail-mapping-destination]")).toContainText("Tech");
		});
	}

	test("runs a clicked search inside the open dropdown instead of reloading the page", async ({ page }, testInfo) => {
		await openGmail(page, `search-click-${testInfo.workerIndex}-${Date.now()}`);
		await tick(page, TLDR).check();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator(SENDER_OPTION)).toHaveCount(3);
		const main = await page.locator("main").elementHandle();
		assert(main);
		await page.locator("#gmail-sender-search").evaluate((input) => {
			input.setAttribute("value", "kale");
		});
		await page.locator("#gmail-sender-search-submit").click();
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await expect(page.locator(`[data-test-gmail-sender-option="${KALE}"]`)).toBeVisible();
		await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
		assert.equal(await main.evaluate((element) => element.isConnected), true);
		await expect(tick(page, TLDR)).toBeChecked();
	});

	test("keeps a row unticked after a search once the page has been swapped in", async ({ page }, testInfo) => {
		await openGmail(page, `untick-${testInfo.workerIndex}-${Date.now()}`);
		await tick(page, TLDR).check();
		await pickSender(page, { email: KALE, search: "kale@" });
		await tick(page, TLDR).uncheck();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("brew");
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await expect(page.locator(`[data-test-gmail-sender-option="${BREW}"]`)).toBeVisible();
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator("#gmail-sender-search")).toHaveValue("brew");
		await expect(addedTick(page, KALE)).toBeChecked();
		await expect(tick(page, TLDR)).toBeChecked({ checked: false });
	});

	test("selects every known newsletter, then saves them together", async ({ page }, testInfo) => {
		await openGmail(page, `select-all-${testInfo.workerIndex}-${Date.now()}`);
		await page.locator(SELECT_ALL).click();
		await expect(tick(page, TLDR)).toBeChecked();
		await expect(tick(page, BREW)).toBeChecked();
		await expect(page.locator(SELECT_ALL)).toHaveAttribute("value", "none");
		await saveMapping(page, TLDR);
		await expect(page.locator('[data-test-alert="senders_saved"]')).toBeVisible();
		await expect(page.locator("[data-test-gmail-mapping-row]")).toHaveCount(2);
		await expect(mappingRow(page, BREW)).toBeVisible();
	});

	test("adds a newly found newsletter without moving the scrolled checklist in the popup, then keeps the ticks on refresh", async ({ page }, testInfo) => {
		const stamp = `refresh-${testInfo.workerIndex}-${Date.now()}`;
		const digests = digestNewsletters(30);
		const approved = digests.map((digest) => ({ from: digest.email, name: digest.name }));
		await openGmail(page, stamp, {
			approvedNewsletters: approved,
			discoveredSenders: [...digests, { email: KALE, name: "Hacker Newsletter" }],
			discoveryState: "running",
			discoveryMode: "full",
			discoveryScannedMessages: 4,
			discoveryEstimatedTotalMessages: 400,
		});
		await expect(page.locator(STATUS)).toHaveAttribute("hx-get", /poll=/);
		await tick(page, digests[0].email).check();
		await tick(page, digests[1].email).check();
		const panelScrollTop = await page.locator(DIALOG).evaluate((panel) => {
			panel.scrollTop = 200;
			return panel.scrollTop;
		});
		assert.ok(panelScrollTop > 0, "the checklist must overflow the panel");

		let releasePoll: (() => void) | undefined;
		const pollHeld = new Promise<void>((resolve) => {
			releasePoll = resolve;
		});
		let pollIntercepted: (() => void) | undefined;
		const pollArrived = new Promise<void>((resolve) => {
			pollIntercepted = resolve;
		});
		await page.route(
			(url) => url.pathname === "/newsletters/gmail/senders" && url.searchParams.has("poll"),
			async (route) => {
				assert(pollIntercepted);
				pollIntercepted();
				await pollHeld;
				await route.continue();
			},
		);
		await pollArrived;
		await seedApprovedNewsletters(page, {
			namespace: `gmail-picker-${stamp}`,
			newsletters: [...approved, { from: KALE, name: "Hacker Newsletter" }],
		});
		await page.evaluate(recordScrollAfterSwap, STATUS);
		const scrollYBefore = await page.evaluate(() => window.scrollY);
		const [statusBefore, checklistBefore] = await page.evaluate(measureBoxes, [STATUS, "#gmail-checklist"]);
		assert(releasePoll);
		releasePoll();

		await expect(page.locator(REFRESH_CHECKLIST)).toBeVisible();
		assert.equal(await scrollAfterSwap(page), scrollYBefore);
		const [statusAfter, checklistAfter] = await page.evaluate(measureBoxes, [STATUS, "#gmail-checklist"]);
		assert.equal(checklistAfter.y, checklistBefore.y, "the checklist must hold its place on screen while the refresh button appears above it");
		assert.equal(
			await page.locator(DIALOG).evaluate((panel) => panel.scrollTop) - panelScrollTop,
			Math.round(statusAfter.height - statusBefore.height),
		);

		const focusedRefresh = await page.locator(REFRESH_CHECKLIST).elementHandle();
		assert(focusedRefresh);
		await focusedRefresh.focus();
		await expect.poll(() => focusedRefresh.evaluate((button) => button.isConnected), { timeout: 20_000 }).toBe(false);
		await expect(page.locator(REFRESH_CHECKLIST)).toBeFocused();

		await page.locator(REFRESH_CHECKLIST).click();
		await expect(tick(page, KALE)).toHaveCount(1);
		await expect(tick(page, KALE)).toBeChecked({ checked: false });
		await expect(tick(page, digests[0].email)).toBeChecked();
		await expect(tick(page, digests[1].email)).toBeChecked();
	});

	test("keeps the popup and the page behind it still when a pointer selects every newsletter, picks a searched sender, or removes it", async ({ page }, testInfo) => {
		const digests = digestNewsletters(30);
		await openGmail(page, `scroll-${testInfo.workerIndex}-${Date.now()}`, {
			approvedNewsletters: digests.map((digest) => ({ from: digest.email, name: digest.name })),
			discoveredSenders: [...digests, { email: KALE, name: "Hacker Newsletter" }],
		});
		await waitForBrandFonts(page, ["Inter"]);
		const pageScroll = await page.evaluate(() => window.scrollY);

		const selectAllTop = await page.locator(DIALOG).evaluate((panel) => {
			const toolbar = panel.querySelector(".gmail__checklist-toolbar");
			if (!toolbar) throw new Error("the checklist toolbar must render");
			panel.scrollTop = toolbar.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 40;
			return panel.scrollTop;
		});
		assert.ok(selectAllTop > 0, "the panel must scroll for the check to mean anything");
		await page.evaluate(recordScrollAfterSwap, SELECTION_FORM);
		const selectAll = await measuredBox(page, SELECT_ALL);
		await page.mouse.click(selectAll.x + selectAll.width / 2, selectAll.y + selectAll.height / 2);
		await expect(tick(page, digests[29].email)).toBeChecked();
		assert.equal(await scrollAfterSwap(page), pageScroll);
		assert.equal(await page.locator(DIALOG).evaluate((panel) => panel.scrollTop), selectAllTop);
		await expect(page.locator(SELECT_ALL)).toBeFocused();

		await page.evaluate(() => document.documentElement.removeAttribute("data-test-scroll-after-swap"));
		await page.locator(`${SENDER_PICKER} summary`).scrollIntoViewIfNeeded();
		const trigger = await measuredBox(page, `${SENDER_PICKER} summary`);
		await page.mouse.click(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2);
		await page.locator("#gmail-sender-search").fill("kale@");
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		const pickTop = await page.locator(DIALOG).evaluate((panel) => panel.scrollTop);
		await page.evaluate(recordScrollAfterSwap, SELECTION_FORM);
		const option = await measuredBox(page, `[data-test-gmail-sender-option="${KALE}"]`);
		await page.mouse.click(option.x + option.width / 2, option.y + option.height / 2);
		await expect(addedTick(page, KALE)).toBeChecked();
		assert.equal(await scrollAfterSwap(page), pageScroll);
		assert.equal(await page.locator(DIALOG).evaluate((panel) => panel.scrollTop), pickTop);
		await expect(tick(page, digests[0].email)).toBeChecked();

		const remove = `[data-test-gmail-checklist-remove="${KALE}"]`;
		await page.locator(remove).scrollIntoViewIfNeeded();
		const removeTop = await page.locator(DIALOG).evaluate((panel) => panel.scrollTop);
		await page.evaluate(() => document.documentElement.removeAttribute("data-test-scroll-after-swap"));
		await page.evaluate(recordScrollAfterSwap, SELECTION_FORM);
		const removeBox = await measuredBox(page, remove);
		await page.mouse.click(removeBox.x + removeBox.width / 2, removeBox.y + removeBox.height / 2);
		await expect(page.locator("[data-test-gmail-checklist-group]")).toHaveCount(1);
		await expect(page.locator("[data-test-gmail-checklist-group]")).toHaveAttribute("data-test-gmail-checklist-group", "known");
		assert.equal(await scrollAfterSwap(page), pageScroll);
		const panelAfterRemoval = await page.locator(DIALOG).evaluate((panel) => ({ top: panel.scrollTop, maximum: panel.scrollHeight - panel.clientHeight }));
		assert.equal(panelAfterRemoval.top, Math.min(removeTop, panelAfterRemoval.maximum));
		await expect(tick(page, digests[0].email)).toBeChecked();
	});

	test("keeps Cancel and Save inside the visible panel of a long Add popup on a short phone screen, and Escape closes only the open picker", async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 375, height: 500 });
		const digests = digestNewsletters(30);
		await openGmail(page, `footer-${testInfo.workerIndex}-${Date.now()}`, {
			approvedNewsletters: digests.map((digest) => ({ from: digest.email, name: digest.name })),
			discoveredSenders: digests,
		});
		await waitForBrandFonts(page, ["Inter"]);
		const overflow = await page.locator(DIALOG).evaluate((panel) => {
			panel.scrollTop = 0;
			return panel.scrollHeight - panel.clientHeight;
		});
		assert.ok(overflow > 0, "the checklist must overflow the panel for the footer check to mean anything");
		const [panel, cancel, save] = await page.evaluate(measureBoxes, [DIALOG, '[data-test-action="gmail-add-cancel"]', "[data-test-gmail-save]"]);
		assert.ok(panel.x >= 16 && panel.x + panel.width <= 375 - 16, `the panel must keep 16px phone margins, measured ${panel.x}`);
		for (const [name, control] of [["Cancel", cancel], ["Save", save]] as const) {
			assert.ok(control.y >= panel.y && control.y + control.height <= panel.y + panel.height, `${name} must sit inside the visible panel`);
			assert.ok(control.y + control.height <= 500, `${name} must sit inside the viewport`);
		}

		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator("#gmail-sender-search")).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(page.locator(`${SENDER_PICKER} summary`)).toBeFocused();
		await expect(page.locator(SENDER_PICKER)).toHaveJSProperty("open", false);
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
	});
});

test.describe("Gmail newsletters popup", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	function manyMappings(count: number) {
		return digestNewsletters(count).map((digest) => ({ destination: "readlist" as const, email: digest.email, readlist: "Tech" }));
	}

	async function clickCentre(page: Page, selector: string): Promise<void> {
		await page.locator(selector).scrollIntoViewIfNeeded();
		const box = await measuredBox(page, selector);
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	}

	function addOpen(url: string): boolean {
		return new URL(url).searchParams.get("add") === "1";
	}

	test("opens Add newsletters where the reader is, on the first newsletter in the checklist, with add=1 in the address", async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 375, height: 500 });
		await openGmail(page, `add-${testInfo.workerIndex}-${Date.now()}`, { closed: true, readlists: ["Tech"], mappings: manyMappings(8) });
		const before = await page.locator(ADD_NEWSLETTERS).evaluate((button) => {
			window.scrollTo({ top: window.scrollY + button.getBoundingClientRect().top - window.innerHeight / 2, behavior: "instant" });
			return window.scrollY;
		});
		assert.ok(before > 0, "the page must scroll for the check to mean anything");
		await page.evaluate(recordScrollAfterSwap, ADD_NEWSLETTERS);
		await clickCentre(page, ADD_NEWSLETTERS);
		await expect(page.locator(OPEN_DIALOG)).toHaveAttribute("data-test-confirm-popover", "gmail-add");
		await expect(page.locator("#gmail-dialog-title")).toHaveText("Add newsletters");
		await expect(tick(page, BREW)).toBeFocused();
		assert.equal(await scrollAfterSwap(page), before);
		assert.equal(addOpen(page.url()), true);
	});

	test("opens Edit on Save under the newsletter's name, not on New readlist, because a focus ring there reads as a field the reader must fill", async ({ page }, testInfo) => {
		const digests = digestNewsletters(12);
		await openGmail(page, `edit-${testInfo.workerIndex}-${Date.now()}`, {
			closed: true,
			readlists: ["Tech"],
			mappings: manyMappings(12),
			approvedNewsletters: digests.map((digest) => ({ from: digest.email, name: digest.name })),
		});
		const last = digests[11];
		const edit = `[data-test-gmail-mapping-row="${last.email}"] [data-test-gmail-mapping-action="edit"]`;
		await page.locator(edit).scrollIntoViewIfNeeded();
		const before = await page.evaluate(() => window.scrollY);
		assert.ok(before > 0, "the last row must sit below the fold for the scroll check to mean anything");
		await page.evaluate(recordScrollAfterSwap, edit);
		await clickCentre(page, edit);
		await expect(page.locator(OPEN_DIALOG)).toHaveAttribute("data-test-confirm-popover", "gmail-edit");
		await expect(page.locator("#gmail-dialog-title")).toHaveText(`Edit ${last.name}`);
		await expect(page.locator("[data-test-gmail-save]")).toBeFocused();
		await expect(page.locator(READLIST_PICKER)).toHaveJSProperty("open", false);
		assert.equal(await scrollAfterSwap(page), before);

		await page.evaluate(() => document.documentElement.removeAttribute("data-test-scroll-after-swap"));
		await page.evaluate(recordScrollAfterSwap, '[data-test-action="gmail-edit-cancel"]');
		await clickCentre(page, '[data-test-action="gmail-edit-cancel"]');
		await expect(page.locator(DIALOG)).toHaveCount(0);
		assert.equal(await scrollAfterSwap(page), before);
		await expect(page.locator(edit)).toBeFocused();
	});

	test("opens the newsletter a notification email links to, focused on that newsletter", async ({ page }, testInfo) => {
		await openGmail(page, `email-${testInfo.workerIndex}-${Date.now()}`, { closed: true });
		await page.goto(`${BASE_URL}/newsletters/gmail?sender=${encodeURIComponent(TLDR)}&notification=1&readlist_choice_for=${encodeURIComponent(TLDR)}`, { waitUntil: "domcontentloaded" });
		await expect(page.locator(OPEN_DIALOG)).toHaveAttribute("data-test-confirm-popover", "gmail-add");
		await expect(tick(page, TLDR)).toBeFocused();
		await expect(tick(page, TLDR)).toBeChecked();
	});

	test("closes the open picker on Escape, then the popup, returning to the closed address and to Add newsletters", async ({ page }, testInfo) => {
		await openGmail(page, `escape-${testInfo.workerIndex}-${Date.now()}`, { readlists: ["Tech"] });
		await openReadlistPicker(page);
		await page.keyboard.press("Escape");
		await expect(page.locator(READLIST_PICKER)).toHaveJSProperty("open", false);
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(DIALOG)).toHaveCount(0);
		await expect.poll(() => addOpen(page.url())).toBe(false);
		await expect(page.locator(ADD_NEWSLETTERS)).toBeFocused();
	});

	test("closes the popup on a click outside it", async ({ page }, testInfo) => {
		await openGmail(page, `outside-${testInfo.workerIndex}-${Date.now()}`);
		await page.mouse.click(20, 450);
		await expect(page.locator(DIALOG)).toHaveCount(0);
		await expect.poll(() => addOpen(page.url())).toBe(false);
	});

	test("keeps the page where it was when the popup closes from its close button", async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await openGmail(page, `close-${testInfo.workerIndex}-${Date.now()}`, { closed: true, mappings: manyMappings(8), readlists: ["Tech"] });
		await page.locator(ADD_NEWSLETTERS).scrollIntoViewIfNeeded();
		const before = await page.evaluate(() => window.scrollY);
		await clickCentre(page, ADD_NEWSLETTERS);
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
		await page.evaluate(recordScrollAfterSwap, '[data-test-action="gmail-add-dismiss"]');
		const close = await measuredBox(page, '[data-test-action="gmail-add-dismiss"]');
		await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
		await expect(page.locator(DIALOG)).toHaveCount(0);
		assert.equal(await scrollAfterSwap(page), before);
		await expect(page.locator(ADD_NEWSLETTERS)).toBeFocused();
	});

	test("keeps the popup up when it is dismissed while Apply readlists is on its way, until the answer lands", async ({ page }, testInfo) => {
		await openGmail(page, `inflight-${testInfo.workerIndex}-${Date.now()}`, { readlists: ["Tech"] });
		await tick(page, TLDR).check();
		await openReadlistPicker(page);
		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let arrived: (() => void) | undefined;
		const intercepted = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		await page.route((url) => url.pathname === "/newsletters/gmail" && url.searchParams.has("confirm_readlists"), async (route) => {
			assert(arrived);
			arrived();
			await held;
			await route.continue();
		});
		await page.locator(CUSTOM_READLIST_OPTION).check();
		await intercepted;
		await page.mouse.click(20, 450);
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
		assert(release);
		release();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, Tech");
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
		await expect.poll(() => addOpen(page.url())).toBe(true);
	});

	test("closes on Save, lists the newsletter, and puts focus back on Add newsletters without moving the page", async ({ page }, testInfo) => {
		await openGmail(page, `save-${testInfo.workerIndex}-${Date.now()}`);
		const before = await page.evaluate(() => window.scrollY);
		await tick(page, TLDR).check();
		await page.evaluate(recordScrollAfterSwap, "[data-test-gmail-save]");
		await clickCentre(page, "[data-test-gmail-save]");
		await expect(mappingRow(page, TLDR)).toBeVisible();
		await expect(page.locator(DIALOG)).toHaveCount(0);
		await expect(page.locator('[data-test-alert="sender_mapped"]')).toBeVisible();
		assert.equal(await scrollAfterSwap(page), before);
		await expect(page.locator(ADD_NEWSLETTERS)).toBeFocused();
		await expect.poll(() => addOpen(page.url())).toBe(false);
	});

	test("shows a created readlist's notice inside the popup and moves focus to Save", async ({ page }, testInfo) => {
		await openGmail(page, `create-notice-${testInfo.workerIndex}-${Date.now()}`);
		await tick(page, TLDR).check();
		await openReadlistPicker(page);
		await page.locator(`${CREATE_READLIST} input[name="readlist_name"]`).fill("Science");
		await page.locator(`${CREATE_READLIST} button[type="submit"]`).click();
		await expect(page.locator('#gmail-dialog-body [data-test-alert="readlist_created"]')).toBeVisible();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, Science");
		await expect(page.locator("[data-test-gmail-save]")).toBeFocused();
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
	});

	test("reopens the popup on Back, closes it on Forward, and keeps it open across a reload", async ({ page }, testInfo) => {
		await openGmail(page, `history-${testInfo.workerIndex}-${Date.now()}`);
		await tick(page, TLDR).check();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("kale@");
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(addedTick(page, KALE)).toBeChecked();
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
		await expect(addedTick(page, KALE)).toBeChecked();
		await page.locator('[data-test-action="gmail-add-cancel"]').click();
		await expect(page.locator(DIALOG)).toHaveCount(0);
		await page.goBack();
		await expect(page.locator(OPEN_DIALOG)).toBeVisible();
		await expect(addedTick(page, KALE)).toBeChecked();
		await page.goForward();
		await expect(page.locator(DIALOG)).toHaveCount(0);
		await expect(page.locator(ADD_NEWSLETTERS)).toBeVisible();
	});
});

test.describe("Gmail sender picker without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	test("removes a draft sender through an ordinary form and can add it again from search", async ({ page }, testInfo) => {
		await openGmail(page, `nojs-dismiss-${testInfo.workerIndex}-${Date.now()}`, { enhanced: false, readlists: ["Tech"] });
		await tick(page, TLDR).check();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("kale@");
		await page.locator("#gmail-sender-search-submit").click();
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(addedTick(page, KALE)).toBeChecked();
		await page.locator(`${READLIST_PICKER} summary`).click();
		await page.locator(CUSTOM_READLIST_OPTION).check();
		await page.locator('input[type="radio"][name="delivery"][value="both"]').check();
		await page.locator(`[data-test-gmail-checklist-remove="${KALE}"]`).click();
		await expect(page.locator("[data-test-gmail-checklist-group]")).toHaveCount(1);
		await expect(page.locator("[data-test-gmail-checklist-group]")).toHaveAttribute("data-test-gmail-checklist-group", "known");
		await expect(tick(page, TLDR)).toBeChecked();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, Tech");
		await expect(page.locator('input[type="radio"][name="delivery"][value="both"]')).toBeChecked();
		await expect(page.locator("#gmail-sender-search")).toHaveValue("kale@");
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(addedTick(page, KALE)).toBeChecked();
		await expect(tick(page, TLDR)).toBeChecked();
		await saveMapping(page, KALE);
		await expect(page.locator("[data-test-gmail-mapping-row]")).toHaveCount(2);
	});

	test("confirms two existing custom readlists before saving a notification without JavaScript", async ({ page }, testInfo) => {
		await openGmail(page, `nojs-multiple-${testInfo.workerIndex}-${Date.now()}`, { enhanced: false, readlists: ["Tech", "Work"] });
		await page.goto(`${BASE_URL}/newsletters/gmail?sender=${encodeURIComponent(TLDR)}&notification=1&discovery=started`, { waitUntil: "domcontentloaded" });
		await expect(page.locator("[data-test-gmail-save]")).toBeDisabled();
		await page.locator(`${READLIST_PICKER} summary`).click();
		await expect(page.locator('[data-test-gmail-readlist-option="default"]')).toBeChecked();
		await expect(page.locator('[data-test-gmail-readlist-option="default"]')).toBeDisabled();
		for (const custom of await page.locator(CUSTOM_READLIST_OPTION).all()) await custom.check();
		await expect(page.locator("[data-test-gmail-save]")).toBeDisabled();
		await page.locator("[data-gmail-confirm-readlists]").click();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText(/^All, (Tech, Work|Work, Tech)$/);
		await expect(page.locator("[data-test-gmail-save]")).toBeEnabled();
		await saveMapping(page, TLDR);
		await expect(mappingRow(page, TLDR).locator("[data-test-gmail-mapping-destination]")).toHaveText(/^Saved to All, (Tech, Work|Work, Tech)$/);
	});

	test("opens a notification, chooses among readlists, searches and saves through ordinary forms", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `nojs-${testInfo.workerIndex}-${Date.now()}`, { enhanced: false, readlists: ["Tech"] });
		await page.goto(`${BASE_URL}/newsletters/gmail?sender=${encodeURIComponent(KALE)}&notification=1&discovery=started`, { waitUntil: "domcontentloaded" });
		await expect(addedTick(page, KALE)).toBeChecked();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All");
		await expect(page.locator("[data-test-gmail-save]")).toBeDisabled();
		await page.locator(`${READLIST_PICKER} summary`).click();
		await page.locator("[data-gmail-confirm-readlists]").click();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All");
		await expect(page.locator("[data-test-gmail-save]")).toBeEnabled();
		await page.locator("#gmail-load-senders-button").click();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("Hacker");
		await page.locator("#gmail-sender-search-submit").click();
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(addedTick(page, KALE)).toBeChecked();
		await page.locator(`${READLIST_PICKER} summary`).click();
		await page.locator(`${CREATE_READLIST} input[name="readlist_name"]`).fill("News");
		await page.locator(`${CREATE_READLIST} button[type="submit"]`).click();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("All, News");
		await page.locator("[data-test-gmail-save]").click();
		await expect(mappingRow(page, KALE).locator("[data-test-gmail-mapping-destination]")).toContainText("News");
	});

	test("keeps two ticked newsletters while a search reloads the page and a picked sender joins them, then saves all three", async ({ page }, testInfo) => {
		await openGmail(page, `nojs-bulk-${testInfo.workerIndex}-${Date.now()}`, { enhanced: false });
		await tick(page, TLDR).check();
		await tick(page, BREW).check();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("kale");
		await page.locator("#gmail-sender-search-submit").click();
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await expect(tick(page, TLDR)).toBeChecked();
		await expect(tick(page, BREW)).toBeChecked();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(addedTick(page, KALE)).toBeChecked();
		await expect(tick(page, TLDR)).toBeChecked();
		await expect(tick(page, BREW)).toBeChecked();
		await saveMapping(page, KALE);
		await expect(page.locator('[data-test-alert="senders_saved"]')).toBeVisible();
		await expect(page.locator("[data-test-gmail-mapping-row]")).toHaveCount(3);
	});

	test("opens Add newsletters as an inline panel that cancels back to the page and saves through ordinary forms", async ({ page }, testInfo) => {
		await openGmail(page, `nojs-inline-${testInfo.workerIndex}-${Date.now()}`, { enhanced: false, closed: true });
		await page.locator(ADD_NEWSLETTERS).click();
		await expect(page.locator(DIALOG)).toBeVisible();
		await expect(page.locator(DIALOG)).toHaveCSS("position", "relative");
		await expect(tick(page, BREW)).toBeFocused();
		await page.locator('[data-test-action="gmail-add-cancel"]').click();
		await expect(page.locator(DIALOG)).toHaveCount(0);
		await page.locator(ADD_NEWSLETTERS).click();
		await tick(page, TLDR).check();
		await saveMapping(page, TLDR);
		await expect(page.locator(DIALOG)).toHaveCount(0);
	});

	test("selects every known newsletter, then saves them together without JavaScript", async ({ page }, testInfo) => {
		await openGmail(page, `nojs-select-all-${testInfo.workerIndex}-${Date.now()}`, { enhanced: false });
		await page.locator(SELECT_ALL).click();
		await expect(tick(page, TLDR)).toBeChecked();
		await expect(tick(page, BREW)).toBeChecked();
		await saveMapping(page, BREW);
		await expect(page.locator('[data-test-alert="senders_saved"]')).toBeVisible();
		await expect(page.locator("[data-test-gmail-mapping-row]")).toHaveCount(2);
	});
});
