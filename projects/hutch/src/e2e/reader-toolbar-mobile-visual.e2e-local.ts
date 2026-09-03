import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
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
const ARTICLE_TITLE = "How Google Sold Its Engineers on Management";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const TOOLBAR = ".article-body__actions--sticky";
const BAR = `${TOOLBAR} .article-body__actions--top`;
const BACK = "[data-test-back-link]";
const PICKER = "[data-test-readlists-trigger]";
const MARK_READ = "[data-test-mark-read-btn]";
const EPUB = "[data-test-download-epub]";

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

async function openOwnerReader(page: Page, params: { stamp: string; query: string }): Promise<void> {
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
			content: "<p>Seeded body for the reader toolbar baseline.</p>",
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
		[BACK, PICKER, MARK_READ, EPUB].map(async (selector) => ({
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
	assert.ok(controls.length >= 3, "the owner toolbar must offer back, the picker and mark-read");

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
	const labels = await page.locator(`${BAR} .article-body__action-label`).evaluateAll((elements) =>
		elements.map((element) => ({
			text: element.textContent ?? "",
			display: getComputedStyle(element).display,
			width: element.getBoundingClientRect().width,
		})),
	);
	assert.ok(labels.length >= 3, "each control must carry the label the arrow or short form stands in for");
	for (const label of labels) {
		assert.notEqual(label.display, "none", `"${label.text}" must stay in the accessibility tree`);
		assert.ok(label.width <= 1, `"${label.text}" must be clipped, not laid out, on a phone`);
	}
}

async function phoneGeometry(page: Page): Promise<void> {
	await everyControlOnOneRow(page);
	await fullLabelsStayInTheDocument(page);
	const back = await measuredBox(page, BACK);
	assert.ok(
		back.width >= 44 && back.height >= 44,
		`back is the arrow alone here and must stay a 44px touch target, measured ${back.width}x${back.height}`,
	);
}

async function desktopGeometry(page: Page): Promise<void> {
	await everyControlOnOneRow(page);
	const shortForms = await page
		.locator(`${BAR} .article-body__action-label-short`)
		.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).display));
	assert.deepEqual(
		shortForms,
		shortForms.map(() => "none"),
		"a desktop toolbar shows no short label",
	);
	const icons = await page
		.locator(`${BAR} .article-body__action-icon`)
		.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).display));
	assert.deepEqual(
		icons,
		icons.map(() => "none"),
		"a desktop toolbar shows no leading action icon",
	);
	const backLabel = await measuredBox(page, `${BACK} .article-body__action-label`);
	assert.ok(backLabel.width > 1, "the back link reads as text again above the breakpoint");
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

	test("back, the picker and mark-read share one row", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `phone-${testInfo.workerIndex}-${Date.now()}`,
			query: "",
		});
		await captureCheckpoint(page, checkpoint("reader-toolbar-phone", phoneGeometry));
	});

	test("the EPUB download joins that row rather than opening a second one", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `phone-epub-${testInfo.workerIndex}-${Date.now()}`,
			query: "?feature=epub",
		});
		await page.waitForSelector(EPUB);
		await captureCheckpoint(page, checkpoint("reader-toolbar-phone-epub", phoneGeometry));
	});

	test("the chromeless reader pins the same single row to the top of the native sheet", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `chromeless-${testInfo.workerIndex}-${Date.now()}`,
			query: "?shell=app",
		});
		await page.waitForSelector("body.page-reader--chromeless");
		await captureCheckpoint(page, checkpoint("reader-toolbar-chromeless-phone", phoneGeometry));
	});
});

test.describe("Reader toolbar above the breakpoint", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("keeps the full labels and drops the phone icons", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `desktop-${testInfo.workerIndex}-${Date.now()}`,
			query: "?feature=epub",
		});
		await page.waitForSelector(EPUB);
		await captureCheckpoint(page, checkpoint("reader-toolbar-desktop", desktopGeometry));
	});
});
