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
import { clickAndWaitForPageReload } from "./page-interactions";
import { measureBoxes } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

// Fixed instants so the version labels never drift with wall-clock time.
// The pinned timezoneId below makes the client-side re-localisation resolve to
// the same UTC value — so the rendered labels are byte-stable across runs.
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEEDED_BODY =
	"<p>Seeded article body for the article-history visual regression test.</p>";
const NEWEST_VERSION = "2026-07-10T09:14Z";
const MULTI_VERSION_ARTICLE = {
	url: "https://example.com/article-history-visual",
	crawlVersions: [NEWEST_VERSION, "2026-06-28T22:01Z", "2026-03-26T14:32Z"],
};
const SINGLE_VERSION_ARTICLE = {
	url: "https://example.com/article-history-single",
	crawlVersions: [NEWEST_VERSION],
};
const OWNER_PASSWORD = "password123";

const CARD = "[data-test-article-history]";
const HEADER = `${CARD} > summary`;
const BODY = `${CARD} > .disclosure-card__body`;
const ROW = `${CARD} [data-test-article-history-version]`;
const MARKER = `${CARD} .article-history__marker`;
const BADGE = `${CARD} [data-test-article-history-badge]`;
const DATE = `${CARD} time[data-local-time="date"]`;
const TIME = `${CARD} time[data-local-time="time"]`;
const RAIL = "[data-test-reader-rail]";
const FALLBACK_FORM = `${CARD} [data-test-article-history-remove]`;
const TRIGGER = `${CARD} [data-test-action="article-version-delete-open"]`;
const PANEL = '[data-test-confirm-popover="article-version-delete"]';
const CANCEL = `${PANEL} [data-test-action="article-version-delete-cancel"]`;
const CONFIRM = `${PANEL} [data-test-action="article-version-delete-confirm"]`;

const HEADER_HEIGHT = 64;
const CARD_EDGE = 1;
const BODY_INSET = 20;
const ROW_PITCH = 64;
const SINGLE_VERSION_BODY = 80;
const DESKTOP_RAIL_TRACK = 340;
const PHONE = { width: 390, height: 844 };
const PHONE_GUTTER = 20;

interface SeededArticle {
	url: string;
	crawlVersions: string[];
}

async function postSeed(page: Page, data: object): Promise<unknown> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, { data });
	assert.equal(response.status(), 201, "seed endpoint must create the crawled article");
	return response.json();
}

async function seedCrawledArticle(page: Page, article: SeededArticle): Promise<void> {
	await postSeed(page, {
		url: article.url,
		title: "Article History Visual",
		content: SEEDED_BODY,
		contentFetchedAt: CONTENT_FETCHED_AT,
		crawlVersions: article.crawlVersions.map((crawledAtMinute) => ({ crawledAtMinute })),
	});
}

const SeededAuthoredArticle = z.object({ articleId: z.string() });

async function seedAuthoredArticle(
	page: Page,
	params: { article: SeededArticle; ownerUserId: string; authoredMinuteIds: string[] },
): Promise<string> {
	const body = await postSeed(page, {
		url: params.article.url,
		title: "Article History Visual",
		content: SEEDED_BODY,
		contentFetchedAt: CONTENT_FETCHED_AT,
		crawlVersions: params.article.crawlVersions.map((crawledAtMinute) => ({
			crawledAtMinute,
			authorUserId: params.authoredMinuteIds.includes(crawledAtMinute)
				? params.ownerUserId
				: undefined,
		})),
		savedByUserId: params.ownerUserId,
	});
	return SeededAuthoredArticle.parse(body).articleId;
}

function canonicalPathOf(article: SeededArticle): string {
	const { host, pathname } = new URL(article.url);
	return `${host}${pathname}`;
}

async function historySettled(page: Page): Promise<void> {
	await page.waitForSelector(CARD);
	await expect(page.locator(TIME).first()).toHaveText("09:14 AM");
}

async function openPublicView(page: Page, article: SeededArticle): Promise<void> {
	await seedCrawledArticle(page, article);
	await page.goto(`${BASE_URL}/view/${canonicalPathOf(article)}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-view");
	await historySettled(page);
	await waitForBrandFonts(page, ["Inter"]);
}

function assertNear(measured: { actual: number; expected: number }, message: string): void {
	assert.ok(
		Math.abs(measured.actual - measured.expected) <= 0.5,
		`${message}: expected ${measured.expected}, measured ${measured.actual}`,
	);
}

async function boxesOf(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }[]> {
	const boxes = await Promise.all((await page.locator(selector).all()).map((each) => each.boundingBox()));
	return boxes.map((box) => {
		assert.ok(box, `every "${selector}" must be laid out with a measurable bounding box`);
		return box;
	});
}

async function cardFillsItsTrack(page: Page, track: number): Promise<void> {
	const [card, rail] = await page.evaluate(measureBoxes, [CARD, RAIL]);
	assertNear({ actual: rail.width, expected: track }, `the rail's track is ${track}px wide`);
	assertNear({ actual: card.width, expected: rail.width }, "the card is as wide as its rail track");
	assertNear({ actual: card.x, expected: rail.x }, "the card starts at its rail track's left edge");
}

async function timelineGeometry(page: Page, versions: number): Promise<void> {
	const [body] = await page.evaluate(measureBoxes, [BODY]);
	const markers = await boxesOf(page, MARKER);
	assert.equal(markers.length, versions, `the card lists ${versions} version${versions === 1 ? "" : "s"}`);
	for (const marker of markers) {
		assert.deepEqual({ width: marker.width, height: marker.height }, { width: 20, height: 20 }, "a version marker is 20px square");
	}
	assertNear(
		{ actual: markers[0].y, expected: body.y + CARD_EDGE + BODY_INSET },
		"the first marker sits 20px under the body's 1px divider",
	);
	for (const [index, marker] of markers.entries()) {
		assertNear(
			{ actual: marker.y, expected: markers[0].y + index * ROW_PITCH },
			`version ${index + 1} sits on the 64px row pitch`,
		);
	}
	const badges = await boxesOf(page, BADGE);
	assert.deepEqual(
		badges.map((badge) => badge.height),
		[22],
		"only the newest version carries a badge, at the 22px badge height",
	);
	await expect(page.locator(BADGE)).toHaveText(["Current"]);
}

function publicCheckpoint(input: { name: string; versions: number; track: number }): VisualCheckpoint {
	return {
		name: input.name,
		settled: historySettled,
		geometry: async (page) => {
			await cardFillsItsTrack(page, input.track);
			await timelineGeometry(page, input.versions);
		},
		target: CARD,
		capture: "element",
		pinnedText: [],
	};
}

async function singleVersionGeometry(page: Page): Promise<void> {
	await cardFillsItsTrack(page, DESKTOP_RAIL_TRACK);
	await timelineGeometry(page, 1);
	const [card, body] = await page.evaluate(measureBoxes, [CARD, BODY]);
	assertNear(
		{ actual: body.height, expected: CARD_EDGE + SINGLE_VERSION_BODY },
		"one version's body is 80px under its 1px divider",
	);
	assertNear(
		{ actual: card.height, expected: 2 * CARD_EDGE + HEADER_HEIGHT + CARD_EDGE + SINGLE_VERSION_BODY },
		"the one-version card is its header, its divider and its body inside the 1px border",
	);
}

async function collapsedSettled(page: Page): Promise<void> {
	await expect(page.locator(`${CARD}:not([open])`)).toHaveCount(1);
	await expect(page.locator(ROW).first()).toBeHidden();
}

async function collapsedGeometry(page: Page): Promise<void> {
	await cardFillsItsTrack(page, DESKTOP_RAIL_TRACK);
	const [card] = await page.evaluate(measureBoxes, [CARD]);
	assert.equal(card.height, HEADER_HEIGHT + 2 * CARD_EDGE, "the closed card is its header inside the 1px border");
}

const COLLAPSED_LIGHT: VisualCheckpoint = {
	name: "article-history-collapsed-light",
	settled: collapsedSettled,
	geometry: collapsedGeometry,
	target: CARD,
	capture: "element",
	pinnedText: [],
};

test.describe("Article history visual regression", () => {
	// Pin the browser timezone so the client-side re-localisation of the crawl
	// instant is deterministic and matches the server's UTC formatting.
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	for (const scheme of ["light", "dark"] as const) {
		test(`one version is a single current row under the header (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openPublicView(page, SINGLE_VERSION_ARTICLE);
			await captureCheckpoint(page, {
				name: `article-history-single-${scheme}`,
				settled: historySettled,
				geometry: singleVersionGeometry,
				target: CARD,
				capture: "element",
				pinnedText: [],
			});
		});

		test(`several versions run newest first down a dashed timeline (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openPublicView(page, MULTI_VERSION_ARTICLE);
			await captureCheckpoint(
				page,
				publicCheckpoint({ name: `article-history-versions-${scheme}`, versions: 3, track: DESKTOP_RAIL_TRACK }),
			);
		});
	}

	test("the header keeps its height open and closed, and the closed card is the header alone", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, MULTI_VERSION_ARTICLE);
		const [openHeader] = await page.evaluate(measureBoxes, [HEADER]);

		await page.locator(HEADER).click();
		await page.mouse.move(5, 5);
		await collapsedSettled(page);

		const [closedHeader] = await page.evaluate(measureBoxes, [HEADER]);
		assert.deepEqual(
			[openHeader.height, closedHeader.height],
			[HEADER_HEIGHT, HEADER_HEIGHT],
			"the card's header height is 64px whether it is open or closed",
		);
		await captureCheckpoint(page, COLLAPSED_LIGHT);
	});
});

test.describe("Article history on a phone", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE });

	test("the card follows the article at the column's full width", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openPublicView(page, MULTI_VERSION_ARTICLE);
		await page.locator(CARD).evaluate((card) => card.scrollIntoView({ block: "center", behavior: "instant" }));
		await captureCheckpoint(
			page,
			publicCheckpoint({
				name: "article-history-phone-light",
				versions: 3,
				track: PHONE.width - 2 * PHONE_GUTTER,
			}),
		);
	});
});

const CreatedUser = z.union([
	z.object({ ok: z.literal(true), userId: z.string() }),
	z.object({ ok: z.literal(false), reason: z.string() }),
]);

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	const created = CreatedUser.parse(await response.json());
	assert(created.ok, `the e2e user fixture must create the owner ${email}`);
	return created.userId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openOwnerReader(page: Page, stamp: string): Promise<void> {
	const email = `history-owner-${stamp}@example.com`;
	const ownerUserId = await createOwner(page, email);
	const articleId = await seedAuthoredArticle(page, {
		article: {
			url: `https://example.com/article-history-authored-${stamp}`,
			crawlVersions: [NEWEST_VERSION, "2026-06-28T22:01Z"],
		},
		ownerUserId,
		authoredMinuteIds: [NEWEST_VERSION],
	});
	await loginAs(page, email);
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-reader");
	await historySettled(page);
}

async function deleteControlSettled(page: Page): Promise<void> {
	await historySettled(page);
	await expect(page.locator(TRIGGER)).toHaveCount(1);
	await expect(page.locator(TRIGGER)).toBeVisible();
	await expect(page.locator(FALLBACK_FORM)).toBeHidden();
}

async function deleteControlGeometry(page: Page): Promise<void> {
	await cardFillsItsTrack(page, DESKTOP_RAIL_TRACK);
	await timelineGeometry(page, 2);
	const [card, firstMarker, trigger, glyph] = await page.evaluate(measureBoxes, [
		CARD,
		MARKER,
		TRIGGER,
		`${TRIGGER} svg`,
	]);
	assert.deepEqual({ width: trigger.width, height: trigger.height }, { width: 32, height: 32 }, "the trash is a 32px button");
	assert.deepEqual({ width: glyph.width, height: glyph.height }, { width: 24, height: 24 }, "the trash glyph is 24px");
	assertNear({ actual: glyph.y, expected: firstMarker.y }, "the trash glyph starts on its row's top edge");
	assertNear(
		{ actual: glyph.x + glyph.width, expected: card.x + card.width - CARD_EDGE - BODY_INSET },
		"the trash glyph ends on the body's 20px inset",
	);
}

async function confirmDelete(page: Page): Promise<void> {
	await expect(page.locator(CONFIRM)).toBeFocused();
	const posted = page.waitForRequest((request) => request.method() === "POST" && request.isNavigationRequest());
	await clickAndWaitForPageReload(page, page.locator(CONFIRM));
	await posted;
	await page.waitForSelector("body.page-reader");
	await historySettled(page);
}

test.describe("Article history delete-version control", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	for (const scheme of ["light", "dark"] as const) {
		test(`the version its owner authored carries the only trash (${scheme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openOwnerReader(page, `${scheme}-${testInfo.workerIndex}-${Date.now()}`);
			await captureCheckpoint(page, {
				name: `article-history-delete-${scheme}`,
				settled: deleteControlSettled,
				geometry: deleteControlGeometry,
				target: CARD,
				capture: "element",
				pinnedText: [],
			});
		});
	}

	test("the trash asks before it deletes: Cancel keeps the reader, and Delete version posts and lands back on it", async ({
		page,
	}, testInfo) => {
		await openOwnerReader(page, `dialog-${testInfo.workerIndex}-${Date.now()}`);
		await deleteControlSettled(page);
		const panel = page.locator(PANEL);
		const trigger = await measuredBox(page, TRIGGER);

		await page.mouse.click(trigger.x - 5, trigger.y + trigger.height / 2);
		await expect(panel, "a press 5px outside the 32px button still lands on its 44px hit area").toBeVisible();
		await expect(panel.locator(".confirm-popover__title")).toHaveText("Delete this version?");
		await page.locator(CANCEL).click();
		await expect(panel).toBeHidden();
		await expect(page.locator(ROW)).toHaveCount(2);

		await page.locator(TRIGGER).click();
		await expect(panel).toBeVisible();
		await confirmDelete(page);

		await expect(page.locator(ROW)).toHaveCount(2);
		await expect(page.locator(PANEL)).toBeHidden();
	});
});

test.describe("Article history without client JavaScript", () => {
	test.use({
		timezoneId: "UTC",
		viewport: { width: 375, height: 800 },
		javaScriptEnabled: false,
	});

	test("the card is open with its UTC stamps, the native summary closes it, and the dialog still deletes", async ({
		page,
	}, testInfo) => {
		await openOwnerReader(page, `no-js-${testInfo.workerIndex}-${Date.now()}`);
		await expect(page.locator(DATE)).toHaveText(["Jul 10, 2026", "Jun 28, 2026"]);
		await expect(page.locator(TIME)).toHaveText(["09:14 AM", "10:01 PM"]);
		await expect(page.locator(ROW).first()).toBeVisible();

		await page.locator(HEADER).click();
		await expect(page.locator(ROW).first()).toBeHidden();
		await page.locator(HEADER).click();
		await expect(page.locator(ROW).first()).toBeVisible();

		await page.locator(TRIGGER).click();
		await expect(page.locator(PANEL)).toBeVisible();
		await confirmDelete(page);

		await expect(page.locator(ROW)).toHaveCount(2);
	});
});
