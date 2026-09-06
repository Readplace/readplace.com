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
import { type MeasuredBox, measureBoxes, neutraliseVolatileChrome, pageOverflowsSideways } from "./readlist-nav.browser";
import { htmxIsLive, readScrollY } from "./readlist-reader-skeleton.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const RELATED_COMPUTED_AT = "2026-07-10T09:20:00.000Z";
const ARTICLE_TITLE = "How Google Sold Its Engineers on Management";
const READER_DOCUMENT_TITLE = `${ARTICLE_TITLE} — Readplace Reader`;
const DESKTOP_TALL = { width: 1280, height: 1700 };
const PHONE_TALL = { width: 390, height: 2000 };
const READER_MAX_WIDTH = 680;
const FRAME_TOLERANCE_PX = 0.5;

const COLUMN = "main.reader";
const TOOLBAR = "main.reader .article-body__actions--sticky";
const HEADER = "main.reader .article-body__header";
const TITLE = "main.reader .article-body__title";
const SKELETON = "[data-test-reader-skeleton]";
const READY_SLOT = '[data-test-reader-slot][data-reader-status="ready"]';
const READER_CONTENT = "[data-test-reader-content]";
const CARD_TITLE = "[data-test-article-title]";
const PENDING_CARD = '[data-card-status="pending"]';
const PICKER = "[data-test-readlists-trigger]";
const FRAME = [TOOLBAR, HEADER, TITLE] as const;

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

async function seedAndLogin(page: Page, stamp: string): Promise<void> {
	const email = `reader-skeleton-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/reader-skeleton-${stamp}`,
			title: ARTICLE_TITLE,
			content: "<p>Seeded body for the reader skeleton baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			generatedSummary: {
				summary: "Seeded summary so the reader's summary poller settles after the fill.",
				excerpt: "Seeded summary.",
			},
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	SeededArticle.parse(await seeded.json());

	const related = await page.request.post(`${BASE_URL}/e2e/seed-related-articles`, {
		data: {
			userId,
			sourceUrl: `https://example.com/reader-skeleton-${stamp}`,
			related: [{ url: `https://example.com/reader-skeleton-related-${stamp}`, reason: "Same topic" }],
			computedAt: RELATED_COMPUTED_AT,
		},
	});
	assert.equal(related.status(), 201, "the related seed endpoint must settle the Next-read slot");

	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function holdReader(page: Page): Promise<() => void> {
	const resolvers: Array<() => void> = [];
	const gate = new Promise<void>((resolve) => {
		resolvers.push(resolve);
	});
	const release = resolvers[0];
	assert.ok(release, "a promise executor runs synchronously, so its resolver must be captured");
	await page.route("**/queue/*/view*", async (route) => {
		await gate;
		await route.continue();
	});
	return release;
}

async function openHeldReader(page: Page, stamp: string): Promise<{ release: () => void; href: string }> {
	await seedAndLogin(page, stamp);
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-readlist");
	await page.waitForSelector(CARD_TITLE);
	await expect(page.locator(PENDING_CARD)).toHaveCount(0);
	await page.waitForFunction(htmxIsLive);
	const href = await page.locator(CARD_TITLE).first().getAttribute("href");
	assert.ok(href, "the queue card must link into the reader");

	const release = await holdReader(page);
	await page.locator(CARD_TITLE).first().click();
	await page.waitForSelector(SKELETON);
	await page.waitForSelector("body.page-reader");

	const want = new URL(href, BASE_URL);
	const got = new URL(page.url());
	assert.equal(
		got.pathname + got.search,
		want.pathname + want.search,
		"the address bar must carry the reader URL before the response lands",
	);
	return { release, href };
}

async function skeletonSettled(page: Page): Promise<void> {
	await page.waitForSelector(SKELETON);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await page.locator(TITLE).filter({ hasText: ARTICLE_TITLE }).waitFor();
	await expect(page.locator(TITLE)).toHaveCSS("font-size", "32px");
	await waitForBrandFonts(page, ["Inter"]);
}

async function stableFrameBoxes(page: Page): Promise<MeasuredBox[]> {
	let previous = "";
	let boxes: MeasuredBox[] = [];
	await expect
		.poll(async () => {
			boxes = await page.evaluate(measureBoxes, [...FRAME]);
			const current = JSON.stringify(boxes);
			const stable = current === previous;
			previous = current;
			return stable;
		})
		.toBe(true);
	return boxes;
}

async function skeletonGeometry(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the skeleton checkpoints must run with an explicit viewport");

	const [toolbar, header, title] = await page.evaluate(measureBoxes, [...FRAME]);
	assert.ok(toolbar && header && title, "the skeleton frame must be laid out");
	const column = await measuredBox(page, COLUMN);
	assert.ok(
		Math.abs(column.width - Math.min(READER_MAX_WIDTH, viewport.width)) <= 1,
		`the reader column must share the reader's measure, saw ${column.width}`,
	);
	assert.ok(
		column.y + column.height <= viewport.height,
		`the whole column must fit a page-from-top capture, its bottom sits at ${column.y + column.height}`,
	);
	assert.ok(Math.abs(toolbar.x - header.x) <= 0.5, "the toolbar and header share the column's left edge");
	assert.ok(Math.abs(toolbar.width - header.width) <= 0.5, "the toolbar and header share the column's width");
	assert.ok(Math.abs(title.width - header.width) <= 0.5, "the title spans the header width");
	assert.ok(title.y >= toolbar.y + toolbar.height - 0.5, "the title sits below the sticky toolbar");

	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the skeleton must not widen the page");

	const lines = await page.locator("main.reader .reader-skeleton__line").count();
	assert.equal(lines, 9, "the skeleton body must render its placeholder lines");
}

function checkpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: skeletonSettled,
		geometry: skeletonGeometry,
		target: COLUMN,
		capture: "page-from-top",
		pinnedText: [],
	};
}

test.describe("Reader skeleton while the reader is held", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	test("paints the reader's own frame, then fills it in place without a layout jump", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const { release, href } = await openHeldReader(page, `desktop-light-${testInfo.workerIndex}-${Date.now()}`);

		await skeletonSettled(page);
		const before = await stableFrameBoxes(page);
		await captureCheckpoint(page, checkpoint("reader-skeleton-desktop-light"));

		release();
		await page.waitForSelector(READY_SLOT);
		await page.locator(READER_CONTENT).waitFor({ state: "visible" });
		await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });

		const after = await stableFrameBoxes(page);
		for (let index = 0; index < before.length; index++) {
			const wasBox = before[index];
			const nowBox = after[index];
			assert.ok(wasBox && nowBox, "the frame must stay measurable across the fill");
			for (const side of ["x", "y", "width", "height"] as const) {
				assert.ok(
					Math.abs(wasBox[side] - nowBox[side]) <= FRAME_TOLERANCE_PX,
					`${FRAME[index]} ${side} must not jump when the content lands`,
				);
			}
		}

		await expect(page).toHaveTitle(READER_DOCUMENT_TITLE);
		await expect(page.locator("body.page-reader")).toHaveCount(1);
		const want = new URL(href, BASE_URL);
		const filled = new URL(page.url());
		assert.equal(
			filled.pathname + filled.search,
			want.pathname + want.search,
			"the address bar must still carry the reader URL once the content lands",
		);
		assert.equal(await page.evaluate(readScrollY), 0, "a filled reader lands at the top like a reload");

		await page.locator(PICKER).click();
		await expect(page.locator("[data-test-readlists-menu]")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(PICKER)).toBeFocused();

		const reloaded = page.waitForEvent("load");
		await page.goBack();
		await reloaded;
		await expect(page.locator("body.page-readlist")).toHaveCount(1);
		await expect(page.locator(CARD_TITLE)).toHaveText(ARTICLE_TITLE);
	});

	test("paints the same frame in dark mode", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openHeldReader(page, `desktop-dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, checkpoint("reader-skeleton-desktop-dark"));
	});
});

test.describe("Reader skeleton on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_TALL });

	test("paints the reader's frame at a phone width", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openHeldReader(page, `phone-light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, checkpoint("reader-skeleton-phone-light"));
	});
});
