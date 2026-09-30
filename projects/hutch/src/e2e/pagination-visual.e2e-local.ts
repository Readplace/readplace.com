import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { IMPORT_PAGE_SIZE } from "@packages/domain/import-session";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	snapToWholePixels,
	test,
	type VisualCheckpoint,
	waitForBrandFonts,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { READLIST_PAGE_SIZE } from "../runtime/web/pages/readlist/readlist-page-size";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const WCAG_REFLOW_MINIMUM = { width: 320, height: 800 };
const EINK_VIEWPORT = { width: 758, height: 1024 };

const CONTRAST_SENSITIVE = {
	stylePath: join(__dirname, "eink-greyscale.css"),
	threshold: 0.02,
} as const;

const READLIST_PAGES = 7;
const READLIST_ARTICLE_COUNT = READLIST_PAGE_SIZE * (READLIST_PAGES - 1) + 1;
const MIDDLE_PAGE = 4;
const IMPORTED_URL_COUNT = IMPORT_PAGE_SIZE + 1;
const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";

const CURRENT_CELL_PX = 36;
const CELL_RADIUS = "8px";
const PAGER_FONT_SIZE = "16px";

const PAGE_READLIST = "body.page-readlist";
const PAGINATION = "[data-test-pagination]";
const PAGINATION_INFO = `${PAGINATION} [data-test-pagination-info]`;
const PAGINATION_CONTROLS = `${PAGINATION} .pagination__controls`;
const PAGINATION_PAGE_ITEMS = "#readlist-pages > li";
const CURRENT_PAGE = `${PAGINATION} [data-test-pagination-pages] [aria-current="page"]`;

const IMPORT_PAGINATION = "[data-test-import-pagination]";
const IMPORT_NEXT = "[data-test-import-pagination-next]";
const IMPORT_PREV = "[data-test-import-pagination-prev]";

const VOLATILE_CHROME = [
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const THEMES = ["light", "dark"] as const;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createVerifiedUser(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await created.json()).userId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector(PAGE_READLIST);
}

async function seedSevenPages(page: Page, input: { userId: string; stamp: string }): Promise<void> {
	for (let index = 0; index < READLIST_ARTICLE_COUNT; index++) {
		const savedAt = new Date(Date.parse(SEEDED_FETCHED_AT) + index * 60_000).toISOString();
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/pagination-${input.stamp}-${index}`,
				title: `Seeded article ${index} for the pager baseline`,
				content: "<p>Seeded body for the pager baseline.</p>",
				contentFetchedAt: SEEDED_FETCHED_AT,
				savedAt,
				savedByUserId: input.userId,
				excerpt: "A fixed excerpt for the pager baseline.",
				generatedSummary: { summary: "Seeded summary.", excerpt: "A fixed excerpt for the pager baseline." },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create every pager article");
	}
}

async function openMiddleReadlistPage(page: Page, stamp: string): Promise<void> {
	const email = `pagination-readlist-${stamp}@example.com`;
	const userId = await createVerifiedUser(page, email);
	await seedSevenPages(page, { userId, stamp });
	await loginAs(page, email);
	const counts = page.waitForResponse((response) => response.url().includes("/queue/counts"));
	await page.goto(`${BASE_URL}/queue?page=${MIDDLE_PAGE}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(PAGE_READLIST);
	await counts;
}

async function neutralise(page: Page): Promise<void> {
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
}

async function readlistPagerSettled(page: Page): Promise<void> {
	await expect.poll(() => page.locator(PAGINATION_PAGE_ITEMS).count()).toBeGreaterThan(1);
	await expect(page.locator(CURRENT_PAGE)).toHaveAttribute("data-test-pagination-page", String(MIDDLE_PAGE));
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
}

async function neverScrollsSideways(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the page must never scroll sideways");
}

async function currentCellGeometry(page: Page): Promise<void> {
	const cell = await measuredBox(page, CURRENT_PAGE);
	assert.ok(
		Math.abs(cell.width - CURRENT_CELL_PX) <= 0.5 && Math.abs(cell.height - CURRENT_CELL_PX) <= 0.5,
		`the current page cell must be ${CURRENT_CELL_PX}x${CURRENT_CELL_PX}, measured ${JSON.stringify(cell)}`,
	);
	const style = await page
		.locator(CURRENT_PAGE)
		.evaluate((element) => {
			const computed = getComputedStyle(element);
			return { borderRadius: computed.borderRadius, fontSize: computed.fontSize };
		});
	assert.deepEqual(
		style,
		{ borderRadius: CELL_RADIUS, fontSize: PAGER_FONT_SIZE },
		"the current page cell must round its corners at the shared radius and set the pager's 16px type",
	);
}

async function readlistPagerGeometry(page: Page): Promise<void> {
	await neverScrollsSideways(page);
	await currentCellGeometry(page);
}

async function infoAboveControls(page: Page): Promise<void> {
	const info = await measuredBox(page, PAGINATION_INFO);
	const controls = await measuredBox(page, PAGINATION_CONTROLS);
	assert.ok(
		info.y + info.height <= controls.y + 0.5,
		`on a phone the info line must sit on its own row above the controls, measured info=${JSON.stringify(info)} controls=${JSON.stringify(controls)}`,
	);
}

async function readlistPagerPhoneGeometry(page: Page): Promise<void> {
	await readlistPagerGeometry(page);
	await infoAboveControls(page);
}

function pagerCheckpoint(input: {
	name: string;
	target: string;
	settled: (page: Page) => Promise<void>;
	geometry: (page: Page) => Promise<void>;
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: input.settled,
		geometry: input.geometry,
		target: input.target,
		capture: "element",
		pinnedText: [],
	};
}

async function captureInGreyscale(page: Page, name: string): Promise<void> {
	await readlistPagerSettled(page);
	let previous = "";
	await expect
		.poll(async () => {
			const current = JSON.stringify(await measuredBox(page, PAGINATION));
			const stable = current === previous;
			previous = current;
			return stable;
		})
		.toBe(true);
	await readlistPagerGeometry(page);
	await snapToWholePixels(page, PAGINATION);
	await expect(page.locator(PAGINATION)).toHaveScreenshot(`${name}.png`, CONTRAST_SENSITIVE);
}

async function openImportReview(page: Page, stamp: string): Promise<void> {
	const email = `pagination-import-${stamp}@example.com`;
	await createVerifiedUser(page, email);
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/import?mode=upload`, { waitUntil: "domcontentloaded" });
	const urls = Array.from(
		{ length: IMPORTED_URL_COUNT },
		(_, index) => `https://example.com/essays/imported-${index}`,
	);
	await page.locator("[data-test-import-file-input]").setInputFiles({
		name: "links.txt",
		mimeType: "text/plain",
		buffer: Buffer.from(urls.join("\n"), "utf-8"),
	});
	await page.waitForSelector("[data-test-import-list]");
}

async function importPagerSettled(page: Page): Promise<void> {
	await expect(page.locator(`${IMPORT_PAGINATION} ${IMPORT_NEXT}`)).toBeVisible();
	await expect(page.locator(`${IMPORT_PAGINATION} ${IMPORT_PREV}`)).toHaveCount(0);
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
	await neutralise(page);
}

test.describe("Pagination on the readlist at desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the widest page window from a middle page (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openMiddleReadlistPage(page, `middle-${theme}-${testInfo.workerIndex}-${Date.now()}`);

			await captureCheckpoint(
				page,
				pagerCheckpoint({
					name: `readlist-pagination-middle-${theme}`,
					target: PAGINATION,
					settled: readlistPagerSettled,
					geometry: readlistPagerGeometry,
				}),
			);
		});
	}
});

test.describe("Pagination on the readlist on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("puts the info line on its own row above the controls", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openMiddleReadlistPage(page, `middle-phone-${testInfo.workerIndex}-${Date.now()}`);

		await captureCheckpoint(
			page,
			pagerCheckpoint({
				name: "readlist-pagination-middle-phone",
				target: PAGINATION,
				settled: readlistPagerSettled,
				geometry: readlistPagerPhoneGeometry,
			}),
		);
	});
});

test.describe("Pagination on the readlist at the WCAG reflow width", () => {
	test.use({ timezoneId: "UTC", viewport: WCAG_REFLOW_MINIMUM });

	test("never scrolls the page sideways at 320px", async ({ page }, testInfo) => {
		await openMiddleReadlistPage(page, `middle-reflow-${testInfo.workerIndex}-${Date.now()}`);
		await readlistPagerSettled(page);

		await neverScrollsSideways(page);
		await infoAboveControls(page);
	});
});

test.describe("Pagination on the readlist in greyscale", () => {
	test.use({ timezoneId: "UTC", viewport: EINK_VIEWPORT });

	for (const theme of THEMES) {
		test(`keeps the pager's contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			await openMiddleReadlistPage(page, `middle-eink-${theme}-${testInfo.workerIndex}-${Date.now()}`);

			await captureInGreyscale(page, `readlist-pagination-middle-eink-${theme}`);
		});
	}
});

test.describe("Pagination on the import review", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of THEMES) {
		test(`shows the first of two review pages (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme });
			await openImportReview(page, `${theme}-${testInfo.workerIndex}-${Date.now()}`);

			await captureCheckpoint(
				page,
				pagerCheckpoint({
					name: `import-review-pagination-${theme}`,
					target: IMPORT_PAGINATION,
					settled: importPagerSettled,
					geometry: neverScrollsSideways,
				}),
			);
		});
	}
});
