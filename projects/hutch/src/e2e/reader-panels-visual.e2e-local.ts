import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	LENSES,
	NON_TEXT_MINIMUM,
	type Rgb,
	captureCheckpoint,
	contrastRatio,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { MAX_POLLS } from "@packages/web-shell";
import { neutraliseVolatileChrome, pageOverflowsSideways } from "./page-measurements.browser";
import { dismissExtensionSuggestion, stubNativeReaderBridge } from "./reader-failed-notice-visual.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const ARTICLE_TITLE = "Blog examples to inspire a blogging journey";
const ARTICLE_BODY = "<p>Seeded body that sits under the summary panel.</p>";
const TWO_LINE_EXCERPT =
	"This collection showcases a wide variety of blog examples from 2026, covering their different types.";
const NINE_LINE_SUMMARY =
	"This collection showcases a wide variety of blog examples from 2026, covering different types (lifestyle, food, travel, tech, fashion, etc.), platforms (Squarespace, WordPress, Ghost, Shopify), and design styles that match their content. Each blog serves different purposes: some focus on SEO and traffic, some on building authority, some are personal, and others are for business or education. Monetization strategies vary from ads and affiliate links to selling products. The examples include well-known sites like TechCrunch, HubSpot Blog, Beardbrand, A Cup of Jo, and others, each with a brief description of their focus and design. The article aims to provide inspiration for starting a blog by showing diverse approaches to blogging.";

const DESKTOP_VIEWPORT = { width: 1440, height: 1024 };
const PHONE_VIEWPORT = { width: 390, height: 844 };
const PHONE_GUTTER = 16;
const SETTLE_MS = 30000;

const READER_SLOT = "#article-body-reader-slot";
const SUMMARY_SLOT = "#article-body-summary-slot";
const READER_TITLE = `${READER_SLOT} [data-test-reader-pending-title]`;
const READER_DESCRIPTION = `${READER_SLOT} [data-test-reader-pending-text]`;
const READER_PANEL = `${READER_SLOT} .article-body__panel`;
const SUMMARY_TITLE = `${SUMMARY_SLOT} [data-test-summary-pending-title]`;
const SUMMARY_DESCRIPTION = `${SUMMARY_SLOT} [data-test-summary-pending-text]`;
const DISCLOSURE = `${SUMMARY_SLOT} [data-test-tldr]`;
const DISCLOSURE_PREVIEW = `${SUMMARY_SLOT} .tldr-disclosure__preview`;
const DISCLOSURE_TEXT = `${SUMMARY_SLOT} .tldr-disclosure__text`;
const VOLATILE_CHROME = [".offline-banner", ".newer-version-banner"];

const PANEL_WIDTH = 746;
const TRACK_WIDTH = 712;
const DESCRIPTION_GAP = 6;
const SUMMARY_LINE_HEIGHT = 24;
const SHARED_SURFACE = [
	"background-color",
	"border-top-color",
	"border-top-width",
	"border-top-left-radius",
] as const;

type SummarySeed =
	| { generatedSummary: { summary: string; excerpt: string } }
	| { summaryState: { status: "failed" | "skipped"; reason: string } }
	| Record<string, never>;
type CrawlSeed =
	| { status: "pending"; stage?: "crawl-parsed" }
	| { status: "failed" | "unsupported"; reason: string };
type PanelCheck = (page: Page) => Promise<void>;

interface PanelState {
	name: string;
	shows: string;
	slot: string;
	urlSuffix: string;
	summary: SummarySeed;
	crawl: readonly CrawlSeed[];
	polls: (page: Page) => Promise<void>;
	reveal: (page: Page) => Promise<void>;
	shown: readonly PanelCheck[];
	desktop: readonly PanelCheck[];
	phone: boolean;
}

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

async function createOwner(page: Page, stamp: string): Promise<{ email: string; userId: string }> {
	const email = `reader-panels-${stamp}@example.com`;
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	const { userId } = CreatedUser.parse(await response.json());
	return { email, userId };
}

async function seedCrawlStatus(page: Page, input: { url: string } & CrawlSeed): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawl-status`, { data: input });
	assert.equal(response.status(), 201, `the crawl-status seed must move the crawl to ${input.status}`);
}

async function seedOwnerArticle(
	page: Page,
	input: { stamp: string; urlSuffix: string; summary: SummarySeed; crawl: readonly CrawlSeed[] },
): Promise<{ email: string; url: string; readerUrl: string }> {
	const owner = await createOwner(page, input.stamp);
	const url = `https://example.com/reader-panels-${input.stamp}${input.urlSuffix}`;
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url,
			title: ARTICLE_TITLE,
			content: ARTICLE_BODY,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: owner.userId,
			...input.summary,
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
	const { articleId } = SeededArticle.parse(await response.json());
	for (const crawl of input.crawl) await seedCrawlStatus(page, { url, ...crawl });
	return { email: owner.email, url, readerUrl: `${BASE_URL}/queue/${articleId}/view` };
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function holdPolls(page: Page): Promise<void> {
	await page.route("**/queue/*/reader?*", (route) => route.fulfill({ status: 204 }));
	await page.route("**/queue/*/summary?*", (route) => route.fulfill({ status: 204 }));
}

async function exhaustSummaryPolls(page: Page): Promise<void> {
	await page.route("**/queue/*/summary?*", (route) => {
		const poll = new URL(route.request().url());
		poll.searchParams.set("poll", String(MAX_POLLS));
		return route.continue({ url: poll.toString() });
	});
}

async function holdReaderPollsAfterTheCaptureStarts(page: Page): Promise<void> {
	await page.route("**/queue/*/reader?*", (route) => route.fulfill({ status: 204 }));
	await page.route("**/queue/*/reader?poll=1&*", (route) => route.continue());
}

async function openOwnerReader(page: Page, input: { state: PanelState; stamp: string }): Promise<void> {
	const seeded = await seedOwnerArticle(page, {
		stamp: input.stamp,
		urlSuffix: input.state.urlSuffix,
		summary: input.state.summary,
		crawl: input.state.crawl,
	});
	await loginAs(page, seeded.email);
	await input.state.polls(page);
	await page.goto(seeded.readerUrl, { waitUntil: "domcontentloaded" });
}

async function readerPendingShown(page: Page): Promise<void> {
	await expect(page.locator(READER_SLOT)).toHaveAttribute("data-reader-status", "pending", {
		timeout: SETTLE_MS,
	});
	await expect(page.locator(READER_TITLE)).toHaveText("Preparing your reader view");
}

async function captureStarted(page: Page): Promise<void> {
	await expect(page.locator(READER_TITLE)).toHaveText("Copying the page from your device", {
		timeout: SETTLE_MS,
	});
	await expect(page.locator(READER_SLOT)).toHaveAttribute("data-reader-status", "pending");
	await expect(page.locator(READER_SLOT)).toBeVisible();
}

async function summaryPendingShown(page: Page): Promise<void> {
	await expect(page.locator(SUMMARY_SLOT)).toHaveAttribute("data-summary-status", "pending", {
		timeout: SETTLE_MS,
	});
	await expect(page.locator(SUMMARY_TITLE)).toHaveText("Generating summary");
}

async function summaryExhaustedShown(page: Page): Promise<void> {
	await expect(page.locator(SUMMARY_DESCRIPTION)).toBeVisible({ timeout: SETTLE_MS });
	await expect(page.locator(SUMMARY_DESCRIPTION)).toHaveText("Taking a while — refresh to check again.");
	await expect(page.locator(SUMMARY_SLOT)).toHaveAttribute("data-summary-status", "pending");
	await expect(page.locator(SUMMARY_SLOT)).not.toHaveAttribute("hx-get");
}

async function summaryReadyShown(page: Page): Promise<void> {
	await expect(page.locator(SUMMARY_SLOT)).toHaveAttribute("data-summary-status", "ready", {
		timeout: SETTLE_MS,
	});
	await expect(page.locator(DISCLOSURE)).toBeVisible();
}

async function summaryExpanded(page: Page): Promise<void> {
	await summaryReadyShown(page);
	await page.locator(`${DISCLOSURE} summary`).click();
	await expect(page.locator(DISCLOSURE)).toHaveAttribute("open", "");
}

function summaryAlertShown(key: "reader-summary-failed" | "reader-summary-skipped"): PanelCheck {
	return async (page) => {
		await expect(page.locator(`${SUMMARY_SLOT} [data-test-alert="${key}"]`)).toBeVisible({
			timeout: SETTLE_MS,
		});
	};
}

async function summaryCollapsedAsSkipped(page: Page): Promise<void> {
	const slot = page.locator("[data-test-reader-summary]");
	await expect(slot).toHaveAttribute("data-summary-status", "skipped", { timeout: SETTLE_MS });
	await expect(slot).toHaveClass(/article-body__summary-slot--hidden/);
}

function assertNear(measured: { actual: number; expected: number; tolerance: number }, message: string): void {
	assert.ok(
		Math.abs(measured.actual - measured.expected) <= measured.tolerance,
		`${message}: expected ${measured.expected} ± ${measured.tolerance}, measured ${measured.actual}`,
	);
}

function slotHeight(slot: string, expected: number): PanelCheck {
	return async (page) => {
		const box = await measuredBox(page, slot);
		assertNear({ actual: box.height, expected, tolerance: 2 }, `the height of ${slot}, borders included`);
	};
}

function panelWidth(slot: string): PanelCheck {
	return async (page) => {
		const box = await measuredBox(page, slot);
		assertNear(
			{ actual: box.width, expected: PANEL_WIDTH, tolerance: 1 },
			`${slot} spans the header card's content width`,
		);
	};
}

function progressReads(slot: string, percent: number): PanelCheck {
	return async (page) => {
		await expect(page.locator(`${slot} [data-test-progress-label]`)).toHaveText(`${percent}% complete`);
		const track = await measuredBox(page, `${slot} [role="progressbar"]`);
		const fill = await measuredBox(page, `${slot} .article-body__progress-fill`);
		assertNear(
			{ actual: fill.width / track.width, expected: percent / 100, tolerance: 0.01 },
			"the fill covers the share of its track that the label reads",
		);
	};
}

function trackSpansThePanel(slot: string): PanelCheck {
	return async (page) => {
		const track = await measuredBox(page, `${slot} [role="progressbar"]`);
		assertNear(
			{ actual: track.width, expected: TRACK_WIDTH, tolerance: 0.5 },
			"the track spans the panel's inner width",
		);
	};
}

function rgbOf(colour: string): Rgb {
	const channels = colour.match(/[\d.]+/g);
	assert.ok(channels && channels.length >= 3, `expected an rgb() colour, got "${colour}"`);
	return { red: Number(channels[0]), green: Number(channels[1]), blue: Number(channels[2]) };
}

async function fillStandsOutFromItsTrack(page: Page): Promise<void> {
	const fill = rgbOf(
		await page
			.locator(`${READER_SLOT} .article-body__progress-fill`)
			.evaluate((el) => getComputedStyle(el).backgroundColor),
	);
	const track = rgbOf(
		await page.locator(`${READER_SLOT} [role="progressbar"]`).evaluate((el) => getComputedStyle(el).backgroundColor),
	);
	for (const [lens, project] of Object.entries(LENSES)) {
		const ratio = contrastRatio({ ink: project(fill), surface: project(track) });
		assert.ok(
			ratio >= NON_TEXT_MINIMUM,
			`${lens}: the fill reads ${ratio.toFixed(2)}:1 against its track, below ${NON_TEXT_MINIMUM}:1`,
		);
	}
}

async function hintSitsUnderTheDescription(page: Page): Promise<void> {
	await expect(page.locator(READER_DESCRIPTION)).toHaveCount(2);
	const description = await measuredBox(page, `${READER_DESCRIPTION} >> nth=0`);
	const hint = await measuredBox(page, `${READER_DESCRIPTION} >> nth=1`);
	assertNear(
		{ actual: hint.y - (description.y + description.height), expected: DESCRIPTION_GAP, tolerance: 0.5 },
		"the PDF hint sits 6px under the description",
	);
}

function previewRuns(lines: number): PanelCheck {
	return async (page) => {
		const preview = await measuredBox(page, DISCLOSURE_PREVIEW);
		assertNear(
			{ actual: preview.height, expected: lines * SUMMARY_LINE_HEIGHT, tolerance: 1 },
			`the collapsed preview runs ${lines} lines of 24px`,
		);
	};
}

function summaryTextRuns(lines: number): PanelCheck {
	return async (page) => {
		const padding = await page
			.locator(DISCLOSURE_TEXT)
			.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingTop) + Number.parseFloat(getComputedStyle(el).paddingBottom));
		const text = await measuredBox(page, DISCLOSURE_TEXT);
		assertNear(
			{ actual: text.height - padding, expected: lines * SUMMARY_LINE_HEIGHT, tolerance: 1 },
			`the open summary runs ${lines} lines of 24px`,
		);
	};
}

function fitsThePhone(slot: string): PanelCheck {
	return async (page) => {
		const box = await measuredBox(page, slot);
		assert.ok(
			box.x + box.width <= PHONE_VIEWPORT.width - PHONE_GUTTER,
			`${slot} must end inside the phone's ${PHONE_GUTTER}px gutter, measured its right edge at ${box.x + box.width}`,
		);
		assert.equal(await page.evaluate(pageOverflowsSideways), false, "a panel must never scroll the page sideways");
	};
}

async function sharesOneSurface(page: Page): Promise<void> {
	const disclosure = page.locator(`${SUMMARY_SLOT} .tldr-disclosure`);
	await expect(disclosure).toHaveCSS("border-top-width", "1px");
	await expect(disclosure).toHaveCSS("border-top-left-radius", "8px");
	await expect(disclosure).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	for (const property of SHARED_SURFACE) {
		const drawn = await disclosure.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
		await expect(page.locator(READER_PANEL)).toHaveCSS(property, drawn);
	}
}

function panelCheckpoint(input: {
	name: string;
	slot: string;
	reveal: (page: Page) => Promise<void>;
	checks: readonly PanelCheck[];
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: async (page) => {
			await input.reveal(page);
			await page.evaluate(neutraliseVolatileChrome, { volatile: VOLATILE_CHROME, times: [] });
		},
		geometry: async (page) => {
			for (const check of input.checks) await check(page);
		},
		target: input.slot,
		capture: "element",
		pinnedText: [],
	};
}

const PANEL_STATES = [
	{
		name: "reader-pending",
		shows: "a crawl in flight shows the reader panel with its own progress",
		slot: READER_SLOT,
		urlSuffix: "",
		summary: {},
		crawl: [{ status: "pending", stage: "crawl-parsed" }],
		polls: holdPolls,
		reveal: readerPendingShown,
		shown: [progressReads(READER_SLOT, 49), fillStandsOutFromItsTrack],
		desktop: [trackSpansThePanel(READER_SLOT), slotHeight(READER_SLOT, 136)],
		phone: true,
	},
	{
		name: "reader-pending-pdf",
		shows: "a PDF in flight adds the scan hint under the description",
		slot: READER_SLOT,
		urlSuffix: ".pdf",
		summary: {},
		crawl: [{ status: "pending", stage: "crawl-parsed" }],
		polls: holdPolls,
		reveal: readerPendingShown,
		shown: [progressReads(READER_SLOT, 49)],
		desktop: [hintSitsUnderTheDescription, trackSpansThePanel(READER_SLOT)],
		phone: false,
	},
	{
		name: "summary-pending",
		shows: "a summary in flight shows its panel with its own progress",
		slot: SUMMARY_SLOT,
		urlSuffix: "",
		summary: {},
		crawl: [],
		polls: holdPolls,
		reveal: summaryPendingShown,
		shown: [progressReads(SUMMARY_SLOT, 29)],
		desktop: [trackSpansThePanel(SUMMARY_SLOT), slotHeight(SUMMARY_SLOT, 109)],
		phone: true,
	},
	{
		name: "summary-pending-exhausted",
		shows: "a summary that outlasts its polls says so and stops claiming progress",
		slot: SUMMARY_SLOT,
		urlSuffix: "",
		summary: {},
		crawl: [],
		polls: exhaustSummaryPolls,
		reveal: summaryExhaustedShown,
		shown: [],
		desktop: [slotHeight(SUMMARY_SLOT, 83)],
		phone: false,
	},
	{
		name: "summary-ready-collapsed",
		shows: "a ready summary previews two lines while collapsed",
		slot: SUMMARY_SLOT,
		urlSuffix: "",
		summary: { generatedSummary: { summary: NINE_LINE_SUMMARY, excerpt: TWO_LINE_EXCERPT } },
		crawl: [],
		polls: holdPolls,
		reveal: summaryReadyShown,
		shown: [],
		desktop: [previewRuns(2), slotHeight(SUMMARY_SLOT, 118)],
		phone: true,
	},
	{
		name: "summary-ready-expanded",
		shows: "a ready summary opens to its whole text",
		slot: SUMMARY_SLOT,
		urlSuffix: "",
		summary: { generatedSummary: { summary: NINE_LINE_SUMMARY, excerpt: TWO_LINE_EXCERPT } },
		crawl: [],
		polls: holdPolls,
		reveal: summaryExpanded,
		shown: [],
		desktop: [summaryTextRuns(9), slotHeight(SUMMARY_SLOT, 286)],
		phone: false,
	},
	{
		name: "summary-failed",
		shows: "a failed summary is an error alert with fixed copy",
		slot: SUMMARY_SLOT,
		urlSuffix: "",
		summary: { summaryState: { status: "failed", reason: "deepseek timeout" } },
		crawl: [],
		polls: holdPolls,
		reveal: summaryAlertShown("reader-summary-failed"),
		shown: [],
		desktop: [slotHeight(SUMMARY_SLOT, 77)],
		phone: true,
	},
	{
		name: "summary-skipped",
		shows: "a skipped summary is an info alert naming the reason",
		slot: SUMMARY_SLOT,
		urlSuffix: "",
		summary: { summaryState: { status: "skipped", reason: "content-too-short" } },
		crawl: [],
		polls: holdPolls,
		reveal: summaryAlertShown("reader-summary-skipped"),
		shown: [],
		desktop: [slotHeight(SUMMARY_SLOT, 56)],
		phone: true,
	},
] as const satisfies readonly PanelState[];

test.describe("The reader's pipeline panels on a desktop", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_VIEWPORT });

	for (const state of PANEL_STATES) {
		for (const theme of ["light", "dark"] as const) {
			test(`${state.shows} (${theme})`, async ({ page }, testInfo) => {
				await page.addInitScript(dismissExtensionSuggestion);
				await page.emulateMedia({ colorScheme: theme });
				await openOwnerReader(page, {
					state,
					stamp: `${state.name}-${theme}-${testInfo.workerIndex}-${Date.now()}`,
				});

				await captureCheckpoint(
					page,
					panelCheckpoint({
						name: `${state.name}-${theme}`,
						slot: state.slot,
						reveal: state.reveal,
						checks: [...state.shown, panelWidth(state.slot), ...state.desktop],
					}),
				);
			});
		}
	}

	test("the app's reader says it is copying the page while its own capture runs", async ({
		page,
	}, testInfo) => {
		await page.addInitScript(stubNativeReaderBridge);
		await page.emulateMedia({ colorScheme: "light" });
		const seeded = await seedOwnerArticle(page, {
			stamp: `capture-${testInfo.workerIndex}-${Date.now()}`,
			urlSuffix: "",
			summary: {},
			crawl: [
				{ status: "pending" },
				{ status: "failed", reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }) },
			],
		});
		await loginAs(page, seeded.email);
		await holdReaderPollsAfterTheCaptureStarts(page);
		await page.goto(`${seeded.readerUrl}?platform=ios`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-reader--chromeless");

		await page.locator('[data-test-reader-action="capture"]').click();

		await captureCheckpoint(
			page,
			panelCheckpoint({
				name: "reader-pending-capture-light",
				slot: READER_SLOT,
				reveal: captureStarted,
				checks: [slotHeight(READER_SLOT, 52)],
			}),
		);
	});

	test("the pending reader panel and the ready summary draw one surface", async ({ page }, testInfo) => {
		await page.addInitScript(dismissExtensionSuggestion);
		const seeded = await seedOwnerArticle(page, {
			stamp: `parity-${testInfo.workerIndex}-${Date.now()}`,
			urlSuffix: "",
			summary: { generatedSummary: { summary: NINE_LINE_SUMMARY, excerpt: TWO_LINE_EXCERPT } },
			crawl: [{ status: "pending" }],
		});
		await loginAs(page, seeded.email);
		await holdPolls(page);

		await page.goto(seeded.readerUrl, { waitUntil: "domcontentloaded" });

		await readerPendingShown(page);
		await summaryReadyShown(page);
		await sharesOneSurface(page);
	});

	test("a summary the crawl's verdict skipped stays collapsed through a recrawl", async ({
		page,
	}, testInfo) => {
		await page.addInitScript(dismissExtensionSuggestion);
		const seeded = await seedOwnerArticle(page, {
			stamp: `crawl-verdict-${testInfo.workerIndex}-${Date.now()}`,
			urlSuffix: "",
			summary: { summaryState: { status: "skipped", reason: "crawl-unsupported" } },
			crawl: [{ status: "pending" }],
		});
		await loginAs(page, seeded.email);

		await page.goto(seeded.readerUrl, { waitUntil: "domcontentloaded" });

		await readerPendingShown(page);
		await summaryCollapsedAsSkipped(page);

		await seedCrawlStatus(page, {
			url: seeded.url,
			status: "unsupported",
			reason: JSON.stringify({ kind: "javascript-required" }),
		});
		await page.reload({ waitUntil: "domcontentloaded" });

		await expect(page.locator("[data-test-reader-notice]")).toHaveAttribute("data-reader-status", "unsupported", {
			timeout: SETTLE_MS,
		});
		await expect(page.locator("[data-test-reader-notice]")).toBeVisible();
		await summaryCollapsedAsSkipped(page);
	});
});

test.describe("The reader's pipeline panels on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_VIEWPORT });

	for (const state of PANEL_STATES.filter((candidate) => candidate.phone)) {
		test(`${state.shows}, inside the phone's padding`, async ({ page }, testInfo) => {
			await page.addInitScript(dismissExtensionSuggestion);
			await page.emulateMedia({ colorScheme: "light" });
			await openOwnerReader(page, {
				state,
				stamp: `${state.name}-phone-${testInfo.workerIndex}-${Date.now()}`,
			});

			await captureCheckpoint(
				page,
				panelCheckpoint({
					name: `${state.name}-phone`,
					slot: state.slot,
					reveal: state.reveal,
					checks: [...state.shown, fitsThePhone(state.slot)],
				}),
			);
		});
	}
});
