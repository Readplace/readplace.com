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
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const OPENER = '[data-test-action="download-open"]';
const DIALOG = '[data-test-confirm-popover="download-guide"]';
const DOWNLOAD = `${DIALOG} [data-test-download="epub"]`;
const CANCEL = `${DIALOG} [data-test-action="download-guide-cancel"]`;
const READER_APP = `${DIALOG} [data-test-download-reader-app]`;
const FALLBACK = "[data-test-download-fallback]";

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

async function openOwnerReader(page: Page, stamp: string): Promise<void> {
	const email = `reader-download-guide-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/reader-download-guide-${stamp}`,
			title: "Why readers keep tabs open",
			content: "<p>Seeded body for the reader's download guide baseline.</p>",
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

	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
}

async function openDownloadGuide(page: Page): Promise<void> {
	await page.locator(OPENER).click();
	await page.waitForSelector(`${DIALOG}:popover-open`);
	await expect(page.locator(DOWNLOAD)).toBeFocused();
}

async function downloadGuideSettled(page: Page): Promise<void> {
	await openDownloadGuide(page);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
}

async function guideInsidePanel(page: Page): Promise<void> {
	const panel = await measuredBox(page, DIALOG);
	for (const selector of [READER_APP, CANCEL, DOWNLOAD]) {
		const box = await measuredBox(page, selector);
		assert.ok(
			box.x >= panel.x && box.x + box.width <= panel.x + panel.width,
			`${selector} must sit inside the panel`,
		);
	}
}

async function desktopGuideGeometry(page: Page): Promise<void> {
	await guideInsidePanel(page);
	const cancel = await measuredBox(page, CANCEL);
	const download = await measuredBox(page, DOWNLOAD);
	assert.ok(cancel.y <= download.y + download.height, "Cancel must not sit below the download");
}

async function phoneGuideGeometry(page: Page): Promise<void> {
	await guideInsidePanel(page);
	const cancel = await measuredBox(page, CANCEL);
	const download = await measuredBox(page, DOWNLOAD);
	assert.ok(download.y + download.height <= cancel.y, "on a phone Download EPUB stacks above Cancel");
}

function checkpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return {
		name,
		settled: downloadGuideSettled,
		geometry,
		target: DIALOG,
		capture: "element",
		pinnedText: [{ selector: "[data-test-reader-saved]", text: "6h ago" }],
	};
}

test.describe("Reader download guide on Windows", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("explains the file and offers a reader app before the download (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, checkpoint("reader-download-guide-light", desktopGuideGeometry));
	});

	test("explains the file and offers a reader app before the download (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openOwnerReader(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, checkpoint("reader-download-guide-dark", desktopGuideGeometry));
	});

	test("Cancel closes the guide and the download is the EPUB file", async ({ page }, testInfo) => {
		await openOwnerReader(page, `cancel-${testInfo.workerIndex}-${Date.now()}`);
		await openDownloadGuide(page);
		expect(await page.locator(DOWNLOAD).getAttribute("href")).toMatch(/format=epub&/);

		await page.locator(CANCEL).click();

		await expect(page.locator(`${DIALOG}:popover-open`)).toHaveCount(0);
		await expect(page.locator(OPENER)).toBeVisible();
	});
});

test.describe("Reader download guide on a Windows phone width", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("keeps the guide inside the panel", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, `phone-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, checkpoint("reader-download-guide-phone", phoneGuideGeometry));
	});
});

test.describe("Reader download guide without client JavaScript", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, javaScriptEnabled: false });

	test("opens the guide declaratively, with the disclosure left to engines without popovers", async ({
		page,
	}, testInfo) => {
		await openOwnerReader(page, `no-js-${testInfo.workerIndex}-${Date.now()}`);
		await expect(page.locator(FALLBACK)).toBeHidden();

		await openDownloadGuide(page);

		expect(await page.locator(DOWNLOAD).getAttribute("href")).toMatch(/format=epub&/);
	});
});
