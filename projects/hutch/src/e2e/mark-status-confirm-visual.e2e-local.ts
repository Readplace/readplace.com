import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const ARTICLE_TITLE = "Yes you can measure engineering | Jade Rubick";

const PANEL = '[data-test-confirm-popover="mark-status"]';
const PANEL_TITLE = `${PANEL} .confirm-popover__title`;
const PANEL_BODY = `${PANEL} .confirm-popover__body`;
const PANEL_CONFIRM = `${PANEL} [data-test-action="mark-status-confirm"]`;
const PANEL_NEVER = `${PANEL} [data-test-action="mark-status-confirm-never"]`;
const MARK_READ_TRIGGER = 'main.queue [data-test-action="mark-read"]';

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-queue");
}

async function openMarkReadConfirm(page: Page, stamp: string): Promise<void> {
	const email = `mark-status-visual-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/mark-status-confirm-visual-${stamp}`,
			title: ARTICLE_TITLE,
			content: "<p>Seeded body for the mark-as-read confirmation baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());

	await page.context().addCookies([
		{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL },
	]);
	await loginAs(page, email);

	await page.goto(`${BASE_URL}/queue?feature=queues`, { waitUntil: "domcontentloaded" });
	await page.click('[data-test-action="new-queue"]');
	await page.waitForSelector("[data-queue-rename]");

	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.click("[data-test-queues-trigger]");
	await page.click("[data-test-assign-queue]");
	await page.waitForSelector("[data-test-queue-tag]");

	await page.goto(`${BASE_URL}/queue?feature=queues`, { waitUntil: "domcontentloaded" });
	await page.click(MARK_READ_TRIGGER);
}

async function panelOpen(page: Page): Promise<void> {
	await page.waitForSelector(`${PANEL}:popover-open`);
	await waitForBrandFonts(page, ["Inter"]);
}

async function titleLeadsTheQueueListThenBothChoices(page: Page): Promise<void> {
	const panel = await measuredBox(page, PANEL);
	const stacked = [
		["title", await measuredBox(page, PANEL_TITLE)],
		["queue list", await measuredBox(page, PANEL_BODY)],
		["confirm choice", await measuredBox(page, PANEL_CONFIRM)],
		["silence choice", await measuredBox(page, PANEL_NEVER)],
	] as const;

	for (let i = 1; i < stacked.length; i++) {
		const [name, part] = stacked[i];
		const [aboveName, above] = stacked[i - 1];
		assert.ok(
			part.y >= above.y + above.height,
			`the ${name} must sit below the ${aboveName}, not beside it`,
		);
	}
	const confirm = await measuredBox(page, PANEL_CONFIRM);
	const never = await measuredBox(page, PANEL_NEVER);
	assert.equal(never.x, confirm.x, "the two choices must stack in one column");
	assert.equal(never.width, confirm.width, "the stacked choices must share the panel's width");

	for (const [name, part] of stacked) {
		assert.ok(
			part.x >= panel.x && part.x + part.width <= panel.x + panel.width,
			`the ${name} must sit inside the panel horizontally`,
		);
		assert.ok(
			part.y >= panel.y && part.y + part.height <= panel.y + panel.height,
			`the ${name} must sit inside the panel vertically`,
		);
	}
}

function checkpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: panelOpen,
		geometry: titleLeadsTheQueueListThenBothChoices,
		target: PANEL,
		capture: "element",
		pinnedText: [],
	};
}

const MARK_STATUS_CONFIRM_LIGHT = checkpoint("mark-status-confirm-light");
const MARK_STATUS_CONFIRM_DARK = checkpoint("mark-status-confirm-dark");

test.describe("Mark-as-read confirmation panel", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("names every queue the change reaches, then both answers (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openMarkReadConfirm(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await expect(page.locator(PANEL_BODY)).toContainText("My Queue, New Queue");
		await captureCheckpoint(page, MARK_STATUS_CONFIRM_LIGHT);
	});

	test("names every queue the change reaches, then both answers (dark)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openMarkReadConfirm(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, MARK_STATUS_CONFIRM_DARK);
	});
});
