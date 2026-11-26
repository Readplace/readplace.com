import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
} from "@packages/e2e-harness";
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
const ROUTE_GAP_PX = 8;

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const WIDTHS = [
	{ name: "desktop", viewport: { width: 1280, height: 900 } },
	{ name: "mobile", viewport: { width: 390, height: 844 } },
] as const;
const THEMES = ["light", "dark"] as const;

async function openMark(
	page: Page,
	input: { stamp: string; modify: boolean; query?: string },
): Promise<void> {
	const namespace = `gmail-mark-${input.stamp}`;
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

	const email = `gmail-mark-${input.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId,
			grantedScopes: input.modify ? ["settings", "metadata", "modify"] : ["settings", "metadata"],
			readlists: ["Tech"],
			discoveredSenders: [
				{ email: TLDR, name: "TLDR" },
				{ email: BREW, name: "Morning Brew" },
			],
			mappings: [{ destination: "readlist", email: TLDR, readlist: "Tech" }],
		},
	});
	assert.equal(seeded.status(), 201, `the gmail state seed must be accepted: ${await seeded.text()}`);

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
		assert.ok(viewport, "mark checkpoints run with an explicit viewport");
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
	input: { state: string; target: string },
): Promise<void> {
	for (const width of WIDTHS) {
		await fitViewportToPage(page, width.viewport);
		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await captureCheckpoint(page, {
				name: `gmail-mark-${input.state}-${width.name}-${theme}`,
				settled: settledGmailPage,
				geometry: fitsViewport(input.target),
				target: input.target,
				capture: "element",
				pinnedText: [],
			});
		}
	}
	await page.setViewportSize(WIDTHS[0].viewport);
}

test.describe("Automatic Gmail original updates", () => {
	test.use({ timezoneId: "UTC", viewport: WIDTHS[0].viewport });

	test("offers one account-level reconnect on an older grant", async ({ page }, testInfo) => {
		await openMark(page, { stamp: `reconnect-${testInfo.workerIndex}-${Date.now()}`, modify: false });
		const prompt = "[data-test-gmail-modify-reconnect]";
		await expect(page.locator(prompt).getByRole("button", { name: "Reconnect Gmail" })).toHaveCount(1);
		await captureMatrix(page, { state: "reconnect", target: prompt });
	});

	test("saved sender cards show the unread-import action with modify access", async ({ page }, testInfo) => {
		await openMark(page, { stamp: `connected-${testInfo.workerIndex}-${Date.now()}`, modify: true });
		await expect(page.locator("[data-test-gmail-modify-reconnect]")).toHaveCount(0);
		await expect(page.locator(MAPPINGS).getByRole("button", { name: "Import unread messages" })).toBeVisible();
		await captureMatrix(page, { state: "connected", target: MAPPINGS });
	});
});
