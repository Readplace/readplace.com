import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { emailIssueArticleUrl } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
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
import { MACOS_CHROME_USER_AGENT } from "./user-agents";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const PHONE_320 = { width: 320, height: 568 };

const TOOLBAR = ".article-body__toolbar";
const BAR = `${TOOLBAR} .article-body__actions--top`;
const BACK = "[data-test-back-link]";
const PICKER = "[data-test-readlists-trigger]";
const MARK_READ = "[data-test-mark-read-slot] .article-body__mark-read:visible";
const SHARE = '[data-test-action="share-withheld"]';
const DOWNLOAD = '[data-test-action="download-withheld"]';
const MORE = '[data-test-action="reader-menu"]';
const MENU_SHARE = '[data-test-reader-menu-panel] [data-test-action="menu-share-withheld"]';
const DIALOG = '[data-test-confirm-popover="sharing-off"]';
const CLOSE = `${DIALOG} [data-test-action="sharing-off-close"]`;
const L_CONTROL_PX = 48;
const TRAILING_GAP_PX = 8;

const VOLATILE_CHROME = [
	".offline-banner",
	".newer-version-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	"[data-test-reader-related]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: UserIdSchema });
const SeededArticle = z.object({ articleId: z.string() });

async function openOwnerIssue(page: Page, params: { stamp: string; query: string }): Promise<void> {
	const email = `reader-issue-toolbar-${params.stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: emailIssueArticleUrl({
				userId,
				receivedAtMessageId: `2026-07-10T09:00:00.000Z#<issue-${params.stamp}@tldr.tech>`,
			}),
			title: "TLDR 2026-07-10",
			content: "<p>Seeded body for the newsletter issue toolbar baseline.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: userId,
			siteName: "TLDR",
			provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
			generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the issue");
	const { articleId } = SeededArticle.parse(await seeded.json());

	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");

	await page.goto(`${BASE_URL}/queue/${articleId}/view${params.query}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
}

async function toolbarSettled(page: Page): Promise<void> {
	await page.waitForSelector(TOOLBAR);
	await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
	await page.mouse.move(0, 0);
	await waitForBrandFonts(page, ["Inter"]);
}

async function toolbarFitsOneRow(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	assert.ok(viewport, "the toolbar checkpoints must run with an explicit viewport");
	const bar = await measuredBox(page, BAR);
	const controls = await page.locator(`${BAR} > *`).evaluateAll((slots) =>
		slots
			.map((slot) => slot.getBoundingClientRect())
			.filter((box) => box.width > 0)
			.map((box) => ({ x: box.x, y: box.y, width: box.width, height: box.height })),
	);
	for (const box of controls) {
		assert.ok(
			Math.abs(box.y + box.height / 2 - (bar.y + bar.height / 2)) <= 1,
			"every toolbar control must sit on the toolbar's single row",
		);
	}
	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	assert.equal(scrollWidth, viewport.width, `the toolbar must not widen the page, measured ${scrollWidth}`);
}

function toolbarCheckpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: toolbarSettled,
		geometry: toolbarFitsOneRow,
		target: TOOLBAR,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Newsletter issue reader toolbar on a desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, userAgent: MACOS_CHROME_USER_AGENT });

	test("shows the issue's toolbar (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerIssue(page, { stamp: `desktop-light-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, toolbarCheckpoint("reader-issue-toolbar-desktop-light"));
	});

	test("shows the issue's toolbar (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openOwnerIssue(page, { stamp: `desktop-dark-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, toolbarCheckpoint("reader-issue-toolbar-desktop-dark"));
	});
});

test.describe("Newsletter issue reader toolbar on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE, userAgent: MACOS_CHROME_USER_AGENT });

	test("shows the issue's toolbar (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerIssue(page, { stamp: `mobile-light-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, toolbarCheckpoint("reader-issue-toolbar-mobile-light"));
	});

	test("shows the issue's toolbar in the app's chromeless reader (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerIssue(page, { stamp: `chromeless-${testInfo.workerIndex}-${Date.now()}`, query: "?shell=app" });
		await captureCheckpoint(page, toolbarCheckpoint("reader-issue-toolbar-chromeless-mobile-light"));
	});
});

async function openSharingOff(page: Page, trigger: string): Promise<void> {
	// Playwright's actionability check treats aria-disabled="true" as disabled, so force the click to open the explanation dialog.
	if (await page.locator(trigger).isVisible()) {
		await page.locator(trigger).click({ force: true });
	} else {
		await page.click(MORE);
		await page.locator(MENU_SHARE).click({ force: true });
	}
	await page.waitForSelector(`${DIALOG}:popover-open`);
	await expect(page.locator(CLOSE)).toBeFocused();
}

function dialogCheckpoint(name: string, trigger: string): VisualCheckpoint {
	return {
		name,
		settled: async (page) => {
			await openSharingOff(page, trigger);
			await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
			await page.mouse.move(0, 0);
			await waitForBrandFonts(page, ["Inter"]);
		},
		geometry: async (page) => {
			const panel = await measuredBox(page, DIALOG);
			const close = await measuredBox(page, CLOSE);
			assert.ok(
				close.x >= panel.x && close.x + close.width <= panel.x + panel.width,
				"Close must sit inside the panel",
			);
		},
		target: DIALOG,
		capture: "element",
		pinnedText: [],
	};
}

async function opacityOf(page: Page, selector: string): Promise<string> {
	return page.locator(selector).evaluate((element) => getComputedStyle(element).opacity);
}

test.describe("Newsletter issue sharing-off dialog on a desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP, userAgent: MACOS_CHROME_USER_AGENT });

	test("explains why Share is off (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerIssue(page, { stamp: `dialog-light-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, dialogCheckpoint("reader-issue-sharing-off-desktop-light", SHARE));
	});

	test("explains why Download is off (dark)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await openOwnerIssue(page, { stamp: `dialog-dark-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, dialogCheckpoint("reader-issue-sharing-off-desktop-dark", DOWNLOAD));
	});

	test("keeps Share and Download dimmed in their places, linking to no public copy", async ({ page }, testInfo) => {
		await openOwnerIssue(page, { stamp: `geometry-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await toolbarSettled(page);

		const order = [BACK, PICKER, MARK_READ, SHARE, DOWNLOAD];
		const boxes = await Promise.all(order.map((selector) => measuredBox(page, selector)));
		assert.deepEqual(
			order
				.map((selector, index) => ({ selector, x: boxes[index]?.x ?? Number.NaN }))
				.sort((left, right) => left.x - right.x)
				.map((control) => control.selector),
			order,
			"the toolbar runs Back, Add, Mark, Share, Download",
		);
		const trailing = boxes.slice(1);
		for (const [index, box] of trailing.entries()) {
			assert.ok(Math.abs(box.height - L_CONTROL_PX) <= 0.5, `control ${index + 1} must be ${L_CONTROL_PX}px tall`);
			const previous = trailing[index - 1];
			if (previous === undefined) continue;
			const gap = box.x - (previous.x + previous.width);
			assert.ok(Math.abs(gap - TRAILING_GAP_PX) <= 0.5, `controls must sit ${TRAILING_GAP_PX}px apart, measured ${gap}`);
		}
		for (const selector of [SHARE, DOWNLOAD]) {
			const box = await measuredBox(page, selector);
			assert.ok(Math.abs(box.width - L_CONTROL_PX) <= 0.5, `${selector} must be a ${L_CONTROL_PX}px square`);
			expect(await opacityOf(page, selector)).toBe("0.5");
		}
		await expect(page.locator("[data-test-share-slot] a[href], [data-test-downloads-slot] a[href]")).toHaveCount(0);
		await expect(page.locator("[data-share-url]")).toHaveCount(0);
		const html = await page.content();
		expect([html.includes("/view/inbox/"), html.includes("format=epub")]).toEqual([false, false]);

		await page.setViewportSize(PHONE_320);
		await toolbarFitsOneRow(page);
	});

	test("opens one dialog from either control and hands focus back to the control that opened it", async ({
		page,
	}, testInfo) => {
		await openOwnerIssue(page, { stamp: `behaviour-${testInfo.workerIndex}-${Date.now()}`, query: "" });

		await openSharingOff(page, SHARE);
		await page.locator(CLOSE).click();
		await expect(page.locator(`${DIALOG}:popover-open`)).toHaveCount(0);
		await expect(page.locator(SHARE)).toBeFocused();

		await page.locator(DOWNLOAD).focus();
		await page.keyboard.press("Enter");
		await page.waitForSelector(`${DIALOG}:popover-open`);
		await expect(page.locator(CLOSE)).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(page.locator(`${DIALOG}:popover-open`)).toHaveCount(0);
		await expect(page.locator(DOWNLOAD)).toBeFocused();
		expect(await page.locator(DOWNLOAD).evaluate((element) => element.matches(":focus-visible"))).toBe(true);
		expect(await opacityOf(page, DOWNLOAD)).toBe("1");
	});
});

test.describe("Newsletter issue sharing-off dialog on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE, userAgent: MACOS_CHROME_USER_AGENT });

	test("explains why Share is off (light)", async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerIssue(page, { stamp: `dialog-mobile-${testInfo.workerIndex}-${Date.now()}`, query: "" });
		await captureCheckpoint(page, dialogCheckpoint("reader-issue-sharing-off-mobile-light", SHARE));
	});
});
