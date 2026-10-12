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
import { neutraliseVolatileChrome } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const ARTICLE_TITLE = "How Google Sold Its Engineers on Management";
const PHONE = { width: 390, height: 844 };
const PHONE_320 = { width: 320, height: 568 };
const DESKTOP = { width: 1280, height: 900 };
const TABLET_SHEET = { width: 1024, height: 1366 };
const SHORT_BODY = "<p>Seeded body for the reader toolbar baseline.</p>";
const LONG_BODY = Array.from(
	{ length: 40 },
	() =>
		"<p>Seeded body for the reader toolbar baseline, repeated so the native sheet scrolls the column and the rail under the pinned toolbar.</p>",
).join("");

const TOOLBAR = ".article-body__toolbar";
const BAR = `${TOOLBAR} .article-body__actions--top`;
const BACK = "[data-test-back-link]";
const PICKER = "[data-test-readlists-trigger]";
const MARK_READ = "[data-test-mark-read-slot] .article-body__mark-read:visible";
const SHARE = '[data-test-action="share-open"]';
const SHARE_FALLBACK = "[data-test-share-fallback]";
const DOWNLOAD = "[data-test-download]";
const CHEVRON = `${PICKER} .article-body__readlists-chevron`;
const TOP = "[data-test-reader-top]";
const ACTION_LABEL = ".article-body__action-label";
const CONTROLS = [BACK, PICKER, MARK_READ, SHARE, DOWNLOAD];
const TRAILING_GAP_PX = 8;
const L_CONTROL_PX = 48;

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	"[data-test-reader-related]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openOwnerReader(
	page: Page,
	params: { stamp: string; query: string; content: string },
): Promise<string> {
	const email = `reader-toolbar-${params.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/reader-toolbar-${params.stamp}`,
			title: ARTICLE_TITLE,
			content: params.content,
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

	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");

	await page.goto(`${BASE_URL}/queue/${articleId}/view${params.query}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
	return articleId;
}

async function markRead(page: Page, articleId: string): Promise<void> {
	const marked = await page.request.post(`${BASE_URL}/queue/${articleId}/status`, { form: { status: "read" } });
	assert.ok(marked.ok(), `marking the article read must succeed, answered ${marked.status()}`);
}

async function toolbarSettled(page: Page): Promise<void> {
	await page.waitForSelector(TOOLBAR);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await waitForBrandFonts(page, ["Inter"]);
}

interface MeasuredBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

async function visibleControls(page: Page): Promise<{ selector: string; box: MeasuredBox }[]> {
	const present = await Promise.all(
		CONTROLS.map(async (selector) => ({
			selector,
			count: await page.locator(selector).count(),
		})),
	);
	return Promise.all(
		present
			.filter((control) => control.count > 0)
			.map(async (control) => ({
				selector: control.selector,
				box: await measuredBox(page, control.selector),
			})),
	);
}

async function everyControlOnOneRow(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the toolbar checkpoints must run with an explicit viewport");

	const bar = await measuredBox(page, BAR);
	const controls = await visibleControls(page);
	assert.ok(controls.length >= 4, "the owner toolbar must offer back, mark-read, Share and Download");

	for (const control of controls) {
		assert.ok(
			Math.abs(control.box.y + control.box.height / 2 - (bar.y + bar.height / 2)) <= 1,
			`"${control.selector}" must sit on the toolbar's single row, not wrap below it`,
		);
		assert.ok(
			control.box.x >= bar.x - 0.5 && control.box.x + control.box.width <= bar.x + bar.width + 0.5,
			`"${control.selector}" must stay inside the toolbar horizontally`,
		);
	}

	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	assert.equal(
		scrollWidth,
		viewport.width,
		`the toolbar must not widen the page, measured ${scrollWidth}`,
	);
}

async function fullLabelsStayInTheDocument(page: Page): Promise<void> {
	const labels = await page.locator(`${BAR} ${ACTION_LABEL}`).evaluateAll((elements) =>
		elements.map((element) => ({
			text: element.textContent ?? "",
			display: getComputedStyle(element).display,
			width: element.getBoundingClientRect().width,
		})),
	);
	assert.ok(labels.length >= 3, "each control must carry the label its icon stands in for");
	for (const label of labels) {
		assert.notEqual(label.display, "none", `"${label.text}" must stay in the accessibility tree`);
		assert.ok(label.width <= 1, `"${label.text}" must be clipped, not laid out, on a phone`);
	}
}

async function labelWidth(page: Page, control: string): Promise<number> {
	return (await measuredBox(page, `${control} ${ACTION_LABEL}`)).width;
}

async function controlsRunInOrder(page: Page, order: readonly string[]): Promise<MeasuredBox[]> {
	const boxes = await Promise.all(order.map((selector) => measuredBox(page, selector)));
	const byPosition = order
		.map((selector, index) => ({ selector, x: boxes[index]?.x ?? Number.NaN }))
		.sort((left, right) => left.x - right.x)
		.map((control) => control.selector);
	assert.deepEqual(byPosition, order, "the toolbar's controls must run in their designed order");
	return boxes;
}

function sitEightApart(boxes: readonly MeasuredBox[], what: string): void {
	for (const [index, box] of boxes.slice(1).entries()) {
		const previous = boxes[index];
		assert.ok(previous, "each gap is measured from the control before it");
		const gap = box.x - (previous.x + previous.width);
		assert.ok(Math.abs(gap - TRAILING_GAP_PX) <= 0.5, `${what} must sit ${TRAILING_GAP_PX}px apart, measured ${gap}`);
	}
}

async function everyTargetIsTouchable(page: Page): Promise<void> {
	for (const control of await visibleControls(page)) {
		assert.ok(
			control.box.width >= 44 && control.box.height >= 44,
			`"${control.selector}" must stay a 44px touch target, measured ${control.box.width}x${control.box.height}`,
		);
	}
}

async function phoneGeometry(page: Page): Promise<void> {
	await everyControlOnOneRow(page);
	await fullLabelsStayInTheDocument(page);
	await everyTargetIsTouchable(page);
	const mark = await measuredBox(page, MARK_READ);
	assert.ok(Math.abs(mark.width - 52) <= 0.5, `Mark shows only its icon here and is 52px wide, measured ${mark.width}`);
}

async function narrowPhoneGeometry(page: Page): Promise<void> {
	await phoneGeometry(page);
	assert.equal(
		await page.locator(CHEVRON).evaluate((chevron) => getComputedStyle(chevron).display),
		"none",
		"Add drops its chevron when the compact row no longer fits it",
	);
}

async function desktopGeometry(page: Page): Promise<void> {
	await everyControlOnOneRow(page);
	const [, ...trailing] = await controlsRunInOrder(page, CONTROLS);
	for (const [index, box] of trailing.entries()) {
		assert.ok(
			Math.abs(box.height - L_CONTROL_PX) <= 0.5,
			`"${CONTROLS[index + 1]}" must be an L control, ${L_CONTROL_PX}px tall, measured ${box.height}`,
		);
	}
	for (const selector of [SHARE, DOWNLOAD]) {
		const box = await measuredBox(page, selector);
		assert.ok(
			Math.abs(box.width - L_CONTROL_PX) <= 0.5,
			`"${selector}" must be a ${L_CONTROL_PX}px square, measured ${box.width}`,
		);
	}
	sitEightApart(trailing, "Add, Mark, Share and Download");
	assert.notEqual(
		await page.locator(`${PICKER} > svg`).evaluate((plus) => getComputedStyle(plus).display),
		"none",
		"Add leads with its plus",
	);
	assert.equal(await page.locator(`${BAR} .article-body__action-label-short`).count(), 0, "no control carries a short label");
	assert.equal(
		await page.locator(SHARE_FALLBACK).evaluate((fallback) => getComputedStyle(fallback).display),
		"none",
		"a browser with popovers opens the share dialog, never the inline fallback",
	);
	assert.equal(
		(await page.locator(`${DOWNLOAD} .sr-only`).textContent())?.trim(),
		"Download EPUB",
		"the reader's download control must name the format it delivers",
	);
	const icons = await page
		.locator(`${BAR} .article-body__action-icon`)
		.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).display));
	assert.deepEqual(
		icons,
		icons.map(() => "none"),
		"a desktop toolbar shows no leading action icon",
	);
	assert.ok((await labelWidth(page, BACK)) > 1, "the back link reads as text again above the breakpoint");
}

async function arrowOnlyRowGeometry(page: Page): Promise<void> {
	await everyControlOnOneRow(page);
	assert.ok((await labelWidth(page, BACK)) <= 1, "Back keeps only its arrow where the full row no longer fits");
	assert.ok(
		(await labelWidth(page, PICKER)) > 1 && (await labelWidth(page, MARK_READ)) > 1,
		"Add and Mark keep their labels while the arrow-only row fits",
	);
}

async function chromelessSheetGeometry(page: Page): Promise<void> {
	await everyControlOnOneRow(page);
	const viewport = page.viewportSize();
	assert.ok(viewport, "the tablet sheet checkpoint must run with an explicit viewport");
	const toolbar = await measuredBox(page, TOOLBAR);
	assert.ok(Math.abs(toolbar.y) <= 0.5, `the chromeless toolbar must pin to the top of the sheet, measured ${toolbar.y}`);
	const edgesHitTheStrip = await page.locator(TOOLBAR).evaluate((bar, xs) => {
		const box = bar.getBoundingClientRect();
		return xs.map((x) => bar.contains(document.elementFromPoint(x, box.top + box.height / 2)));
	}, [1, viewport.width - 2]);
	assert.deepEqual(
		edgesHitTheStrip,
		[true, true],
		"the toolbar's strip must span the sheet from edge to edge, over the rail as well as the column",
	);
	assert.equal(
		await page.locator(TOP).evaluate((top) => getComputedStyle(top).display),
		"none",
		"the chromeless reader leaves the Top link to the native sheet",
	);
}

async function scrolledUnderToolbar(page: Page): Promise<void> {
	await toolbarSettled(page);
	await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);
}

function checkpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return {
		name,
		settled: toolbarSettled,
		geometry,
		target: TOOLBAR,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Reader toolbar on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("back, the picker, mark-read, Share and Download share one row", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `phone-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
			content: SHORT_BODY,
		});
		await expect(page.locator("#reader-downloads-slot")).toHaveClass(
			"article-body__downloads-slot article-body__downloads-slot--visible",
		);
		await page.waitForSelector(DOWNLOAD);
		await captureCheckpoint(page, checkpoint("reader-toolbar-phone", phoneGeometry));
	});

	test("the chromeless reader pins the same single row to the top of the native sheet", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `chromeless-${testInfo.workerIndex}-${Date.now()}`,
			query: "?shell=app",
			content: SHORT_BODY,
		});
		await page.waitForSelector("body.page-reader--chromeless");
		await expect(page.locator("#reader-downloads-slot")).toHaveClass(
			"article-body__downloads-slot article-body__downloads-slot--visible",
		);
		await captureCheckpoint(page, checkpoint("reader-toolbar-chromeless-phone", phoneGeometry));
	});
});

test.describe("Reader toolbar above the breakpoint", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps the full labels and drops the phone icons", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `desktop-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
			content: SHORT_BODY,
		});
		await page.waitForSelector(DOWNLOAD);
		await captureCheckpoint(page, checkpoint("reader-toolbar-desktop", desktopGeometry));
	});
});

test.describe("Chromeless reader toolbar on a tablet sheet", () => {
	test.use({ timezoneId: "UTC", viewport: TABLET_SHEET });

	test("the pinned strip spans the sheet while the column and the rail scroll under it", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `chromeless-tablet-${testInfo.workerIndex}-${Date.now()}`,
			query: "?shell=app",
			content: LONG_BODY,
		});
		await page.waitForSelector("body.page-reader--chromeless");
		await expect(page.locator("#reader-downloads-slot")).toHaveClass(
			"article-body__downloads-slot article-body__downloads-slot--visible",
		);
		await captureCheckpoint(page, {
			name: "reader-toolbar-chromeless-tablet",
			settled: scrolledUnderToolbar,
			geometry: chromelessSheetGeometry,
			target: TOOLBAR,
			capture: "page-from-top",
			pinnedText: [],
		});
	});
});

test.describe("Reader toolbar on a 320px phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_320 });

	test("keeps one row by dropping Add's chevron", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `phone-320-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
			content: SHORT_BODY,
		});
		await page.waitForSelector(DOWNLOAD);
		await captureCheckpoint(page, checkpoint("reader-toolbar-phone-320", narrowPhoneGeometry));
	});
});

test.describe("Reader toolbar in the dark", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps the full labels on the dark canvas", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openOwnerReader(page, {
			stamp: `desktop-dark-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
			content: SHORT_BODY,
		});
		await page.waitForSelector(DOWNLOAD);
		await captureCheckpoint(page, checkpoint("reader-toolbar-desktop-dark", desktopGeometry));
	});
});

test.describe("Reader toolbar in the read state", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps one row with Back down to its arrow at 620px, beside the rail's card at 1024px, and beside the table of contents' empty card on the chromeless tablet sheet", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const articleId = await openOwnerReader(page, {
			stamp: `read-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
			content: SHORT_BODY,
		});
		await markRead(page, articleId);

		await page.setViewportSize({ width: 620, height: 900 });
		await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector(DOWNLOAD);
		await toolbarSettled(page);
		await arrowOnlyRowGeometry(page);

		await page.setViewportSize({ width: 1024, height: 900 });
		await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector(DOWNLOAD);
		await toolbarSettled(page);
		await expect(page.locator("[data-test-reader-rail] > [data-test-article-history]")).toHaveCount(1);
		await arrowOnlyRowGeometry(page);

		await page.setViewportSize(TABLET_SHEET);
		await page.goto(`${BASE_URL}/queue/${articleId}/view?shell=app`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-reader--chromeless");
		await page.waitForSelector(DOWNLOAD);
		await toolbarSettled(page);
		await expect(page.locator('[data-test-reader-rail] > [data-test-table-of-contents="empty"]')).toHaveCount(1);
		await arrowOnlyRowGeometry(page);
	});

	test("switches each row at the width that row needs", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const articleId = await openOwnerReader(page, {
			stamp: `thresholds-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
			content: SHORT_BODY,
		});
		await markRead(page, articleId);
		await page.setViewportSize({ width: 700, height: 900 });
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector(DOWNLOAD);
		await toolbarSettled(page);

		async function atToolbarWidth(width: number): Promise<void> {
			const viewport = page.viewportSize();
			assert.ok(viewport, "the threshold checks resize an explicit viewport");
			const toolbar = await measuredBox(page, TOOLBAR);
			await page.setViewportSize({ width: Math.round(viewport.width - toolbar.width + width), height: viewport.height });
			await expect.poll(async () => (await measuredBox(page, TOOLBAR)).width).toBe(width);
		}

		const rows = [];
		for (const width of [629, 628, 532, 531, 304, 303]) {
			await atToolbarWidth(width);
			await everyControlOnOneRow(page);
			rows.push({
				width,
				back: (await labelWidth(page, BACK)) > 1,
				add: (await labelWidth(page, PICKER)) > 1,
				chevron: await page.locator(CHEVRON).evaluate((chevron) => getComputedStyle(chevron).display !== "none"),
			});
		}
		expect(rows).toEqual([
			{ width: 629, back: true, add: true, chevron: true },
			{ width: 628, back: false, add: true, chevron: true },
			{ width: 532, back: false, add: true, chevron: true },
			{ width: 531, back: false, add: false, chevron: true },
			{ width: 304, back: false, add: false, chevron: true },
			{ width: 303, back: false, add: false, chevron: false },
		]);
	});
});

test.describe("Reader toolbar without the Add control", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps Mark, Share and Download together at the trailing edge once the default copy is gone", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const articleId = await openOwnerReader(page, {
			stamp: `no-add-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
			content: SHORT_BODY,
		});
		const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: "Work" } });
		const work = new URL(created.url()).searchParams.get("queue");
		assert.ok(work, "creating a readlist must land on it");
		const assigned = await page.request.post(`${BASE_URL}/queue/${articleId}/assign`, {
			form: { queue: work, returnTo: `/queue/${articleId}/view` },
		});
		assert.ok(assigned.ok(), "filing the article must succeed");
		const deleted = await page.request.post(`${BASE_URL}/queue/${articleId}/delete`);
		assert.ok(deleted.ok(), "deleting the default copy must succeed");

		await page.goto(`${BASE_URL}/queue/${articleId}/view?queue=${work}`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector(DOWNLOAD);
		await toolbarSettled(page);

		assert.equal(await page.locator(PICKER).count(), 0, "a reader without the default copy offers no Add");
		await everyControlOnOneRow(page);
		const trailing = await controlsRunInOrder(page, [MARK_READ, SHARE, DOWNLOAD]);
		sitEightApart(trailing, "Mark, Share and Download");
		const bar = await measuredBox(page, BAR);
		const download = trailing.at(-1);
		assert.ok(download, "Download ends the row");
		assert.ok(
			Math.abs(download.x + download.width - (bar.x + bar.width)) <= 0.5,
			"Download must end the row at the toolbar's trailing edge",
		);
	});
});
