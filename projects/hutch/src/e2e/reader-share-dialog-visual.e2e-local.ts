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
const PINNED_SHARE_URL =
	"https://readplace.com/view/example.com/why-readers-keep-tabs-open?utm_source=share-dialog&utm_medium=copy&utm_campaign=reader-internal&utm_content=reader-view";
const PINNED_ORIGINAL_URL = "https://example.com/why-readers-keep-tabs-open";

const SHARE = '[data-test-action="share-open"]';
const FAILED_NOTICE = '[data-test-reader-notice][data-reader-status="failed"].article-body__reader-notice--visible';
const DIALOG = '[data-test-confirm-popover="share"]';
const FIELD = `${DIALOG} [data-test-share-link="reader-view"] .share-dialog__field`;
const LINK = `${DIALOG} [data-test-share-url="reader-view"]`;
const ORIGINAL_LINK = `${DIALOG} [data-test-share-url="original"]`;
const COPY = `${DIALOG} [data-test-share-copy="reader-view"]`;
const FIRST_COPY = `${DIALOG} [data-test-share-copy]`;
const ROWS = `${DIALOG} [data-test-share-link]`;
const CHOICES = `${DIALOG} [data-test-share-choice]`;
const CHOOSE_ORIGINAL = `${DIALOG} [data-test-share-choice="original"]`;
const COPY_IDLE = `${COPY} [data-share-copy-idle]`;
const COPY_DONE = `${COPY} [data-share-copy-done]`;
const STATUS = `${DIALOG} [data-share-status]`;
const TARGETS = `${DIALOG} [data-test-share-target]:visible`;
const CANCEL = `${DIALOG} [data-test-action="share-cancel"]`;
const AVATAR = `${DIALOG} [data-test-share-avatar]`;
const SHARE_TARGET_COUNT = 5;
const DESKTOP_PANEL_PX = 600;
const PANEL_BORDER_PX = 1;
const DESKTOP_PADDING_PX = 32;
const PHONE_PADDING_PX = 24;

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

async function openOwnerReader(
	page: Page,
	stamp: string,
	crawl: "ready" | "failed" = "ready",
): Promise<void> {
	const email = `reader-share-dialog-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/reader-share-dialog-${stamp}`,
			title: "Why readers keep tabs open",
			content: "<p>Seeded body for the reader's share dialog baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await seeded.json());
	const settleFailed = async (): Promise<void> => {
		const url = `https://example.com/reader-share-dialog-${stamp}`;
		for (const status of [
			{ url, status: "pending" },
			{ url, status: "failed", reason: JSON.stringify({ kind: "fetch-failed" }) },
		]) {
			const moved = await page.request.post(`${BASE_URL}/e2e/seed-crawl-status`, { data: status });
			assert.equal(moved.status(), 201, `the crawl-status seed must move the crawl to ${status.status}`);
		}
	};
	if (crawl === "failed") await settleFailed();

	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");

	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	if (crawl === "failed") {
		await settleFailed();
		await page.waitForSelector(FAILED_NOTICE);
	} else {
		await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
	}
}

async function openShareDialog(page: Page): Promise<void> {
	if (await page.locator(SHARE).isVisible()) {
		await page.locator(SHARE).click();
	} else {
		await page.click('[data-test-action="reader-menu"]');
		await page.click('[data-test-reader-menu-panel] [data-test-action="menu-share-open"]');
	}
	await page.waitForSelector(`${DIALOG}:popover-open`);
	await expect(page.locator(FIRST_COPY).first()).toBeVisible();
	await expect(page.locator(FIRST_COPY).first()).toBeFocused();
	await expect
		.poll(() =>
			page.locator(AVATAR).evaluate((avatar: HTMLImageElement) => avatar.complete && avatar.naturalWidth > 0),
		)
		.toBe(true);
}

async function shareDialogSettled(page: Page): Promise<void> {
	await openShareDialog(page);
	for (const [selector, pinned] of [
		[LINK, PINNED_SHARE_URL],
		[ORIGINAL_LINK, PINNED_ORIGINAL_URL],
	]) {
		await page.locator(selector).evaluateAll((links: HTMLInputElement[], value: string) => {
			for (const link of links) link.value = value;
		}, pinned);
	}
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
}

async function shareDialogGeometry(page: Page, layout: { padding: number; targetsWrap: boolean }): Promise<void> {
	assert.deepEqual(
		await page.locator(ROWS).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-test-share-link"))),
		["reader-view", "original"],
		"the dialog must offer the reader view and the original link",
	);
	const panel = await measuredBox(page, DIALOG);
	const targets = await page.locator(TARGETS).evaluateAll((links) =>
		links.map((link) => {
			const box = link.getBoundingClientRect();
			return { x: box.x, y: box.y, width: box.width };
		}),
	);
	assert.equal(targets.length, SHARE_TARGET_COUNT, "the dialog must offer five share targets");
	for (const target of targets) {
		assert.ok(
			target.x >= panel.x && target.x + target.width <= panel.x + panel.width,
			"every share target must sit inside the panel",
		);
	}
	const rows = new Set(targets.map((target) => Math.round(target.y))).size;
	assert.equal(rows > 1, layout.targetsWrap, `the share targets laid out in ${rows} row(s)`);

	const cancel = await measuredBox(page, CANCEL);
	const cancelInset = panel.x + panel.width - (cancel.x + cancel.width);
	assert.ok(
		Math.abs(cancelInset - (PANEL_BORDER_PX + layout.padding)) <= 0.5,
		`Cancel must end ${layout.padding}px inside the panel, measured ${cancelInset}px from its edge`,
	);

	const field = await measuredBox(page, FIELD);
	const copy = await measuredBox(page, COPY);
	assert.ok(
		copy.x >= field.x &&
			copy.x + copy.width <= field.x + field.width &&
			copy.y >= field.y &&
			copy.y + copy.height <= field.y + field.height,
		"Copy must sit inside the link's box",
	);
	const borders = {
		field: await page.locator(FIELD).evaluate((part) => getComputedStyle(part).borderTopWidth),
		link: await page.locator(LINK).evaluate((part) => getComputedStyle(part).borderTopWidth),
	};
	assert.deepEqual(
		borders,
		{ field: "1px", link: "0px" },
		"the link and its Copy button must share the field's one border",
	);
}

async function desktopGeometry(page: Page): Promise<void> {
	const panel = await measuredBox(page, DIALOG);
	assert.ok(
		Math.abs(panel.width - DESKTOP_PANEL_PX) <= 0.5,
		`the share dialog must be ${DESKTOP_PANEL_PX}px wide on a desktop, measured ${panel.width}px`,
	);
	await shareDialogGeometry(page, { padding: DESKTOP_PADDING_PX, targetsWrap: false });
}

async function phoneGeometry(page: Page): Promise<void> {
	await shareDialogGeometry(page, { padding: PHONE_PADDING_PX, targetsWrap: true });
}

async function visibleTargetLinks(page: Page): Promise<string[]> {
	return page.locator(TARGETS).evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
}

async function originalChosenGeometry(page: Page): Promise<void> {
	const shared = await visibleTargetLinks(page);
	assert.equal(shared.length, SHARE_TARGET_COUNT, "choosing the original must still offer five share targets");
	assert.ok(
		shared.every((href) => !href.includes("utm_content")),
		"the targets shown after choosing the original must send the untagged original link",
	);
}

async function originalOnlyGeometry(page: Page): Promise<void> {
	assert.deepEqual(
		await page.locator(ROWS).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-test-share-link"))),
		["original"],
		"a reader view that has not loaded must offer the original link alone",
	);
	assert.equal(await page.locator(CHOICES).count(), 0, "a lone original link offers no choice");
	assert.equal((await visibleTargetLinks(page)).length, SHARE_TARGET_COUNT, "the original link keeps five targets");
}

function checkpoint(name: string, geometry: (page: Page) => Promise<void>): VisualCheckpoint {
	return {
		name,
		settled: shareDialogSettled,
		geometry,
		target: DIALOG,
		capture: "element",
		pinnedText: [{ selector: "[data-test-reader-saved]", text: "6h ago" }],
	};
}

const SHARE_DIALOG_LIGHT = checkpoint("reader-share-dialog-light", desktopGeometry);
const SHARE_DIALOG_DARK = checkpoint("reader-share-dialog-dark", desktopGeometry);
const SHARE_DIALOG_PHONE = checkpoint("reader-share-dialog-phone", phoneGeometry);
const SHARE_DIALOG_ORIGINAL_CHOSEN: VisualCheckpoint = {
	...checkpoint("reader-share-dialog-original-chosen", originalChosenGeometry),
	settled: async (page) => {
		await shareDialogSettled(page);
		await page.locator(CHOOSE_ORIGINAL).check();
		await page.mouse.move(0, 0);
	},
};
const SHARE_DIALOG_ORIGINAL_ONLY = checkpoint("reader-share-dialog-original-only", originalOnlyGeometry);

test.describe("Reader share dialog", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("offers the founder's note, the reader view and original links, and five targets (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, `light-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, SHARE_DIALOG_LIGHT);
	});

	test("offers the founder's note, the reader view and original links, and five targets (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openOwnerReader(page, `dark-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, SHARE_DIALOG_DARK);
	});

	test("sends the original link once the reader chooses it", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, `original-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, SHARE_DIALOG_ORIGINAL_CHOSEN);
	});

	test("offers only the original link while the reader view has not loaded", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, `failed-${testInfo.workerIndex}-${Date.now()}`, "failed");
		await captureCheckpoint(page, SHARE_DIALOG_ORIGINAL_ONLY);
	});
});

test.describe("Reader share dialog on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("wraps the targets inside the panel", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, `phone-${testInfo.workerIndex}-${Date.now()}`);
		await captureCheckpoint(page, SHARE_DIALOG_PHONE);
	});
});

test.describe("Reader share dialog copy", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, permissions: ["clipboard-read", "clipboard-write"] });

	test("Copy puts the tagged link on the clipboard, announces it and swaps its icon", async ({
		page,
	}, testInfo) => {
		await openOwnerReader(page, `copy-${testInfo.workerIndex}-${Date.now()}`);
		await openShareDialog(page);
		const link = await page.locator(COPY).getAttribute("data-share-url");
		assert(link, "the Copy button must carry the link it copies");
		assert.equal(new URL(link).searchParams.get("utm_medium"), "copy");
		await expect(page.locator(COPY_IDLE)).toBeVisible();

		await page.locator(COPY).click();

		await expect(page.locator(STATUS)).toHaveText("Link copied to clipboard");
		await expect(page.locator(COPY_DONE)).toBeVisible();
		await expect(page.locator(COPY_IDLE)).toBeHidden();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
	});
});
