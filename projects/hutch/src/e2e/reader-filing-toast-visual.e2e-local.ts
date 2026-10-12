import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { captureCheckpoint, expect, measuredBox, test, type VisualCheckpoint } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { clickAndWaitForPageReload } from "./page-interactions";
import { neutraliseVolatileChrome } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const READLIST_LABEL = "Deep Work";

const TRIGGER = "summary[data-test-readlists-trigger]";
const TOAST = "#status-toast [data-test-toast]";
const TOAST_MESSAGE = `${TOAST} [data-test-toast-message]`;
const TOAST_UNDO = `${TOAST} [data-test-toast-action]`;
const TAGS = "#article-header [data-test-readlist-tag]";
const ASSIGN_ROWS = "button[data-test-assign-readlist]";
const TOAST_HEIGHT_PX = 58;
const DESKTOP_TOAST_INSET_PX = 48;
const PHONE_TOAST_INSET_PX = 20;

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	".article-history",
	".table-of-contents",
	"[data-test-reader-related]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function openReaderBesideAReadlist(page: Page, stamp: string): Promise<string> {
	const email = `reader-filing-toast-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/reader-filing-toast-${stamp}`,
			title: "An article worth filing",
			content: "<p>Seeded body for the reader's filing toast baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());

	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");

	const readlist = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label: READLIST_LABEL } });
	assert.equal(readlist.status(), 200, "a readlist under the cap must be created and landed on");
	const slug = new URL(readlist.url()).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");

	await page.route("**/client-dist/toast.client.js", (route) => route.abort());
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
	return slug;
}

async function fileFromThePicker(page: Page, slug: string): Promise<void> {
	await page.click(TRIGGER);
	await page.click(`button[data-test-assign-readlist="${slug}"]`);
	await expect(page.locator(TOAST_MESSAGE)).toHaveText(`Added to ${READLIST_LABEL}`);
}

async function filingToastSettled(page: Page): Promise<void> {
	await expect(page.locator(TOAST)).toBeVisible();
	await expect(page.locator(TOAST_MESSAGE)).toHaveText(`Added to ${READLIST_LABEL}`);
	await expect(page.locator(TOAST_UNDO)).toHaveText("Undo");
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await page.mouse.move(0, 0);
}

async function desktopToastGeometry(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert(viewport, "the toast needs a fixed viewport");
	const box = await measuredBox(page, TOAST);
	assert.equal(Math.round(box.x + box.width), viewport.width - DESKTOP_TOAST_INSET_PX);
	assert.equal(Math.round(box.y + box.height), viewport.height - DESKTOP_TOAST_INSET_PX);
	assert.equal(Math.round(box.height), TOAST_HEIGHT_PX);
}

async function phoneToastGeometry(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert(viewport, "the toast needs a fixed viewport");
	const box = await measuredBox(page, TOAST);
	assert.equal(Math.round(box.x), PHONE_TOAST_INSET_PX);
	assert.equal(Math.round(box.x + box.width), viewport.width - PHONE_TOAST_INSET_PX);
	assert.equal(Math.round(box.y + box.height), viewport.height - PHONE_TOAST_INSET_PX);
	assert.equal(Math.round(box.height), TOAST_HEIGHT_PX);
}

function checkpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return { name, settled: filingToastSettled, geometry, target: TOAST, capture: "element", pinnedText: [] };
}

const FILING_TOAST_LIGHT = checkpoint("reader-filing-toast-light", desktopToastGeometry);
const FILING_TOAST_DARK = checkpoint("reader-filing-toast-dark", desktopToastGeometry);
const FILING_TOAST_PHONE = checkpoint("reader-filing-toast-phone", phoneToastGeometry);

function slugsOf(page: Page, selector: string, attribute: string): Promise<string[]> {
	return page
		.locator(selector)
		.evaluateAll((found, name) => found.map((each) => each.getAttribute(name) ?? ""), attribute);
}

test.describe("Reader filing toast", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("confirms a filing from the picker with Undo (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const slug = await openReaderBesideAReadlist(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await fileFromThePicker(page, slug);
		await captureCheckpoint(page, FILING_TOAST_LIGHT);
	});

	test("confirms a filing from the picker with Undo (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		const slug = await openReaderBesideAReadlist(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await fileFromThePicker(page, slug);
		await captureCheckpoint(page, FILING_TOAST_DARK);
	});

	test("Undo takes the article back out and offers the readlist again", async ({ page }, testInfo) => {
		const slug = await openReaderBesideAReadlist(page, `undo-${testInfo.workerIndex}-${Date.now()}`);
		await fileFromThePicker(page, slug);
		expect(await slugsOf(page, TAGS, "data-test-readlist-tag")).toEqual([slug]);
		expect(await slugsOf(page, ASSIGN_ROWS, "data-test-assign-readlist")).toEqual([]);

		await clickAndWaitForPageReload(page, page.locator(TOAST_UNDO));

		await expect.poll(() => slugsOf(page, TAGS, "data-test-readlist-tag")).toEqual([]);
		expect(await slugsOf(page, ASSIGN_ROWS, "data-test-assign-readlist")).toEqual([slug]);
	});
});

test.describe("Reader filing toast on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("spans the phone between its gutters", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		const slug = await openReaderBesideAReadlist(page, `phone-${testInfo.workerIndex}-${Date.now()}`);
		await fileFromThePicker(page, slug);
		await captureCheckpoint(page, FILING_TOAST_PHONE);
	});
});
