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
import { serveGmailStepScreenshots, waitForGmailStepScreenshots } from "./gmail-step-screenshots";
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
const RETRY_NOTICE = '[data-test-alert="filter_retry_requested"]';
const MAPPINGS = "#gmail-mappings";
const FILTER_ACTION_RETRY = '[data-test-gmail-filter-action="retry"]';

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

type SeedMapping = { destination: "readlist"; email: string; readlist: string; pending?: boolean };

interface ForwardingSeed {
	connection?: "awaiting-confirmation" | "connected";
	filter?: "live" | "updating" | "failed-too-long" | "failed-rejected";
	mappings: SeedMapping[];
}

async function openForwarding(page: Page, input: { stamp: string; seed: ForwardingSeed }): Promise<void> {
	const namespace = `gmail-forwarding-${input.stamp}`;
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

	const email = `gmail-forwarding-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId,
			connection: input.seed.connection ?? "connected",
			filter: input.seed.filter ?? "live",
			readlists: ["Tech"],
			discoveredSenders: [
				{ email: TLDR, name: "TLDR" },
				{ email: BREW, name: "Morning Brew" },
			],
			mappings: input.seed.mappings,
		},
	});
	assert.equal(seeded.status(), 201, "the gmail state seed must be accepted");

	await page.addInitScript(blockTimerPolls);
	await serveGmailStepScreenshots(page);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	await page.goto(`${BASE_URL}/integrations/gmail?discovery=started`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(GMAIL_PAGE);
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
		assert.ok(viewport, "forwarding checkpoints run with an explicit viewport");
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
				name: `gmail-forwarding-${input.state}-${width.name}-${theme}`,
				settled: settledGmailPage,
				geometry: fitsViewport(input.target),
				target: input.target,
				capture: input.capture,
				pinnedText: [],
			});
		}
	}
}

function forwardingState(page: Page, sender: string) {
	return page.locator(`[data-test-gmail-mapping-row="${sender}"] [data-test-gmail-forwarding-state]`);
}

function stampFor(label: string): string {
	return `${label}-${test.info().workerIndex}-${Date.now()}`;
}

test.describe("GMail Newsletters forwarding states", () => {
	test.use({ timezoneId: "UTC", viewport: WIDTHS[0].viewport });

	test("pending: a newly mapped newsletter waits for Gmail beside one already forwarding", async ({ page }) => {
		await openForwarding(page, {
			stamp: stampFor("pending"),
			seed: {
				mappings: [
					{ destination: "readlist", email: TLDR, readlist: "Tech" },
					{ destination: "readlist", email: BREW, readlist: "All", pending: true },
				],
			},
		});
		await expect(forwardingState(page, BREW)).toHaveAttribute("data-test-gmail-forwarding-state", "pending");
		await expect(forwardingState(page, TLDR)).toHaveAttribute("data-test-gmail-forwarding-state", "live");
		await expect(page.locator("[data-test-gmail-filter-state]")).toHaveAttribute("data-test-gmail-filter-state", "updating");
		await expect(page.locator(FILTER_ACTION_RETRY)).toBeVisible();

		await captureMatrix(page, { state: "pending", target: MAPPINGS, capture: "element" });
	});

	test("live: every mapped newsletter is forwarding", async ({ page }) => {
		await openForwarding(page, {
			stamp: stampFor("live"),
			seed: {
				mappings: [
					{ destination: "readlist", email: TLDR, readlist: "Tech" },
					{ destination: "readlist", email: BREW, readlist: "All" },
				],
			},
		});
		await expect(forwardingState(page, TLDR)).toHaveAttribute("data-test-gmail-forwarding-state", "live");
		await expect(forwardingState(page, BREW)).toHaveAttribute("data-test-gmail-forwarding-state", "live");
		await expect(page.locator("[data-test-gmail-filter-state]")).toHaveAttribute("data-test-gmail-filter-state", "live");
		await expect(page.locator(FILTER_ACTION_RETRY)).toHaveCount(0);

		await captureMatrix(page, { state: "live", target: MAPPINGS, capture: "element" });
	});

	test("failed: Gmail's forwarding rule for a readlist ran out of room", async ({ page }) => {
		await openForwarding(page, {
			stamp: stampFor("failed-too-long"),
			seed: {
				filter: "failed-too-long",
				mappings: [
					{ destination: "readlist", email: TLDR, readlist: "Tech" },
					{ destination: "readlist", email: BREW, readlist: "Tech" },
				],
			},
		});
		await expect(forwardingState(page, TLDR)).toHaveAttribute("data-test-gmail-forwarding-state", "failed");
		await expect(page.locator('[data-test-alert="gmail-filter"]')).toContainText("Tech");
		await expect(page.locator(FILTER_ACTION_RETRY)).toBeVisible();

		await captureMatrix(page, { state: "failed", target: MAPPINGS, capture: "element" });
	});

	test("failed: Gmail rejected the forwarding rule", async ({ page }) => {
		await openForwarding(page, {
			stamp: stampFor("failed-rejected"),
			seed: {
				filter: "failed-rejected",
				mappings: [{ destination: "readlist", email: TLDR, readlist: "Tech" }],
			},
		});
		await expect(forwardingState(page, TLDR)).toHaveAttribute("data-test-gmail-forwarding-state", "failed");
		await expect(page.locator('[data-test-alert="gmail-filter"]')).toBeVisible();

		await captureMatrix(page, { state: "failed-rejected", target: MAPPINGS, capture: "element" });
	});

	test("retry: asking Gmail to take the rule again says it is updating", async ({ page }) => {
		await openForwarding(page, {
			stamp: stampFor("retry"),
			seed: {
				filter: "failed-rejected",
				mappings: [{ destination: "readlist", email: TLDR, readlist: "Tech" }],
			},
		});
		await page.locator(FILTER_ACTION_RETRY).click();
		await expect(page.locator(RETRY_NOTICE)).toBeVisible();
		await expect(forwardingState(page, TLDR)).toHaveAttribute("data-test-gmail-forwarding-state", "failed");

		await captureMatrix(page, { state: "retry-notice", target: RETRY_NOTICE, capture: "element" });
		await captureMatrix(page, { state: "retry", target: MAPPINGS, capture: "element" });
	});

	test("confirmation required: mappings wait until Gmail confirms the forwarding address", async ({ page }) => {
		await openForwarding(page, {
			stamp: stampFor("confirmation-required"),
			seed: {
				connection: "awaiting-confirmation",
				mappings: [
					{ destination: "readlist", email: TLDR, readlist: "Tech" },
					{ destination: "readlist", email: BREW, readlist: "All" },
				],
			},
		});
		await expect(forwardingState(page, TLDR)).toHaveAttribute(
			"data-test-gmail-forwarding-state",
			"confirmation-required",
		);
		await expect(page.locator("[data-test-gmail-filter-state]")).toHaveAttribute(
			"data-test-gmail-filter-state",
			"waiting-confirmation",
		);
		await waitForGmailStepScreenshots(page);

		await captureMatrix(page, { state: "confirmation-required", target: MAPPINGS, capture: "element" });
	});
});
