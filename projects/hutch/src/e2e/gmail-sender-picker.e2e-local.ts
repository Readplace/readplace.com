import assert from "node:assert/strict";
import { measuredBox, test, waitForBrandFonts } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const TLDR = "dan@tldr.tech";
const BREW = "crew@morningbrew.com";
const KALE = "kale@hackernewsletter.com";
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const INBOX_PICKER = "[data-test-gmail-inbox-picker]";
const RESULTS = "[data-test-gmail-sender-results]";
const MAPPING = "[data-test-gmail-mapping]";
const CREATE_ROW = "[data-test-gmail-destination-create]";
const CREATE_INBOX = "[data-test-gmail-create-inbox]";

interface GmailSeed {
	senders?: {
		email: string;
		place: "filter" | "unsorted" | "mapped";
		subject?: string;
	}[];
	discoveredSenders?: { email: string; name?: string }[];
	discoveryState?: "running" | "complete";
	discoveryMode?: "profile" | "full" | "history";
	discoveryScannedMessages?: number;
	discoveryEstimatedTotalMessages?: number;
	completeDiscoveryOnStart?: boolean;
	enhanced?: boolean;
}

async function openGmail(
	page: Page,
	stamp: string,
	seed: GmailSeed = {},
): Promise<void> {
	const email = `gmail-picker-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201);
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId,
			state: "filtering",
			senders: seed.senders ?? [{ email: TLDR, place: "mapped" }],
			discoveredSenders: seed.discoveredSenders ?? [
				{ email: TLDR, name: "TLDR" },
				{ email: BREW, name: "Morning Brew" },
				{ email: KALE, name: "Hacker Newsletter" },
			],
			discoveryState: seed.discoveryState,
			discoveryMode: seed.discoveryMode,
			discoveryScannedMessages: seed.discoveryScannedMessages,
			discoveryEstimatedTotalMessages:
				seed.discoveryEstimatedTotalMessages,
			completeDiscoveryOnStart: seed.completeDiscoveryOnStart,
		},
	});
	assert.equal(seeded.status(), 201);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/integrations`, {
		waitUntil: "domcontentloaded",
	});
	await page
		.locator(
			'[data-test-integration="gmail"] [data-test-integration-action="manage"]',
		)
		.click();
	await expect(page.locator(SENDER_PICKER)).toBeVisible();
	if (seed.enhanced !== false) {
		await expect(page.locator("html")).toHaveAttribute(
			"data-gmail-picker-attached",
			"",
		);
		if (seed.completeDiscoveryOnStart !== true) {
			await expect(
				page.locator(
					`${RESULTS} > input[form="gmail-sender-search-form"][name="discovery_after"]`,
				),
			).toHaveCount(1);
		}
	}
}

async function chooseSender(page: Page, email: string): Promise<void> {
	await page.locator(`${SENDER_PICKER} summary`).click();
	await page.locator(`[data-test-gmail-sender-option="${email}"]`).click();
	await expect(page.locator("#gmail-sender-choice")).toHaveText(email);
	await expect(page.locator(INBOX_PICKER)).toBeVisible();
}

async function expectTrackedInboxManagement(page: Page): Promise<void> {
	const manage = page.locator("[data-test-gmail-manage-inboxes]");
	await expect(manage).toHaveCount(1);
	await expect(manage).toHaveText("Manage Your Inboxes");
	const href = await manage.getAttribute("href");
	assert.ok(href, "the inbox management CTA must carry a destination");
	const destination = new URL(href, BASE_URL);
	assert.equal(destination.pathname, "/inbox/addresses");
	assert.equal(
		destination.searchParams.get("utm_source"),
		"integrations-gmail",
	);
	assert.equal(destination.searchParams.get("utm_medium"), "internal");
	assert.equal(destination.searchParams.get("utm_content"), "manage-inboxes");
}

test.describe("Gmail sender picker", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("remaps cached-absent mapped and legacy senders, then removes the card with its final sender", async ({
		page,
	}, testInfo) => {
		const discoveryRequest = page.waitForRequest(
			(request) =>
				request.method() === "POST" &&
				request.url().includes("/integrations/gmail/discovery/start"),
		);
		await openGmail(page, `mapping-${testInfo.workerIndex}-${Date.now()}`, {
			senders: [
				{ email: TLDR, place: "mapped" },
				{ email: BREW, place: "mapped" },
				{ email: KALE, place: "filter" },
			],
			discoveredSenders: [],
		});
		await discoveryRequest;
		await expect(page.locator("#gmail-sender-label")).toHaveText(
			"Articles From ...",
		);
		await expectTrackedInboxManagement(page);
		const morningBrewMapping = page.locator(MAPPING).filter({
			has: page.locator(`[data-test-gmail-mapped-sender="${BREW}"]`),
		});
		const morningBrewDestination = await morningBrewMapping.getAttribute(
			"data-test-gmail-mapping",
		);
		assert.ok(
			morningBrewDestination,
			"the mapped sender must expose its existing destination",
		);
		const legacyMapping = page.locator(MAPPING).filter({
			has: page.locator(`[data-test-gmail-mapped-sender="${KALE}"]`),
		});
		await expect(
			legacyMapping.locator("[data-test-gmail-mapping-destination-label]"),
		).toHaveText("still need an inbox.");

		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator("#gmail-sender-search")).toBeFocused();
		await expect(page.locator("[data-test-gmail-sender-option]")).toHaveCount(
			3,
		);
		await page.locator("#gmail-sender-search").fill("kale@");
		await expect(page.locator("[data-test-gmail-sender-option]")).toHaveCount(
			1,
		);
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await expect(page.locator("#gmail-sender-choice")).toHaveText(KALE);
		await expect(page.locator("#gmail-destination-label")).toHaveText(
			"... are saved to ...",
		);

		await page.locator(`${INBOX_PICKER} summary`).click();
		await page
			.locator(
				`[data-test-gmail-destination-option="${morningBrewDestination}"]`,
			)
			.click();
		await page.locator("[data-test-gmail-save]").click();
		await expect(
			morningBrewMapping.locator(`[data-test-gmail-mapped-sender="${KALE}"]`),
		).toBeVisible();
		await chooseSender(page, TLDR);
		await page.locator(`${INBOX_PICKER} summary`).click();
		await page
			.locator(
				`[data-test-gmail-destination-option="${morningBrewDestination}"]`,
			)
			.click();
		await page.locator("[data-test-gmail-save]").click();

		const mapping = page.locator(MAPPING);
		await expect(mapping).toHaveCount(1);
		await expect(
			mapping.locator("[data-test-gmail-mapped-sender]"),
		).toHaveCount(3);
		await expect(
			mapping.locator("[data-test-gmail-mapping-source-label]"),
		).toHaveText("Articles from");
		await expect(
			mapping.locator("[data-test-gmail-mapping-destination-label]"),
		).toHaveText("are saved to morningbrew.");
		const mappingBox = await measuredBox(page, MAPPING);
		const managementBox = await measuredBox(
			page,
			"[data-test-gmail-manage-inboxes]",
		);
		assert.ok(
			managementBox.y >= mappingBox.y + mappingBox.height,
			"inbox management must follow the mapping list",
		);
		await expect(mapping.locator("button")).toHaveText([
			"Exclude",
			"Exclude",
			"Exclude",
		]);
		for (const sender of [TLDR, BREW, KALE]) {
			const senderRow = mapping.locator(
				`[data-test-gmail-mapped-sender="${sender}"]`,
			);
			await expect(senderRow).toContainText(sender);
			await expect(senderRow.locator("a")).toHaveCount(0);
			await expect(senderRow.locator("button")).toHaveText("Exclude");
		}

		await page.locator(`[data-test-gmail-exclude-sender="${KALE}"]`).click();
		await expect(page.locator("[data-test-gmail-mapped-sender]")).toHaveCount(
			2,
		);
		await page.locator(`[data-test-gmail-exclude-sender="${BREW}"]`).click();
		await expect(page.locator("[data-test-gmail-mapped-sender]")).toHaveCount(
			1,
		);
		await page.locator(`[data-test-gmail-exclude-sender="${TLDR}"]`).click();
		await expect(page.locator("[data-test-gmail-empty]")).toBeVisible();
		await expect(page.locator(MAPPING)).toHaveCount(0);
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
		});
		await expect(page.locator("#gmail-load-senders-button")).toHaveText(
			"Checking 4 of 12 messages…",
		);
		await expect(page.locator(RESULTS)).toHaveAttribute("hx-get", /poll=1/);
		assert(releaseDiscovery);
		releaseDiscovery();
		await discoveryResponse;
		await expect(page.locator("#gmail-load-senders-button")).toHaveText(
			"Load senders",
		);
		await expect(page.locator(RESULTS)).not.toHaveAttribute("hx-get");
	});

	test("keeps an invalid inline inbox name in the reopened picker, then creates and maps it", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `create-${testInfo.workerIndex}-${Date.now()}`);
		await chooseSender(page, KALE);
		await page.locator(`${INBOX_PICKER} summary`).click();

		const row = page.locator(CREATE_ROW);
		const input = row.locator('input[name="inbox_name"]');
		const submit = row.locator(`${CREATE_INBOX}[type="submit"]`);
		await expect(input).toHaveAttribute("required", "");
		await expect(submit).toBeVisible();
		const fieldBox = await measuredBox(
			page,
			`${CREATE_ROW} input[name="inbox_name"]`,
		);
		const submitBox = await measuredBox(page, `${CREATE_ROW} ${CREATE_INBOX}`);
		assert.ok(
			submitBox.x >= fieldBox.x + fieldBox.width,
			"the plus button must follow the name input",
		);
		assert.equal(Math.round(submitBox.height), Math.round(fieldBox.height));

		await input.fill("tldr");
		await submit.click();
		await expect(
			page.locator('[data-test-gmail-alert-key="inbox_name_taken"]'),
		).toBeVisible();
		await expect(page.locator(INBOX_PICKER)).toHaveAttribute("open", "");
		await expect(
			page.locator(`${CREATE_ROW} input[name="inbox_name"]`),
		).toHaveValue("tldr");

		await page
			.locator(`${CREATE_ROW} input[name="inbox_name"]`)
			.fill("science");
		await page.locator(`${CREATE_ROW} ${CREATE_INBOX}`).click();
		const science = page.locator(MAPPING).filter({
			has: page.locator(`[data-test-gmail-mapped-sender="${KALE}"]`),
		});
		await expect(
			science.locator(`[data-test-gmail-mapped-sender="${KALE}"]`),
		).toBeVisible();
		await expect(
			science.locator("[data-test-gmail-mapping-destination-label]"),
		).toHaveText("are saved to science.");
	});

	test("omits inline creation at the inbox cap while keeping existing inboxes selectable", async ({
		page,
	}, testInfo) => {
		const mappedSenders = Array.from({ length: 25 }, (_, index) => ({
			email: `news@publisher-${index}.com`,
			place: "mapped" as const,
		}));
		await openGmail(page, `cap-${testInfo.workerIndex}-${Date.now()}`, {
			senders: mappedSenders,
			discoveredSenders: [{ email: KALE, name: "Hacker Newsletter" }],
		});
		await chooseSender(page, KALE);
		await page.locator(`${INBOX_PICKER} summary`).click();
		await expect(page.locator("[data-test-gmail-inbox-limit]")).toBeVisible();
		await expect(
			page.locator("[data-test-gmail-destination-option]"),
		).toHaveCount(25);
		await expect(page.locator(CREATE_ROW)).toHaveCount(0);
		await page.locator("[data-test-gmail-destination-option]").first().click();
		await expect(page.locator("[data-test-gmail-save]")).toBeEnabled();
		await page.locator("[data-test-gmail-save]").click();
		await expect(
			page.locator(`[data-test-gmail-mapped-sender="${KALE}"]`),
		).toBeVisible();
	});

	test("keeps sender search pinned while its results scroll on a narrow screen", async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 375, height: 500 });
		const discoveredSenders = Array.from({ length: 30 }, (_, index) => ({
			email: `digest-${index}@publisher-${index}.com`,
			name: `Digest ${index}`,
		}));
		await openGmail(page, `sticky-${testInfo.workerIndex}-${Date.now()}`, {
			discoveredSenders,
		});
		await waitForBrandFonts(page, ["Inter"]);
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator(RESULTS)).toBeVisible();

		const picker = await measuredBox(page, SENDER_PICKER);
		const menu = await measuredBox(
			page,
			`${SENDER_PICKER} .gmail__picker-menu`,
		);
		const searchBefore = await measuredBox(page, "#gmail-sender-search-form");
		const firstResult =
			'[data-test-gmail-sender-option="digest-0@publisher-0.com"]';
		const firstBefore = await measuredBox(page, firstResult);
		assert.ok(
			menu.x >= 0 && menu.x + menu.width <= 375,
			"the menu must fit the viewport",
		);
		assert.ok(
			menu.y >= picker.y,
			"the menu must open below the sender trigger",
		);
		assert.ok(
			searchBefore.x >= menu.x &&
				searchBefore.x + searchBefore.width <= menu.x + menu.width,
			"search must fit inside the menu",
		);

		const scrollTop = await page
			.locator(`${SENDER_PICKER} .gmail__picker-menu`)
			.evaluate((element) => {
				element.scrollTop = element.scrollHeight;
				return element.scrollTop;
			});
		assert.ok(
			scrollTop > 0,
			"the sender results must overflow the picker menu",
		);
		const searchAfter = await measuredBox(page, "#gmail-sender-search-form");
		const firstAfter = await measuredBox(page, firstResult);
		assert.ok(
			Math.abs(searchAfter.y - searchBefore.y) <= 1,
			"the sender search must stay pinned while results scroll",
		);
		assert.ok(
			firstAfter.y < firstBefore.y,
			"sender results must scroll beneath the pinned search",
		);

		await page.keyboard.press("Escape");
		await expect(page.locator(`${SENDER_PICKER} summary`)).toBeFocused();
		await expect(page.locator(SENDER_PICKER)).not.toHaveAttribute("open");
	});
});

test.describe("Gmail sender picker without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	test("loads, searches, creates an inbox and saves its sender through ordinary forms", async ({
		page,
	}, testInfo) => {
		await openGmail(page, `nojs-${testInfo.workerIndex}-${Date.now()}`, {
			enhanced: false,
		});
		await page.locator("#gmail-load-senders-button").click();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await page.locator("#gmail-sender-search").fill("Hacker");
		await page
			.locator('#gmail-sender-search-form button[type="submit"]')
			.click();
		await page.locator(`${SENDER_PICKER} summary`).click();
		await expect(page.locator("[data-test-gmail-sender-option]")).toHaveCount(
			1,
		);
		await page.locator(`[data-test-gmail-sender-option="${KALE}"]`).click();
		await page.locator(`${INBOX_PICKER} summary`).click();
		await page.locator(`${CREATE_ROW} input[name="inbox_name"]`).fill("news");
		await page.locator(`${CREATE_ROW} ${CREATE_INBOX}`).click();
		const news = page.locator(MAPPING).filter({
			has: page.locator(`[data-test-gmail-mapped-sender="${KALE}"]`),
		});
		await expect(
			news.locator(`[data-test-gmail-mapped-sender="${KALE}"]`),
		).toBeVisible();
		await expect(
			news.locator("[data-test-gmail-mapping-destination-label]"),
		).toHaveText("are saved to news.");
	});
});
