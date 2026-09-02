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
import { neutraliseVolatileChrome } from "./readlist-nav.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const ARTICLE_TITLE = "Yes you can measure engineering | Jade Rubick";
const DESKTOP = { width: 1280, height: 900 };
const DEEP_WORK = "Deep Work";
const WEEKEND = "Weekend";

const SLOT = "[data-test-readlists-slot]";
const TOOLBAR = ".article-body__actions--sticky";
const TRIGGER = `${SLOT} [data-test-readlists-trigger]`;
const MENU = "[data-test-readlists-menu]";
const OPTION_BUTTONS = `${MENU} [data-test-assign-readlist]`;
const ROW_ONE = `${MENU} li:nth-child(1)`;
const ROW_TWO = `${MENU} li:nth-child(2)`;
const ROW_CREATE = `${MENU} [data-test-readlists-row="create"]`;
const CREATE_INPUT = `${MENU} [data-test-readlist-create-name]`;
const CREATE_SUBMIT = `${MENU} [data-test-action="readlist-create-assign"]`;
const READLIST_TAB = "[data-test-readlist]";
const NEW_READLIST = '[data-test-action="new-readlist"]';

const VOLATILE_CHROME = [
	".trial-countdown",
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	"[data-test-reader-related]",
	".crawl-bookmark",
	".reader__float-stack",
	".article-body__progress",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });
const RenamedReadlist = z.object({ slug: z.string(), label: z.string() });

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function nameReadlist(page: Page, index: number, label: string): Promise<void> {
	const slug = await page.locator(READLIST_TAB).nth(index).getAttribute("data-test-readlist");
	assert.ok(slug, `readlist tab ${index} must carry the slug the rename posts to`);
	const renamed = await page.request.post(`${BASE_URL}/queue/queues/${slug}/rename`, {
		form: { label },
	});
	assert.equal(renamed.status(), 200, `renaming readlist ${index} must answer the rename`);
	assert.equal(
		RenamedReadlist.parse(await renamed.json()).label,
		label,
		"the label must land verbatim — a case-insensitive collision would silently number it",
	);
}

async function openReadlistPicker(page: Page, stamp: string): Promise<void> {
	const email = `readlist-picker-visual-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/readlist-picker-visual-${stamp}`,
			title: ARTICLE_TITLE,
			content: "<p>Seeded body for the add-to-readlist picker baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			generatedSummary: {
				summary: "Seeded summary so the reader's summary poller settles before the capture.",
				excerpt: "Seeded summary.",
			},
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());

	await loginAs(page, email);

	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await expect(page.locator(READLIST_TAB)).toHaveCount(1);
	await page.click(NEW_READLIST);
	await expect(page.locator(READLIST_TAB)).toHaveCount(2);
	await page.click(NEW_READLIST);
	await expect(page.locator(READLIST_TAB)).toHaveCount(3);
	await nameReadlist(page, 1, DEEP_WORK);
	await nameReadlist(page, 2, WEEKEND);

	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-reader");
	await page.click(TRIGGER);
}

async function pickerOpen(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await page.mouse.move(0, DESKTOP.height - 1);
	await expect(page.locator(TOOLBAR)).toHaveCSS("transform", "none");
	await expect(page.locator(MENU)).toBeVisible();
	await expect(page.locator(OPTION_BUTTONS)).toHaveText([DEEP_WORK, WEEKEND]);
	await expect(page.locator(CREATE_INPUT)).toBeVisible();
	await expect(page.locator(OPTION_BUTTONS).first()).toHaveCSS(
		"background-color",
		"rgba(0, 0, 0, 0)",
	);
	await waitForBrandFonts(page, ["Inter"]);
}

async function bothReadlistsSitAboveTheRowThatNamesANewOne(page: Page): Promise<void> {
	const menu = await measuredBox(page, MENU);
	const trigger = await measuredBox(page, TRIGGER);
	assert.ok(
		Math.abs(menu.x + menu.width - (trigger.x + trigger.width)) <= 0.5,
		"the menu must hang from the trigger's right edge",
	);
	assert.ok(
		menu.y >= trigger.y + trigger.height,
		"the menu must open below the trigger, never over it",
	);

	const stacked = [
		["first readlist", await measuredBox(page, ROW_ONE)],
		["second readlist", await measuredBox(page, ROW_TWO)],
		["create row", await measuredBox(page, ROW_CREATE)],
	] as const;
	for (let i = 1; i < stacked.length; i++) {
		const [name, row] = stacked[i];
		const [aboveName, above] = stacked[i - 1];
		assert.ok(
			row.y >= above.y + above.height,
			`the ${name} must sit below the ${aboveName}, not beside it`,
		);
	}
	for (const [name, row] of stacked) {
		assert.ok(
			row.x >= menu.x && row.x + row.width <= menu.x + menu.width,
			`the ${name} must sit inside the menu horizontally`,
		);
		assert.ok(
			row.y >= menu.y && row.y + row.height <= menu.y + menu.height,
			`the ${name} must sit inside the menu vertically`,
		);
	}

	const field = await measuredBox(page, CREATE_INPUT);
	const submit = await measuredBox(page, CREATE_SUBMIT);
	assert.equal(
		Math.round(field.height),
		Math.round(submit.height),
		"the name field and its + must share one height, the way the menu's other rows do",
	);
	assert.ok(
		submit.x >= field.x + field.width,
		"the + must follow the name field on one line, not wrap below it",
	);
}

function checkpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: pickerOpen,
		geometry: bothReadlistsSitAboveTheRowThatNamesANewOne,
		target: MENU,
		capture: "element",
		pinnedText: [],
	};
}

const READLIST_PICKER_OPEN_LIGHT = checkpoint("readlist-picker-open-light");
const READLIST_PICKER_OPEN_DARK = checkpoint("readlist-picker-open-dark");

test.describe("Add-to-readlist picker", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("offers every readlist the article is not in, then a row to name a new one (light)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openReadlistPicker(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, READLIST_PICKER_OPEN_LIGHT);
	});

	test("offers every readlist the article is not in, then a row to name a new one (dark)", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openReadlistPicker(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, READLIST_PICKER_OPEN_DARK);
	});
});
