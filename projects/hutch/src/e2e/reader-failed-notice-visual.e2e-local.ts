import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	measuredBox,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";
import { dismissExtensionSuggestion, stubNativeReaderBridge } from "./reader-failed-notice-visual.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const ARTICLE_TITLE = "A page the crawler could not bring back";
const ARTICLE_BODY = "<p>Seeded body that a failed crawl never shows.</p>";
const SUMMARY = {
	summary: "A fixed summary, so no summary poll runs while the notice is captured.",
	excerpt: "A fixed summary, so no summary poll runs while the notice is captured.",
};

const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const PHONE_VIEWPORT = { width: 390, height: 844 };

const NOTICE = "[data-test-reader-notice].article-body__reader-notice--visible";
const NOTICE_ART = `${NOTICE} [data-test-illustration="book-lightbulb"]`;
const NOTICE_BODY = `${NOTICE} .article-body__reader-notice-text`;
const NOTICE_ACTIONS = `${NOTICE} .article-body__reader-notice-actions`;
const NOTICE_CTA = `${NOTICE} [data-test-reader-failed-primary]`;
const NOTICE_CAPTURE = `${NOTICE} [data-test-reader-action="capture"]`;
const NOTICE_PITCH = `${NOTICE} .article-body__reader-notice-pitch`;
const WITHHELD_PITCH_CLASS = "article-body__reader-notice-pitch article-body__reader-notice-pitch--hidden";
const VOLATILE_CHROME = [".offline-banner", ".newer-version-banner"];

const BODY_LINE_HEIGHT = 22;
const BUTTON_HEIGHT = 48;
const PITCH_GAP = 24;
const DESKTOP_ACTIONS_INSET = 43;
const PHONE_ACTIONS_INSET = 21;

const CRAWL_OUTCOMES = {
	failed: { status: "failed", reason: JSON.stringify({ kind: "fetch-failed" }) },
	blocked: { status: "failed", reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }) },
	"origin-down": { status: "failed", reason: JSON.stringify({ kind: "origin-unreachable" }) },
	"not-found": { status: "failed", reason: JSON.stringify({ kind: "not-found", httpStatus: 404 }) },
	unsupported: { status: "unsupported", reason: JSON.stringify({ kind: "javascript-required" }) },
	"capture-unreadable": {
		status: "failed",
		reason: JSON.stringify({ kind: "capture-unreadable", detail: "no readable article candidate: a game" }),
	},
} as const satisfies Record<string, { status: "failed" | "unsupported"; reason: string }>;

type NoticeVariant = keyof typeof CRAWL_OUTCOMES;
type NoticeCheck = (page: Page) => Promise<void>;

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string().optional() });

async function createOwner(page: Page, stamp: string): Promise<{ email: string; userId: string }> {
	const email = `reader-notice-${stamp}@example.com`;
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await response.json());
	return { email, userId };
}

async function seedArticle(
	page: Page,
	input: { url: string; savedByUserId: string | undefined },
): Promise<string | undefined> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: input.url,
			title: ARTICLE_TITLE,
			content: ARTICLE_BODY,
			contentFetchedAt: CONTENT_FETCHED_AT,
			generatedSummary: SUMMARY,
			savedByUserId: input.savedByUserId,
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
	return SeededArticle.parse(await response.json()).articleId;
}

async function seedCrawlStatus(
	page: Page,
	input: { url: string; status: "pending" } | { url: string; status: "failed" | "unsupported"; reason: string },
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawl-status`, { data: input });
	assert.equal(response.status(), 201, `the crawl-status seed must move the crawl to ${input.status}`);
}

async function settleCrawlAs(page: Page, input: { url: string; variant: NoticeVariant }): Promise<void> {
	await seedCrawlStatus(page, { url: input.url, status: "pending" });
	await seedCrawlStatus(page, { url: input.url, ...CRAWL_OUTCOMES[input.variant] });
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openOwnerReader(
	page: Page,
	input: { stamp: string; variant: NoticeVariant; query: string },
): Promise<void> {
	const owner = await createOwner(page, input.stamp);
	const url = `https://example.com/reader-notice-${input.stamp}`;
	const articleId = await seedArticle(page, { url, savedByUserId: owner.userId });
	assert(articleId, "the seeded article must be saved to the owner");
	await settleCrawlAs(page, { url, variant: input.variant });
	await loginAs(page, owner.email);
	await page.goto(`${BASE_URL}/queue/${articleId}/view${input.query}`, { waitUntil: "domcontentloaded" });
}

function assertNear(measured: { actual: number; expected: number; tolerance: number }, message: string): void {
	assert.ok(
		Math.abs(measured.actual - measured.expected) <= measured.tolerance,
		`${message}: expected ${measured.expected} ± ${measured.tolerance}, measured ${measured.actual}`,
	);
}

function cardHeight(expected: number): NoticeCheck {
	return async (page) => {
		const card = await measuredBox(page, NOTICE);
		assertNear({ actual: card.height, expected, tolerance: 1 }, "the notice card's height, borders included");
	};
}

function bodyLines(lines: number): NoticeCheck {
	return async (page) => {
		const body = await measuredBox(page, NOTICE_BODY);
		assert.equal(body.height, lines * BODY_LINE_HEIGHT, `the notice body runs ${lines} line(s) of 22px`);
	};
}

function actionsInset(expected: number): NoticeCheck {
	return async (page) => {
		const card = await measuredBox(page, NOTICE);
		const actions = await measuredBox(page, NOTICE_ACTIONS);
		assertNear(
			{ actual: actions.x - card.x, expected, tolerance: 0.5 },
			"the actions row starts at the card's border plus its side padding",
		);
	};
}

async function pitchClosesCard(page: Page): Promise<void> {
	const actions = await measuredBox(page, NOTICE_ACTIONS);
	const pitch = await measuredBox(page, NOTICE_PITCH);
	assertNear(
		{ actual: pitch.y - (actions.y + actions.height), expected: PITCH_GAP, tolerance: 0.5 },
		"the capture pitch sits 24px under the actions",
	);
}

async function pitchWithheld(page: Page): Promise<void> {
	assert.equal(
		await page.locator(NOTICE_PITCH).getAttribute("class"),
		WITHHELD_PITCH_CLASS,
		"the card ends at its actions row",
	);
}

async function captureOffered(page: Page): Promise<void> {
	const capture = await measuredBox(page, NOTICE_CAPTURE);
	assert.equal(capture.height, BUTTON_HEIGHT, "the app's capture button is the 48px L button");
}

async function noticeAnatomy(page: Page): Promise<void> {
	const art = await measuredBox(page, NOTICE_ART);
	assert.deepEqual(
		{ width: art.width, height: art.height },
		{ width: 80, height: 64 },
		"the notice art keeps its drawn 80x64",
	);
	assert.equal((await measuredBox(page, NOTICE_CTA)).height, BUTTON_HEIGHT, "the notice CTA is the 48px L button");
	assert.equal(await page.evaluate(pageOverflowsSideways), false, "the notice must never scroll the page sideways");
}

function noticeCheckpoint(input: {
	name: string;
	variant: NoticeVariant | "capture-missing";
	checks: readonly NoticeCheck[];
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: async (page) => {
			await page.mouse.move(0, 0);
			await page.waitForSelector(`${NOTICE}[data-reader-status="${input.variant}"]`);
			await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
		},
		geometry: async (page) => {
			await noticeAnatomy(page);
			for (const check of input.checks) await check(page);
		},
		target: NOTICE,
		capture: "element",
		pinnedText: [],
	};
}

const DESKTOP_WITH_PITCH = [actionsInset(DESKTOP_ACTIONS_INSET), cardHeight(426), pitchClosesCard];

const DESKTOP_OWNER_NOTICES = [
	{ name: "reader-notice-failed-light", variant: "failed", theme: "light", checks: DESKTOP_WITH_PITCH },
	{ name: "reader-notice-failed-dark", variant: "failed", theme: "dark", checks: DESKTOP_WITH_PITCH },
	{ name: "reader-notice-blocked-light", variant: "blocked", theme: "light", checks: DESKTOP_WITH_PITCH },
	{ name: "reader-notice-unsupported-light", variant: "unsupported", theme: "light", checks: DESKTOP_WITH_PITCH },
	{
		name: "reader-notice-origin-down-light",
		variant: "origin-down",
		theme: "light",
		checks: [actionsInset(DESKTOP_ACTIONS_INSET), cardHeight(325), bodyLines(2), pitchWithheld],
	},
	{
		name: "reader-notice-not-found-light",
		variant: "not-found",
		theme: "light",
		checks: [actionsInset(DESKTOP_ACTIONS_INSET), cardHeight(303), bodyLines(1), pitchWithheld],
	},
	{
		name: "reader-notice-capture-unreadable-light",
		variant: "capture-unreadable",
		theme: "light",
		checks: [actionsInset(DESKTOP_ACTIONS_INSET), cardHeight(325), bodyLines(2), pitchWithheld],
	},
] as const satisfies readonly {
	name: string;
	variant: NoticeVariant;
	theme: "light" | "dark";
	checks: readonly NoticeCheck[];
}[];

test.describe("The reader's failed-crawl notice on a desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_VIEWPORT });

	for (const notice of DESKTOP_OWNER_NOTICES) {
		test(`the owner's reader shows the ${notice.variant} notice as its own card (${notice.theme})`, async ({
			page,
		}, testInfo) => {
			await page.addInitScript(dismissExtensionSuggestion);
			await page.emulateMedia({ colorScheme: notice.theme });
			await openOwnerReader(page, {
				stamp: `${notice.name}-${testInfo.workerIndex}-${Date.now()}`,
				variant: notice.variant,
				query: "",
			});

			await captureCheckpoint(page, noticeCheckpoint(notice));
		});
	}

	test("the owner's reader says the copy never arrived when the device gives up on a tapped capture (light)", async ({
		page,
	}, testInfo) => {
		await page.addInitScript(dismissExtensionSuggestion);
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `capture-missing-${testInfo.workerIndex}-${Date.now()}`,
			variant: "blocked",
			query: "",
		});
		await page.waitForSelector(`${NOTICE}[data-reader-status="blocked"]`);
		await page.locator(`${NOTICE}[data-reader-status="blocked"] [data-test-reader-action="capture"]`).dispatchEvent("click");
		await page.waitForSelector('[data-test-reader-slot][data-reader-status="pending"]');
		await page.evaluate(() => document.dispatchEvent(new Event("readplace-capture-failed")));

		await captureCheckpoint(
			page,
			noticeCheckpoint({
				name: "reader-notice-capture-missing-light",
				variant: "capture-missing",
				checks: [actionsInset(DESKTOP_ACTIONS_INSET), cardHeight(325), bodyLines(2), pitchWithheld],
			}),
		);
	});

	test("the public reader shows the same failed notice to a reader who is not signed in", async ({
		page,
	}, testInfo) => {
		await page.addInitScript(dismissExtensionSuggestion);
		await page.emulateMedia({ colorScheme: "light" });
		const path = `example.com/reader-notice-public-${testInfo.workerIndex}-${Date.now()}`;
		const url = `https://${path}`;
		await seedArticle(page, { url, savedByUserId: undefined });
		await settleCrawlAs(page, { url, variant: "failed" });

		await page.goto(`${BASE_URL}/view/${path}`, { waitUntil: "domcontentloaded" });

		await captureCheckpoint(
			page,
			noticeCheckpoint({ name: "reader-notice-failed-public-light", variant: "failed", checks: DESKTOP_WITH_PITCH }),
		);
	});
});

test.describe("The reader's failed-crawl notice on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_VIEWPORT });

	test("the owner's reader keeps the notice and its capture pitch inside the phone's padding", async ({
		page,
	}, testInfo) => {
		await page.addInitScript(dismissExtensionSuggestion);
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `failed-phone-${testInfo.workerIndex}-${Date.now()}`,
			variant: "failed",
			query: "",
		});

		await captureCheckpoint(
			page,
			noticeCheckpoint({
				name: "reader-notice-failed-phone",
				variant: "failed",
				checks: [actionsInset(PHONE_ACTIONS_INSET), pitchClosesCard],
			}),
		);
	});

	test("the iPhone app's reader offers its own capture beside the CTA instead of a pitch", async ({
		page,
	}, testInfo) => {
		await page.addInitScript(stubNativeReaderBridge);
		await page.emulateMedia({ colorScheme: "light" });
		await openOwnerReader(page, {
			stamp: `blocked-chromeless-${testInfo.workerIndex}-${Date.now()}`,
			variant: "blocked",
			query: "?platform=ios",
		});
		await page.waitForSelector("body.page-reader--chromeless");

		await captureCheckpoint(
			page,
			noticeCheckpoint({
				name: "reader-notice-blocked-chromeless-phone",
				variant: "blocked",
				checks: [actionsInset(PHONE_ACTIONS_INSET), captureOffered, pitchWithheld],
			}),
		);
	});
});
