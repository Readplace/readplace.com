import assert from "node:assert/strict";
import { measuredBox, test, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { markSenderSearchTriggers } from "./gmail-sender-picker.browser";
import { measureBoxes } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TLDR = "dan@tldr.tech";
const BREW = "crew@morningbrew.com";
const KALE = "kale@hackernewsletter.com";
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const READLIST_PICKER = "[data-test-gmail-readlist-picker]";
const RESULTS = "[data-test-gmail-sender-results]";
const DISCOVERY_FENCE = `${RESULTS} > input[form="gmail-sender-search-form"][name="discovery_after"]`;
const SENDER_OPTION = "[data-test-gmail-sender-option]";
const CREATE_READLIST = "[data-test-gmail-readlist-create]";
const CUSTOM_READLIST_OPTION = '[data-test-gmail-readlist-option]:not([data-test-gmail-readlist-option="default"])';
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

async function openGmail(page: Page, stamp: string, seed: GmailSeed = {}): Promise<void> {
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
	await page.goto(`${BASE_URL}/integrations`, { waitUntil: "domcontentloaded" });
	await page.locator('[data-test-integration="gmail"] [data-test-integration-action="manage"]').click();
	await expect(page.locator(SENDER_PICKER)).toBeVisible();
	if (seed.enhanced !== false) {
		await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
		if (seed.discoveryStartHeld !== true) {
			await expect(page.locator(DISCOVERY_FENCE)).toHaveCount(1);
		}
	}
}

async function chooseSender(page: Page, input: { email: string; search?: string }): Promise<void> {
	await page.locator(`${SENDER_PICKER} summary`).click();
	if (input.search !== undefined) {
		await page.locator("#gmail-sender-search").fill(input.search);
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
	}
	await page.locator(`[data-test-gmail-sender-option="${input.email}"]`).click();
	await expect(page.locator("#gmail-sender-choice")).toContainText(input.email);
	await expect(page.locator(READLIST_PICKER)).toBeVisible();
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

	test("maps a searched sender, moves a legacy inbox mapping to All, then removes every mapping", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `mapping-${testInfo.workerIndex}-${Date.now()}`, {
			readlists: ["Tech"],
			mappings: [{ destination: "legacy-inbox", email: BREW, readlist: "Tech", inboxName: "morningbrew" }],
		});
		await expect(mappingRow(page, BREW).locator("[data-test-gmail-mapping-destination]")).toHaveAttribute(
			"data-destination-kind",
			"readlist",
		);

		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator("#gmail-sender-search")).toBeFocused();
		await expect(page.locator(RESULTS)).toHaveAttribute("data-results-state", "listed");
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await expect(page.locator(`[data-test-gmail-sender-option="${BREW}"]`)).toHaveCount(0);
		await page.locator("#gmail-sender-search").fill("kale@");
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(page.locator("#gmail-sender-choice")).toContainText(KALE);

		await openReadlistPicker(page);
		await expect(page.locator("[data-test-gmail-readlist-option]")).toHaveCount(2);
		await page.locator(CUSTOM_READLIST_OPTION).click();
		await saveMapping(page, KALE);
		const kale = mappingRow(page, KALE).locator("[data-test-gmail-mapping-destination]");
		await expect(kale).toHaveAttribute("data-destination-kind", "readlist");
		await expect(kale).toContainText("Tech");

		await mappingRow(page, BREW).locator('[data-test-gmail-mapping-action="edit"]').click();
		await expect(page.locator(READLIST_PICKER)).toHaveAttribute("open", "");
		await page.locator('[data-test-gmail-readlist-option="default"]').click();
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
		await page.route("**/integrations/gmail/discovery/start**", async (route) => {
			await discoveryHeld;
			await route.continue();
		});
		const discoveryResponse = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				response.url().includes("/integrations/gmail/discovery/start"),
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
		await expect(page.locator(RESULTS)).toHaveAttribute("hx-get", /poll=1/);
		assert(releaseDiscovery);
		releaseDiscovery();
		await discoveryResponse;
		await expect(page.locator("#gmail-load-senders-button")).toHaveText("Load senders");
		await expect(page.locator(RESULTS)).not.toHaveAttribute("hx-get");
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
		await page.route("**/integrations/gmail/discovery/start**", async (route) => {
			await discoveryHeld;
			await route.continue();
		});
		await page.route(
			(url) => url.pathname === "/integrations/gmail/senders",
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
		await expect(page.locator(RESULTS)).toHaveAttribute("hx-get", /[?&]search=hacker&/);
	});

	test("chooses a sender clicked in the polling results while the automatic discovery start is in flight", async ({
		page,
	}, testInfo) => {
		let releaseDiscovery: (() => void) | undefined;
		const discoveryHeld = new Promise<void>((resolve) => {
			releaseDiscovery = resolve;
		});
		await page.route("**/integrations/gmail/discovery/start**", async (route) => {
			await discoveryHeld;
			await route.continue();
		});
		const discoveryResponse = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				response.url().includes("/integrations/gmail/discovery/start"),
		);
		await openGmail(page, `polling-choice-${testInfo.workerIndex}-${Date.now()}`, {
			discoveryState: "running",
			discoveryMode: "full",
			discoveryScannedMessages: 4,
			discoveryEstimatedTotalMessages: 12,
			discoveryStartHeld: true,
		});
		await expect(page.locator("[data-test-gmail-load-senders]")).toHaveClass(/htmx-request/);
		await expect(page.locator(RESULTS)).toHaveAttribute("hx-get", /poll=1/);

		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator(`[data-test-gmail-sender-option="${TLDR}"]`).click();
		await expect(page.locator("#gmail-sender-choice")).toContainText(TLDR);

		assert(releaseDiscovery);
		releaseDiscovery();
		await discoveryResponse;
		await expect(page.locator("#gmail-sender-choice")).toContainText(TLDR);
	});

	test("keeps an invalid readlist name in the reopened picker, then reuses and creates readlists before saving", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `create-${testInfo.workerIndex}-${Date.now()}`, { readlists: ["Tech"] });
		await chooseSender(page, { email: TLDR });
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
		await expect(page.locator("#gmail-sender-choice")).toContainText(TLDR);

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
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("Science");

		await saveMapping(page, TLDR);
		await expect(mappingRow(page, TLDR).locator("[data-test-gmail-mapping-destination]")).toContainText("Science");
	});

	test("omits inline creation at the readlist cap while keeping existing readlists selectable", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `cap-${testInfo.workerIndex}-${Date.now()}`, {
			readlists: Array.from({ length: 7 }, (_, index) => `Shelf ${index}`),
		});
		await chooseSender(page, { email: KALE, search: "kale@" });
		await openReadlistPicker(page);
		await expect(page.locator("[data-test-gmail-readlist-limit]")).toBeVisible();
		await expect(page.locator(CUSTOM_READLIST_OPTION)).toHaveCount(7);
		await expect(page.locator(CREATE_READLIST)).toHaveCount(0);
		const shelf = page.locator(CUSTOM_READLIST_OPTION).first();
		const shelfName = await shelf.textContent();
		assert.ok(shelfName, "a readlist option must name its readlist");
		await shelf.click();
		await saveMapping(page, KALE);
		await expect(mappingRow(page, KALE).locator("[data-test-gmail-mapping-destination]")).toContainText(shelfName);
	});

	test("keeps sender search pinned while its results scroll on a narrow screen", async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 375, height: 500 });
		const digests = Array.from({ length: 30 }, (_, index) => ({
			email: `digest-${index}@publisher-${index}.com`,
			name: `Digest ${String(index).padStart(2, "0")}`,
		}));
		await openGmail(page, `sticky-${testInfo.workerIndex}-${Date.now()}`, {
			approvedNewsletters: digests.map((digest) => ({ from: digest.email, name: digest.name })),
			discoveredSenders: digests,
		});
		await waitForBrandFonts(page, ["Inter"]);
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator(RESULTS)).toBeVisible();
		await expect(page.locator("#gmail-sender-search")).toBeFocused();
		await expect(page.locator(SENDER_OPTION)).toHaveCount(30);

		const firstResult = '[data-test-gmail-sender-option="digest-0@publisher-0.com"]';
		const measured = [SENDER_PICKER, `${SENDER_PICKER} .gmail__picker-menu`, "#gmail-sender-search-form", firstResult];
		const [picker, menu, searchBefore, firstBefore] = await page.evaluate(measureBoxes, measured);
		assert.ok(menu.x >= 0 && menu.x + menu.width <= 375, "the menu must fit the viewport");
		assert.ok(menu.y >= picker.y, "the menu must open below the sender trigger");
		assert.ok(
			searchBefore.x >= menu.x && searchBefore.x + searchBefore.width <= menu.x + menu.width,
			"search must fit inside the menu",
		);
		assert.ok(
			Math.abs(firstBefore.x - menu.x - 1 - 4) <= 0.5,
			`the sender options must start 4px inside the menu border, measured ${firstBefore.x - menu.x - 1}px`,
		);

		const scrollTop = await page.locator(`${SENDER_PICKER} .gmail__picker-menu`).evaluate((element) => {
			element.scrollTop = element.scrollHeight;
			return element.scrollTop;
		});
		assert.ok(scrollTop > 0, "the sender results must overflow the picker menu");
		const [, , searchAfter, firstAfter] = await page.evaluate(measureBoxes, measured);
		assert.ok(
			Math.abs(searchAfter.y - searchBefore.y) <= 1,
			`the sender search must stay pinned while results scroll (before ${searchBefore.y}, after ${searchAfter.y})`,
		);
		assert.ok(
			firstAfter.y < firstBefore.y,
			`sender results must scroll beneath the pinned search (before ${firstBefore.y}, after ${firstAfter.y})`,
		);

		await page.keyboard.press("Escape");
		await expect(page.locator(`${SENDER_PICKER} summary`)).toBeFocused();
		await expect(page.locator(SENDER_PICKER)).not.toHaveAttribute("open");
	});
});

test.describe("Gmail sender picker without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	test("loads, searches, creates a readlist and saves its sender through ordinary forms", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `nojs-${testInfo.workerIndex}-${Date.now()}`, { enhanced: false });
		await page.locator("#gmail-load-senders-button").click();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("Hacker");
		await page.locator('#gmail-sender-search-form button[type="submit"]').click();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator(SENDER_OPTION)).toHaveCount(1);
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await page.locator(`${READLIST_PICKER} summary`).click();
		await page.locator(`${CREATE_READLIST} input[name="readlist_name"]`).fill("News");
		await page.locator(`${CREATE_READLIST} button[type="submit"]`).click();
		await expect(page.locator("#gmail-readlist-choice")).toHaveText("News");
		await page.locator("[data-test-gmail-save]").click();
		await expect(mappingRow(page, KALE).locator("[data-test-gmail-mapping-destination]")).toContainText("News");
	});
});
