import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { captureCheckpoint, expect, measuredBox, test, type VisualCheckpoint } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { clickAndWaitForPageReload } from "./page-interactions";
import { pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_TIMESTAMP = "2026-09-01T00:00:00.000Z";
const TLDR = "dan@tldr.tech";
const BREW = "crew@morningbrew.com";
const KALE = "kale@hackernewsletter.com";
const DISCOVERED_SENDERS = [
	{ email: TLDR, name: "TLDR" },
	{ email: BREW, name: "Morning Brew" },
	{ email: KALE, name: "Hacker Newsletter" },
];
const DISCOVERY_EXHAUSTED_POLL = "260";
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

const WIDTHS = {
	desktop: { width: 1280, height: 900 },
	mobile: { width: 390, height: 844 },
} as const;
type Width = keyof typeof WIDTHS;
type Theme = "light" | "dark";

const GMAIL_MAIN = "main.gmail";
const SENDER_PICKER = "[data-test-gmail-sender-picker]";
const PICKER_MENU = `${SENDER_PICKER} .gmail__picker-menu`;
const DISCOVERY_STATUS = "[data-test-gmail-discovery-status]";
const RESULTS = "[data-test-gmail-sender-results]";
const LOAD_BUTTON = "#gmail-load-senders-button";

interface Scenario {
	state: string;
	open: (page: Page, stamp: string) => Promise<void>;
	settled: (page: Page) => Promise<void>;
	pickerOpen: boolean;
}

async function createUser(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must create the reader");
	return CreatedUser.parse(await response.json()).userId;
}

async function seedApprovedNewsletters(page: Page, namespace: string): Promise<void> {
	await page.context().addCookies([{ name: CATALOG_COOKIE, value: namespace, url: BASE_URL }]);
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace,
			records: [
				{ from: TLDR, name: "TLDR", status: "approved", evidence: [], createdAt: CATALOG_TIMESTAMP, updatedAt: CATALOG_TIMESTAMP },
				{ from: BREW, name: "Morning Brew", status: "approved", evidence: [], createdAt: CATALOG_TIMESTAMP, updatedAt: CATALOG_TIMESTAMP },
			],
		},
	});
	assert.equal(seeded.status(), 201, "the catalog fixture must accept the approved newsletters");
}

async function signInWithGmail(page: Page, input: { stamp: string; seed: object }): Promise<void> {
	await seedApprovedNewsletters(page, `gmail-discovery-${input.stamp}`);
	const email = `gmail-discovery-${input.stamp}@example.com`;
	const userId = await createUser(page, email);
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: { userId, connection: "connected", ...input.seed },
	});
	assert.equal(seeded.status(), 201, "the Gmail fixture must accept the discovery seed");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await clickAndWaitForPageReload(page, page.locator('[data-test-form="login"] button[type="submit"]'));
	await page.waitForSelector("body.page-readlist");
}

async function holdDiscoveryPolls(page: Page): Promise<void> {
	await page.route("**/newsletters/gmail/senders?**", (route) => {
		const polling = new URL(route.request().url()).searchParams.has("poll");
		return polling ? route.fulfill({ status: 204 }) : route.continue();
	});
}

async function openGmailPage(page: Page, path: string): Promise<void> {
	await holdDiscoveryPolls(page);
	await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-integrations-gmail");
	await expect(page.locator("html")).toHaveAttribute("data-gmail-picker-attached", "");
}

async function openPicker(page: Page): Promise<void> {
	await page.locator(`${SENDER_PICKER} > summary`).click();
	await expect(page.locator(SENDER_PICKER)).toHaveAttribute("open", "");
	await expect(page.locator("#gmail-sender-search")).toBeFocused();
}

async function discoveryShown(
	page: Page,
	input: { state: string; status: string; results: string; loadLabel: string },
): Promise<void> {
	await expect(page.locator(DISCOVERY_STATUS)).toHaveAttribute("data-discovery-state", input.state);
	await expect(page.locator(DISCOVERY_STATUS)).toHaveText(input.status);
	await expect(page.locator(RESULTS)).toHaveAttribute("data-results-state", input.results);
	await expect(page.locator(LOAD_BUTTON)).toHaveText(input.loadLabel);
	await expect(page.locator("form.htmx-request")).toHaveCount(0);
	await page.mouse.move(0, 0);
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
		document.querySelector(".newer-version-banner")?.remove();
	});
}

async function openWithPicker(page: Page, input: { stamp: string; seed: object; path: string }): Promise<void> {
	await signInWithGmail(page, input);
	await openGmailPage(page, input.path);
	await openPicker(page);
}

const SCENARIOS: readonly Scenario[] = [
	{
		state: "idle",
		pickerOpen: true,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: { discoveryState: "idle" } });
			const autoStart = page.waitForResponse("**/newsletters/gmail/discovery/start**");
			await page.route("**/newsletters/gmail/discovery/start**", (route) => route.fulfill({ status: 204 }));
			await openGmailPage(page, "/newsletters/gmail");
			await autoStart;
			await openPicker(page);
		},
		settled: (page) =>
			discoveryShown(page, {
				state: "idle",
				status: "Load senders from your Gmail account to choose one.",
				results: "no-discovered-senders",
				loadLabel: "Load senders",
			}),
	},
	{
		state: "loading",
		pickerOpen: true,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: { discoveryState: "idle" } });
			await openGmailPage(page, "/newsletters/gmail");
			await expect(page.locator(LOAD_BUTTON)).toHaveText("Checking…");
			await openPicker(page);
		},
		settled: (page) =>
			discoveryShown(page, {
				state: "idle",
				status: "Checking… Checked 0 messages",
				results: "no-discovered-senders",
				loadLabel: "Checking…",
			}),
	},
	{
		state: "partial",
		pickerOpen: true,
		open: (page, stamp) =>
			openWithPicker(page, {
				stamp,
				seed: { discoveryState: "running", discoveredSenders: DISCOVERED_SENDERS, discoveryCheckedMessages: 1_234 },
				path: "/newsletters/gmail?discovery=started",
			}),
		settled: (page) =>
			discoveryShown(page, {
				state: "running",
				status: "Checking… Checked 1,234 messages",
				results: "listed",
				loadLabel: "Checking…",
			}),
	},
	{
		state: "history-checking",
		pickerOpen: true,
		open: (page, stamp) =>
			openWithPicker(page, {
				stamp,
				seed: {
					discoveryState: "running",
					discoveryMode: "history",
					discoveredSenders: DISCOVERED_SENDERS,
					discoveryCheckedMessages: 5_678,
				},
				path: "/newsletters/gmail?discovery=started",
			}),
		settled: (page) =>
			discoveryShown(page, {
				state: "running",
				status: "Checking for new messages · Checked 5,678 messages",
				results: "listed",
				loadLabel: "Checking for new messages…",
			}),
	},
	{
		state: "complete",
		pickerOpen: true,
		open: (page, stamp) =>
			openWithPicker(page, {
				stamp,
				seed: { discoveryState: "complete", discoveredSenders: DISCOVERED_SENDERS, discoveryCheckedMessages: 12_345 },
				path: "/newsletters/gmail?discovery=started",
			}),
		settled: (page) =>
			discoveryShown(page, {
				state: "complete",
				status: "3 senders discovered · Checked 12,345 messages",
				results: "listed",
				loadLabel: "Load senders",
			}),
	},
	{
		state: "no-discovered-senders",
		pickerOpen: true,
		open: (page, stamp) =>
			openWithPicker(page, {
				stamp,
				seed: { discoveryState: "complete", discoveredSenders: [], discoveryCheckedMessages: 250 },
				path: "/newsletters/gmail?discovery=started",
			}),
		settled: async (page) => {
			await expect(page.locator("[data-test-gmail-results-message]")).toHaveText("No senders discovered yet.");
			await discoveryShown(page, {
				state: "complete",
				status: "0 senders discovered · Checked 250 messages",
				results: "no-discovered-senders",
				loadLabel: "Load senders",
			});
		},
	},
	{
		state: "failure",
		pickerOpen: true,
		open: (page, stamp) =>
			openWithPicker(page, {
				stamp,
				seed: { discoveryState: "failed", discoveredSenders: DISCOVERED_SENDERS, discoveryCheckedMessages: 900 },
				path: "/newsletters/gmail?discovery=started",
			}),
		settled: (page) =>
			discoveryShown(page, {
				state: "failed",
				status: "I couldn't finish loading your Gmail senders. Your saved choices are still available. Try Load senders again.",
				results: "listed",
				loadLabel: "Load senders",
			}),
	},
	{
		state: "retry",
		pickerOpen: true,
		open: async (page, stamp) => {
			await signInWithGmail(page, {
				stamp,
				seed: { discoveryState: "failed", discoveredSenders: DISCOVERED_SENDERS, discoveryCheckedMessages: 900 },
			});
			await openGmailPage(page, "/newsletters/gmail?discovery=started");
			await expect(page.locator(DISCOVERY_STATUS)).toHaveAttribute("data-discovery-state", "failed");
			await page.locator(LOAD_BUTTON).click();
			await expect(page.locator(LOAD_BUTTON)).toHaveText("Checking…");
			await openPicker(page);
		},
		settled: (page) =>
			discoveryShown(page, {
				state: "failed",
				status: "Checking… Checked 900 messages",
				results: "listed",
				loadLabel: "Checking…",
			}),
	},
	{
		state: "reconnect",
		pickerOpen: false,
		open: async (page, stamp) => {
			await signInWithGmail(page, {
				stamp,
				seed: {
					discoveryState: "failed",
					discoveryRequiresReconnect: true,
					discoveredSenders: DISCOVERED_SENDERS,
					discoveryCheckedMessages: 900,
				},
			});
			await openGmailPage(page, "/newsletters/gmail?discovery=started");
		},
		settled: async (page) => {
			await expect(page.locator("[data-test-gmail-metadata-reconnect-button]")).toBeVisible();
			await expect(page.locator("[data-test-gmail-senders]")).toHaveCount(0);
			await page.mouse.move(0, 0);
			await page.evaluate(() => {
				document.querySelector(".offline-banner")?.remove();
				document.querySelector(".newer-version-banner")?.remove();
			});
		},
	},
	{
		state: "polling-exhausted",
		pickerOpen: true,
		open: (page, stamp) =>
			openWithPicker(page, {
				stamp,
				seed: { discoveryState: "running", discoveredSenders: DISCOVERED_SENDERS, discoveryCheckedMessages: 4_321 },
				path: `/newsletters/gmail?discovery=started&poll=${DISCOVERY_EXHAUSTED_POLL}`,
			}),
		settled: async (page) => {
			await expect(page.locator(`${RESULTS}:not([hx-get])`)).toBeAttached();
			await discoveryShown(page, {
				state: "running",
				status: "Still checking. Checked 4,321 messages so far…",
				results: "listed",
				loadLabel: "Load senders",
			});
		},
	},
];

function checkpoint(input: { scenario: Scenario; width: Width; theme: Theme }): VisualCheckpoint {
	const { scenario, width, theme } = input;
	return {
		name: `gmail-discovery-${scenario.state}-${width}-${theme}`,
		target: GMAIL_MAIN,
		capture: "element",
		pinnedText: [],
		settled: async (page) => {
			await scenario.settled(page);
			await fitViewportToPage(page, WIDTHS[width]);
		},
		geometry: async (page) => {
			assert.equal(await page.evaluate(pageOverflowsSideways), false, "the page must not scroll sideways");
			if (!scenario.pickerOpen) return;
			const main = await measuredBox(page, GMAIL_MAIN);
			const menu = await measuredBox(page, PICKER_MENU);
			assert.ok(menu.y + menu.height <= main.y + main.height, "the open sender picker must sit inside the captured page");
		},
	};
}

test.describe("GMail Newsletters sender discovery states", () => {
	test.use({ timezoneId: "UTC" });

	for (const width of ["desktop", "mobile"] as const) {
		test.describe(width, () => {
			test.use({ viewport: WIDTHS[width] });

			for (const scenario of SCENARIOS) {
				for (const theme of ["light", "dark"] as const) {
					test(`shows ${scenario.state} (${width}, ${theme})`, async ({ page }, testInfo) => {
						await page.emulateMedia({ colorScheme: theme });
						await scenario.open(page, `${scenario.state}-${width}-${theme}-${testInfo.workerIndex}-${Date.now()}`);
						await captureCheckpoint(page, checkpoint({ scenario, width, theme }));
					});
				}
			}
		});
	}
});
