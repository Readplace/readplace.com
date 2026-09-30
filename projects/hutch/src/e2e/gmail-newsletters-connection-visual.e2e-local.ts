import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { captureCheckpoint, expect, test, type VisualCheckpoint } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { fitViewportToPage } from "./fit-viewport-to-page";
import { serveGmailStepScreenshots, waitForGmailStepScreenshots } from "./gmail-step-screenshots";
import { clickAndWaitForPageReload } from "./page-interactions";
import { pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CATALOG_COOKIE = "e2e_catalog_ns";
const CATALOG_TIMESTAMP = "2026-09-01T00:00:00.000Z";
const TLDR = "dan@tldr.tech";
const BREW = "crew@morningbrew.com";
const PINNED_GATEWAY_ADDRESS = "gmail-a1b2c3@read.place";
const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

const WIDTHS = {
	desktop: { width: 1280, height: 900 },
	mobile: { width: 390, height: 844 },
} as const;
type Width = keyof typeof WIDTHS;
type Theme = "light" | "dark";

const GMAIL_MAIN = "main.gmail";
const INTEGRATIONS_MAIN = "main.integrations";
const CONFIRMATION_EXHAUSTED_POLL = "100";

interface Scenario {
	state: string;
	target: string;
	open: (page: Page, stamp: string) => Promise<void>;
	settled: (page: Page) => Promise<void>;
	pinnedText: VisualCheckpoint["pinnedText"];
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

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await clickAndWaitForPageReload(page, page.locator('[data-test-form="login"] button[type="submit"]'));
	await page.waitForSelector("body.page-readlist");
}

async function signInWithGmail(page: Page, input: { stamp: string; seed: object | undefined }): Promise<void> {
	await seedApprovedNewsletters(page, `gmail-connection-${input.stamp}`);
	const email = `gmail-connection-${input.stamp}@example.com`;
	const userId = await createUser(page, email);
	if (input.seed !== undefined) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, { data: { userId, ...input.seed } });
		assert.equal(seeded.status(), 201, "the Gmail fixture must accept the connection seed");
	}
	await loginAs(page, email);
}

async function holdConfirmationPolls(page: Page): Promise<void> {
	await page.route("**/integrations/gmail/status?**", (route) => route.fulfill({ status: 204 }));
}

async function exhaustConfirmationPolls(page: Page): Promise<void> {
	await page.route("**/integrations/gmail/status?**", (route) => {
		const url = new URL(route.request().url());
		url.searchParams.set("poll", CONFIRMATION_EXHAUSTED_POLL);
		return route.continue({ url: url.href });
	});
}

async function openGmailPage(page: Page, path: string): Promise<void> {
	await serveGmailStepScreenshots(page);
	await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-integrations-gmail");
}

async function openIntegrations(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/integrations`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-integrations");
}

async function removeVolatileChrome(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
	});
}

async function gmailStateShown(page: Page, state: string): Promise<void> {
	await expect(page.locator(`[data-test-gmail-state="${state}"]`)).toBeVisible();
	await removeVolatileChrome(page);
}

async function forwardingStepShown(page: Page, input: { state: string; poll: string }): Promise<void> {
	await gmailStateShown(page, input.state);
	await expect(page.locator("[data-test-gmail-poll]")).toHaveText(input.poll);
	await expect(page.locator("[data-test-gmail-copy]")).toBeVisible();
	await waitForGmailStepScreenshots(page);
}

async function integrationStatusShown(page: Page, status: string): Promise<void> {
	await expect(page.locator(`[data-test-integration="gmail"] [data-test-integration-status="${status}"]`)).toBeVisible();
	await removeVolatileChrome(page);
}

const GATEWAY_PIN = [{ selector: "[data-test-gmail-address]", text: PINNED_GATEWAY_ADDRESS }];

const CONNECTED_SEED = {
	connection: "connected",
	discoveryState: "complete",
	discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW, name: "Morning Brew" }],
	discoveryCheckedMessages: 1_250,
	readlists: ["Tech"],
	mappings: [{ destination: "readlist", email: TLDR, readlist: "Tech" }],
};

const SCENARIOS: readonly Scenario[] = [
	{
		state: "disconnected",
		target: INTEGRATIONS_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: undefined });
			await openIntegrations(page);
		},
		settled: (page) => integrationStatusShown(page, "disconnected"),
		pinnedText: [],
	},
	{
		state: "setup",
		target: GMAIL_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: { connection: "setup" } });
			await holdConfirmationPolls(page);
			await openGmailPage(page, "/integrations/gmail?notice=connected");
		},
		settled: async (page) => {
			await expect(page.locator('[data-test-alert="connected"]')).toBeVisible();
			await forwardingStepShown(page, {
				state: "awaiting-confirmation",
				poll: "Watching for Gmail to confirm the forwarding address.",
			});
		},
		pinnedText: GATEWAY_PIN,
	},
	{
		state: "confirmation-waiting",
		target: GMAIL_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: { connection: "awaiting-confirmation" } });
			await holdConfirmationPolls(page);
			await openGmailPage(page, "/integrations/gmail?discovery=started");
		},
		settled: (page) =>
			forwardingStepShown(page, {
				state: "awaiting-confirmation",
				poll: "Watching for Gmail to confirm the forwarding address.",
			}),
		pinnedText: GATEWAY_PIN,
	},
	{
		state: "confirmation-failed",
		target: GMAIL_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: { connection: "confirm-failed" } });
			await holdConfirmationPolls(page);
			await openGmailPage(page, "/integrations/gmail?discovery=started");
		},
		settled: async (page) => {
			await expect(page.locator('[data-test-alert="confirm_failed"]')).toBeVisible();
			await forwardingStepShown(page, {
				state: "confirm-failed",
				poll: "Watching for Gmail to send a new confirmation.",
			});
		},
		pinnedText: GATEWAY_PIN,
	},
	{
		state: "confirmation-exhausted",
		target: GMAIL_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: { connection: "confirm-exhausted" } });
			await exhaustConfirmationPolls(page);
			await openGmailPage(page, "/integrations/gmail?discovery=started");
		},
		settled: async (page) => {
			await expect(page.locator("[data-test-gmail-poll]:not([hx-get])")).toBeAttached();
			await forwardingStepShown(page, {
				state: "awaiting-confirmation",
				poll: "Still waiting. If you haven't added the address in Gmail yet, add it and refresh this page. If you added it more than a few minutes ago, remove it in Gmail and add it again so Google sends a new confirmation.",
			});
		},
		pinnedText: GATEWAY_PIN,
	},
	{
		state: "connected",
		target: GMAIL_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: CONNECTED_SEED });
			await openGmailPage(page, "/integrations/gmail?discovery=started");
		},
		settled: async (page) => {
			await gmailStateShown(page, "filtering");
			await expect(page.locator(`[data-test-gmail-mapping-row="${TLDR}"] [data-test-gmail-forwarding-state="live"]`)).toBeVisible();
			await expect(page.locator("[data-test-gmail-step]")).toHaveCount(0);
		},
		pinnedText: [],
	},
	{
		state: "revoked",
		target: GMAIL_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: { ...CONNECTED_SEED, connection: "revoked" } });
			await openGmailPage(page, "/integrations/gmail?discovery=started");
		},
		settled: async (page) => {
			await gmailStateShown(page, "revoked");
			await expect(page.locator("[data-test-gmail-reconnect-button]")).toBeVisible();
			await expect(page.locator("[data-test-gmail-senders]")).toHaveCount(0);
		},
		pinnedText: [],
	},
	{
		state: "missing-permission",
		target: GMAIL_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: { ...CONNECTED_SEED, grantedScopes: ["settings"] } });
			await openGmailPage(page, "/integrations/gmail?discovery=started");
		},
		settled: async (page) => {
			await gmailStateShown(page, "filtering");
			await expect(page.locator("[data-test-gmail-metadata-reconnect-button]")).toBeVisible();
			await expect(page.locator("[data-test-gmail-senders]")).toHaveCount(0);
		},
		pinnedText: [],
	},
	{
		state: "disconnecting",
		target: INTEGRATIONS_MAIN,
		open: async (page, stamp) => {
			await signInWithGmail(page, { stamp, seed: CONNECTED_SEED });
			await openGmailPage(page, "/integrations/gmail?discovery=started");
			await clickAndWaitForPageReload(page, page.locator("[data-test-gmail-disconnect]"));
		},
		settled: async (page) => {
			await expect(page.locator('[data-test-alert="gmail_disconnected"]')).toBeVisible();
			await integrationStatusShown(page, "disconnecting");
			await expect(page.locator('[data-test-integration="gmail"] [data-test-integration-action]')).toHaveCount(0);
		},
		pinnedText: [],
	},
];

function checkpoint(input: { scenario: Scenario; width: Width; theme: Theme }): VisualCheckpoint {
	const { scenario, width, theme } = input;
	return {
		name: `gmail-connection-${scenario.state}-${width}-${theme}`,
		target: scenario.target,
		capture: "element",
		pinnedText: scenario.pinnedText,
		settled: async (page) => {
			await scenario.settled(page);
			await fitViewportToPage(page, WIDTHS[width]);
		},
		geometry: async (page) => {
			assert.equal(await page.evaluate(pageOverflowsSideways), false, "the page must not scroll sideways");
		},
	};
}

test.describe("GMail Newsletters connection states", () => {
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
