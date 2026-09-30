import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { captureCheckpoint, expect, measuredBox, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_TIMESTAMP = "2026-09-01T00:00:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const WIDTHS = [
	{ name: "desktop", viewport: DESKTOP },
	{ name: "mobile", viewport: { width: 390, height: 844 } },
] as const;
const THEMES = ["light", "dark"] as const;
const VOLATILE_CHROME = [".offline-banner", "[data-test-extension-suggestion-banner]", "[data-test-changelog-banner]"];

const MAIN = "main.gmail";
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const SENDER_MENU = `${SENDER_PICKER} .gmail__picker-menu`;
const RESULTS = "[data-test-gmail-sender-results]";
const SENDER_OPTION = "[data-test-gmail-sender-option]";
const SENDER_OPTION_NAME = "[data-test-gmail-sender-option-name]";
const SEARCH = "#gmail-sender-search";
const SENDER_CHOICE = "#gmail-sender-choice";
const READLIST_PICKER = "[data-test-gmail-readlist-picker]";

const TLDR = { email: "dan@tldr.tech", name: "TLDR" };
const BREW = { email: "crew@morningbrew.com", name: "Morning Brew" };
const POINTER = { email: "suraj@pointer.io" };
const KALE = { email: "kale@hackernewsletter.com", name: "Hacker Newsletter" };

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

type CatalogMode = "available" | "unavailable";
type Newsletter = { email: string; name?: string };

interface PickerSeed {
	catalogMode: CatalogMode;
	approved: readonly Newsletter[];
	discovered: readonly Newsletter[];
}

async function seedCatalog(
	page: Page,
	input: { namespace: string; mode: CatalogMode; approved: readonly Newsletter[] },
): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace: input.namespace,
			mode: input.mode,
			records: input.approved.map((newsletter) => ({
				from: newsletter.email,
				name: newsletter.name,
				status: "approved",
				evidence: [],
				createdAt: CATALOG_TIMESTAMP,
				updatedAt: CATALOG_TIMESTAMP,
			})),
		},
	});
	assert.equal(seeded.status(), 201, "the newsletter catalog seed must be accepted");
}

async function openGmail(page: Page, input: { stamp: string; seed: PickerSeed }): Promise<string> {
	const namespace = `gmail-picker-visual-${input.stamp}`;
	await page.context().addCookies([{ name: CATALOG_COOKIE, value: namespace, url: BASE_URL }]);
	await seedCatalog(page, { namespace, mode: input.seed.catalogMode, approved: input.seed.approved });
	const email = `gmail-picker-visual-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must create the reader");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: { userId, discoveredSenders: input.seed.discovered },
	});
	assert.equal(seeded.status(), 201, "the Gmail seed must connect the reader's mailbox");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/integrations/gmail?discovery=started`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-integrations-gmail");
	await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
	await expect(page.locator(RESULTS)).not.toHaveAttribute("hx-get");
	return namespace;
}

async function openSenderPicker(page: Page): Promise<void> {
	await page.locator(`${SENDER_PICKER} summary`).click();
	await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
	await expect(page.locator(SEARCH)).toBeFocused();
}

async function chooseSender(page: Page, email: string): Promise<void> {
	await page.locator(`[data-test-gmail-sender-option="${email}"]`).click();
	await expect(page.locator(SENDER_CHOICE)).toContainText(email);
	await expect(page.locator(READLIST_PICKER)).toBeVisible();
}

async function resultsListed(page: Page, input: { state: string; options: number; named: number }): Promise<void> {
	await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
	await expect(page.locator(RESULTS)).toHaveAttribute("data-results-state", input.state);
	await expect(page.locator(SENDER_OPTION)).toHaveCount(input.options);
	await expect(page.locator(`${SENDER_OPTION} ${SENDER_OPTION_NAME}`)).toHaveCount(input.named);
}

async function noSidewaysScroll(page: Page): Promise<void> {
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the Gmail page must never scroll sideways");
}

async function menuFitsInsidePage(page: Page): Promise<void> {
	await noSidewaysScroll(page);
	const main = await measuredBox(page, MAIN);
	const trigger = await measuredBox(page, `${SENDER_PICKER} summary`);
	const menu = await measuredBox(page, SENDER_MENU);
	assert.ok(menu.y >= trigger.y + trigger.height, "the sender menu must open below its trigger");
	assert.ok(
		Math.abs(menu.x - trigger.x) <= 0.5 && Math.abs(menu.width - trigger.width) <= 0.5,
		"the sender menu must hang flush under its trigger",
	);
	assert.ok(menu.y + menu.height <= main.y + main.height, "the sender menu must stay inside the captured page body");
}

async function captureMatrix(
	page: Page,
	input: { state: string; settled: (page: Page) => Promise<void>; geometry: (page: Page) => Promise<void> },
): Promise<void> {
	for (const width of WIDTHS) {
		await fitViewportToPage(page, width.viewport);
		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await captureCheckpoint(page, {
				name: `gmail-picker-${input.state}-${width.name}-${theme}`,
				settled: async (settling) => {
					await settling.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
					await settling.mouse.move(0, 0);
					await input.settled(settling);
				},
				geometry: input.geometry,
				target: MAIN,
				capture: "element",
				pinnedText: [],
			});
		}
	}
	await page.setViewportSize(DESKTOP);
}

test.describe("GMail Newsletters sender picker", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("opens on approved newsletters and shows a chosen newsletter with or without a catalog name", async ({
		page,
	}, testInfo) => {
		await openGmail(page, {
			stamp: `named-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: [TLDR, BREW, POINTER], discovered: [TLDR, BREW, POINTER, KALE] },
		});

		await captureMatrix(page, {
			state: "closed",
			settled: async (settling) => {
				await expect(settling.locator(SENDER_PICKER)).not.toHaveAttribute("open");
				await expect(settling.locator(RESULTS)).toHaveAttribute("data-results-state", "listed");
			},
			geometry: noSidewaysScroll,
		});

		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "open",
			settled: (settling) => resultsListed(settling, { state: "listed", options: 3, named: 2 }),
			geometry: menuFitsInsidePage,
		});

		await chooseSender(page, TLDR.email);
		await captureMatrix(page, {
			state: "named-newsletter",
			settled: async (settling) => {
				await expect(settling.locator(SENDER_PICKER)).not.toHaveAttribute("open");
				await expect(settling.locator(`${SENDER_CHOICE} .gmail__choice-name`)).toHaveCount(1);
				await expect(settling.locator(`${SENDER_CHOICE} .gmail__choice-email`)).toHaveText(TLDR.email);
			},
			geometry: noSidewaysScroll,
		});

		await openSenderPicker(page);
		await chooseSender(page, POINTER.email);
		await captureMatrix(page, {
			state: "unnamed-newsletter",
			settled: async (settling) => {
				await expect(settling.locator(SENDER_PICKER)).not.toHaveAttribute("open");
				await expect(settling.locator(`${SENDER_CHOICE} .gmail__choice-name`)).toHaveCount(0);
				await expect(settling.locator(`${SENDER_CHOICE} .gmail__choice-email`)).toHaveText(POINTER.email);
			},
			geometry: noSidewaysScroll,
		});
	});

	test("finds a sender the catalog does not know, reports no matches, then browses every sender", async ({
		page,
	}, testInfo) => {
		await openGmail(page, {
			stamp: `search-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: [TLDR, BREW], discovered: [TLDR, BREW, POINTER, KALE] },
		});
		await openSenderPicker(page);

		await page.locator(SEARCH).fill("hacker");
		await captureMatrix(page, {
			state: "unknown-sender-search",
			settled: async (settling) => {
				await resultsListed(settling, { state: "listed", options: 1, named: 0 });
				await expect(settling.locator(`[data-test-gmail-sender-option="${KALE.email}"]`)).toBeVisible();
			},
			geometry: menuFitsInsidePage,
		});

		await page.locator(SEARCH).fill("zebra");
		await captureMatrix(page, {
			state: "no-matches",
			settled: (settling) => resultsListed(settling, { state: "no-matches", options: 0, named: 0 }),
			geometry: menuFitsInsidePage,
		});

		await page.locator(SEARCH).fill("");
		await expect(page.locator(RESULTS)).toHaveAttribute("data-results-state", "listed");
		await page.locator("[data-test-gmail-browse-all]").click();
		await expect(page.locator("[data-test-gmail-known-only]")).toHaveCount(1);
		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "advanced",
			settled: async (settling) => {
				await resultsListed(settling, { state: "listed", options: 4, named: 2 });
				await expect(settling.locator("[data-test-gmail-known-only]")).toBeVisible();
			},
			geometry: menuFitsInsidePage,
		});
	});

	test("offers every sender when none of the discovered senders is a known newsletter", async ({ page }, testInfo) => {
		await openGmail(page, {
			stamp: `unrecognized-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: [TLDR], discovered: [POINTER, KALE] },
		});
		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "no-recognized",
			settled: async (settling) => {
				await resultsListed(settling, { state: "no-recognized-newsletters", options: 0, named: 0 });
				await expect(settling.locator("[data-test-gmail-browse-all]")).toBeVisible();
			},
			geometry: menuFitsInsidePage,
		});
	});

	test("says no senders were discovered for a mailbox with none", async ({ page }, testInfo) => {
		await openGmail(page, {
			stamp: `undiscovered-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: [TLDR], discovered: [] },
		});
		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "no-discovered-senders",
			settled: (settling) => resultsListed(settling, { state: "no-discovered-senders", options: 0, named: 0 }),
			geometry: menuFitsInsidePage,
		});
	});

	test("caps the list at 100 newsletters and asks the reader to refine the search", async ({ page }, testInfo) => {
		const digests = Array.from({ length: 101 }, (_, index) => {
			const issue = String(index).padStart(3, "0");
			return { email: `digest-${issue}@weekly-digests.com`, name: `Weekly Digest ${issue}` };
		});
		await openGmail(page, {
			stamp: `limit-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "available", approved: digests, discovered: digests },
		});
		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "result-limit",
			settled: async (settling) => {
				await resultsListed(settling, { state: "limited", options: 100, named: 100 });
				const menu = settling.locator(SENDER_MENU);
				await menu.evaluate((element) => {
					element.scrollTop = element.scrollHeight;
				});
				await expect(settling.locator("[data-test-gmail-refine-search]")).toBeInViewport();
			},
			geometry: menuFitsInsidePage,
		});
	});

	test("offers a retry when newsletter suggestions are unavailable, and recovers once the catalog answers", async ({
		page,
	}, testInfo) => {
		const namespace = await openGmail(page, {
			stamp: `unavailable-${testInfo.workerIndex}-${Date.now()}`,
			seed: { catalogMode: "unavailable", approved: [TLDR], discovered: [TLDR, KALE] },
		});
		await openSenderPicker(page);
		await captureMatrix(page, {
			state: "catalog-unavailable",
			settled: async (settling) => {
				await resultsListed(settling, { state: "catalog-unavailable", options: 0, named: 0 });
				await expect(settling.locator("[data-test-gmail-suggestions-retry]")).toBeVisible();
				await expect(settling.locator("[data-test-gmail-browse-all]")).toBeVisible();
			},
			geometry: menuFitsInsidePage,
		});

		await seedCatalog(page, { namespace, mode: "available", approved: [TLDR] });
		await page.locator("[data-test-gmail-suggestions-retry]").click();
		await expect(page.locator(RESULTS)).toHaveAttribute("data-results-state", "listed");
		await openSenderPicker(page);
		await expect(page.locator(`[data-test-gmail-sender-option="${TLDR.email}"] ${SENDER_OPTION_NAME}`)).toHaveCount(1);
	});
});
