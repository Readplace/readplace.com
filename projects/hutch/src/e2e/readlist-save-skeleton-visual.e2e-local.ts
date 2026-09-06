import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	expect,
	test,
	type VisualCheckpoint,
	waitForImagePixels,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "../runtime/web/shared/save-tip/save-tip-cookie";
import { measureBoxes, neutraliseVolatileChrome, pageOverflowsSideways } from "./readlist-nav.browser";
import { measureDocumentBoxes, pinSaveBarValue } from "./readlist-save-skeleton.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "password123";
const SETTLE_MS = 45000;
const MINIMUM_TOUCH_TARGET = 44;
const LAYOUT_TOLERANCE_PX = 1;

const DESKTOP = { width: 1280, height: 900 };
const DESKTOP_TALL = { width: 1280, height: 1700 };
const PHONE_TALL = { width: 390, height: 2000 };

const SAVE_FORM = '[data-test-form="save-article"]';
const SAVE_INPUT = `${SAVE_FORM} input[name="url"]`;
const SAVE_BUTTON = `${SAVE_FORM} button[type="submit"]`;
const SAVE_FORM_IN_FLIGHT = `${SAVE_FORM}.htmx-request`;
const SAVING_LABEL = `${SAVE_FORM} .readlist__save-btn-saving`;
const SKELETON = "main.readlist [data-test-save-skeleton]";
const SKELETON_HEADER = `${SKELETON} .readlist-save-skeleton__header`;
const SORT_ROW = "main.readlist .readlist__sort";
const LIST = "[data-test-article-list]";
const CARD = "[data-test-article]";
const FIRST_CARD = `${LIST} > ${CARD}:first-child`;
const PENDING_CARD = '[data-card-status="pending"]';
const EMPTY = "main.readlist [data-test-empty-readlist]";
const SAVE_ERROR = "[data-test-save-error]";
const UNREAD_FILTER_TAB = 'main.readlist [data-test-filter="unread"]';
const AVATAR = "main.readlist .onboarding__avatar";

const PINNED_SAVE_URL = "https://example.com/an-article-being-saved";

const SEEDED_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEEDED_ARTICLES = [
	{
		url: "https://example.com/whole-page-readlist-second",
		title: "The second article in the readlist",
		savedAt: "2026-07-11T09:14:00.000Z",
		excerpt:
			"A fixed excerpt, long enough to occupy the two lines a real card excerpt occupies on both the phone and the desktop layout.",
	},
	{
		url: "https://example.com/whole-page-readlist-first",
		title: "The article at the top of the readlist",
		savedAt: "2026-07-12T09:14:00.000Z",
		excerpt:
			"A fixed excerpt, long enough to occupy the two lines a real card excerpt occupies on both the phone and the desktop layout.",
	},
];

const STUB_ARTICLE = {
	url: "https://example.com/whole-page-readlist-stub",
	title: "Article from example.com",
	savedAt: "2026-07-13T09:14:00.000Z",
	excerpt: "Saved from example.com.",
};

const PINNED_SAVED_TIMES = ["just now", "2 days ago", "3 days ago"];
const VOLATILE_CHROME = [
	".trial-countdown",
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

interface SeedArticle {
	url: string;
	title: string;
	savedAt: string;
	excerpt: string;
	summarised: boolean;
}

async function createVerifiedUser(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await created.json()).userId;
}

async function seedArticles(
	page: Page,
	input: { userId: string; articles: readonly SeedArticle[] },
): Promise<void> {
	for (const article of input.articles) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: article.url,
				title: article.title,
				content: "<p>Seeded body for the save-skeleton baseline.</p>",
				contentFetchedAt: SEEDED_FETCHED_AT,
				savedAt: article.savedAt,
				savedByUserId: input.userId,
				excerpt: article.excerpt,
				...(article.summarised
					? { generatedSummary: { summary: "Seeded summary.", excerpt: article.excerpt } }
					: {}),
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	}
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page
		.context()
		.addCookies([{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL }]);
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openReadlist(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-readlist");
}

async function readlistSettled(page: Page, cards: number): Promise<void> {
	await expect(page.locator(CARD)).toHaveCount(cards);
	await expect(page.locator(UNREAD_FILTER_TAB)).toHaveText(`To Read (${cards})`);
	await waitForImagePixels(page, AVATAR);
}

async function holdSave(page: Page): Promise<() => void> {
	let release: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	assert.ok(release, "a promise executor runs synchronously, so its resolver must be captured");
	await page.route("**/queue/save*", async (route) => {
		await held;
		await route.continue();
	});
	return release;
}

async function submitSave(page: Page, url: string): Promise<void> {
	await page.locator(SAVE_INPUT).fill(url);
	await page.locator(SAVE_BUTTON).click();
	await page.mouse.move(DESKTOP.width - 5, 5);
	await page.evaluate(pinSaveBarValue, { selector: SAVE_INPUT, value: PINNED_SAVE_URL });
}

async function heldSaveSettled(page: Page): Promise<void> {
	await expect(page.locator(SAVE_FORM_IN_FLIGHT)).toHaveCount(1);
	await expect(page.locator(SKELETON)).toBeVisible();
	await expect(page.locator(SAVE_BUTTON)).toBeDisabled();
	await expect(page.locator(SAVING_LABEL)).toBeVisible();
	await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length);
	await expect(page.locator(PENDING_CARD)).toHaveCount(0);
	await waitForImagePixels(page, AVATAR);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: PINNED_SAVED_TIMES,
	});
}

async function heldSkeletonGeometry(page: Page): Promise<void> {
	const overflows = await page.evaluate(pageOverflowsSideways);
	assert.equal(overflows, false, "the readlist page must never scroll sideways");
	const viewport = page.viewportSize();
	assert.ok(viewport, "a whole-page capture needs a fixed viewport to size its clip");
	const [sort, skeleton, list, header] = await page.evaluate(measureBoxes, [
		SORT_ROW,
		SKELETON,
		LIST,
		SKELETON_HEADER,
	]);
	assert.equal(skeleton.y, sort.y + sort.height, "the skeleton must sit directly under the sort row");
	assert.equal(list.y, skeleton.y + skeleton.height, "the cards must start where the skeleton ends");
	assert.equal(skeleton.x, list.x, "the skeleton must share the cards' left edge");
	assert.equal(skeleton.width, list.width, "the skeleton must be as wide as the cards it stands in for");
	assert.ok(
		header.height >= MINIMUM_TOUCH_TARGET,
		`the skeleton's header must hold the ${MINIMUM_TOUCH_TARGET}px action row a card carries`,
	);
	assert.ok(
		list.y + list.height <= viewport.height,
		`the whole-page clip runs to ${Math.ceil(list.y + list.height)}px, past the ${viewport.height}px viewport a clip can reach`,
	);
}

function checkpoint(name: string): VisualCheckpoint {
	return {
		name,
		settled: heldSaveSettled,
		geometry: heldSkeletonGeometry,
		target: LIST,
		capture: "page-from-top",
		pinnedText: [],
	};
}

const SKELETON_DESKTOP_LIGHT = checkpoint("readlist-save-skeleton-desktop-light");
const SKELETON_DESKTOP_DARK = checkpoint("readlist-save-skeleton-desktop-dark");
const SKELETON_MOBILE_LIGHT = checkpoint("readlist-save-skeleton-mobile-light");

const SEEDED = SEEDED_ARTICLES.map((article) => ({ ...article, summarised: true }));

test.describe("Saving on the All queue", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP_TALL });

	test("stands a skeleton where the card will land, then lands the card there (light)", async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await createVerifiedUser(page, `save-skeleton-desktop-light-${run}@example.com`);
		await seedArticles(page, { userId, articles: SEEDED });
		await loginAs(page, `save-skeleton-desktop-light-${run}@example.com`);
		await openReadlist(page);
		await readlistSettled(page, SEEDED_ARTICLES.length);

		const release = await holdSave(page);
		await submitSave(page, `${BASE_URL}/privacy?readlist-save-skeleton=${run}`);
		await captureCheckpoint(page, SKELETON_DESKTOP_LIGHT);
		release();

		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length + 1, { timeout: SETTLE_MS });
		await expect(page.locator(FIRST_CARD)).toHaveId("latest-saved");
		await expect(page.locator(SKELETON)).toBeHidden();
	});

	test("stands a skeleton where the card will land, then lands the card there (dark)", async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		await page.emulateMedia({ colorScheme: "dark" });
		const userId = await createVerifiedUser(page, `save-skeleton-desktop-dark-${run}@example.com`);
		await seedArticles(page, { userId, articles: SEEDED });
		await loginAs(page, `save-skeleton-desktop-dark-${run}@example.com`);
		await openReadlist(page);
		await readlistSettled(page, SEEDED_ARTICLES.length);

		const release = await holdSave(page);
		await submitSave(page, `${BASE_URL}/privacy?readlist-save-skeleton=${run}`);
		await captureCheckpoint(page, SKELETON_DESKTOP_DARK);
		release();

		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length + 1, { timeout: SETTLE_MS });
		await expect(page.locator(SKELETON)).toBeHidden();
	});
});

test.describe("Saving on the All queue (mobile)", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE_TALL });

	test("stands a skeleton where the card will land, then lands the card there", async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await createVerifiedUser(page, `save-skeleton-mobile-${run}@example.com`);
		await seedArticles(page, { userId, articles: SEEDED });
		await loginAs(page, `save-skeleton-mobile-${run}@example.com`);
		await openReadlist(page);
		await readlistSettled(page, SEEDED_ARTICLES.length);

		const release = await holdSave(page);
		await submitSave(page, `${BASE_URL}/privacy?readlist-save-skeleton=${run}`);
		await captureCheckpoint(page, SKELETON_MOBILE_LIGHT);
		release();

		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length + 1, { timeout: SETTLE_MS });
		await expect(page.locator(SKELETON)).toBeHidden();
	});
});

test.describe("The skeleton comes before the answer", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	test("lands the saved card exactly where the skeleton stood", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await createVerifiedUser(page, `save-skeleton-lands-${run}@example.com`);
		await seedArticles(page, { userId, articles: SEEDED });
		await loginAs(page, `save-skeleton-lands-${run}@example.com`);
		await openReadlist(page);
		await readlistSettled(page, SEEDED_ARTICLES.length);

		const release = await holdSave(page);
		await submitSave(page, `${BASE_URL}/privacy?readlist-save-skeleton=${run}`);
		await expect(page.locator(SKELETON)).toBeVisible();
		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length);
		const [skeletonBox] = await page.evaluate(measureDocumentBoxes, [SKELETON]);
		release();

		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length + 1, { timeout: SETTLE_MS });
		await expect(page.locator(FIRST_CARD)).toHaveId("latest-saved");
		await expect(page.locator(SKELETON)).toBeHidden();
		const [landedBox] = await page.evaluate(measureDocumentBoxes, ["#latest-saved"]);
		assert.ok(
			Math.abs(landedBox.top - skeletonBox.top) <= LAYOUT_TOLERANCE_PX,
			`the saved card must land where the skeleton stood, measured ${skeletonBox.top}px then ${landedBox.top}px`,
		);
	});

	test("hides the empty state while the first save is in flight", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		await createVerifiedUser(page, `save-skeleton-empty-${run}@example.com`);
		await loginAs(page, `save-skeleton-empty-${run}@example.com`);
		await openReadlist(page);
		await expect(page.locator(EMPTY)).toBeVisible();

		const release = await holdSave(page);
		await submitSave(page, `${BASE_URL}/privacy?readlist-save-skeleton=${run}`);
		await expect(page.locator(SKELETON)).toBeVisible();
		await expect(page.locator(EMPTY)).toBeHidden();
		await expect(page.locator(LIST)).toHaveCount(0);
		release();

		await expect(page.locator(CARD)).toHaveCount(1, { timeout: SETTLE_MS });
		await expect(page.locator(EMPTY)).toHaveCount(0);
		await expect(page.locator(SKELETON)).toBeHidden();
	});

	test("shows the skeleton first and the error pill after a rejected URL", async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await createVerifiedUser(page, `save-skeleton-reject-${run}@example.com`);
		await seedArticles(page, { userId, articles: SEEDED });
		await loginAs(page, `save-skeleton-reject-${run}@example.com`);
		await openReadlist(page);
		await readlistSettled(page, SEEDED_ARTICLES.length);

		const release = await holdSave(page);
		await submitSave(page, "https://server");
		await expect(page.locator(SKELETON)).toBeVisible();
		release();

		await expect(page.locator(`${SAVE_ERROR}[data-test-saveable-url-code="malformed_url"]`)).toBeVisible({
			timeout: SETTLE_MS,
		});
		await expect(page.locator(SAVE_ERROR)).toHaveText("Please enter a valid URL");
		await expect(page.locator(SKELETON)).toBeHidden();
		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length);
	});

	test("stands at the height of the pending stub card it precedes", async ({ page }, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await createVerifiedUser(page, `save-skeleton-height-${run}@example.com`);
		await seedArticles(page, {
			userId,
			articles: [
				...SEEDED,
				{ ...STUB_ARTICLE, summarised: false },
			],
		});
		await loginAs(page, `save-skeleton-height-${run}@example.com`);
		await openReadlist(page);
		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length + 1);
		await expect(page.locator(PENDING_CARD)).toHaveCount(1);
		await expect(page.locator(`${FIRST_CARD} [data-test-processing]`)).toBeVisible();

		const release = await holdSave(page);
		await submitSave(page, `${BASE_URL}/privacy?readlist-save-skeleton=${run}`);
		await expect(page.locator(SKELETON)).toBeVisible();
		const [skeleton, firstCard] = await page.evaluate(measureBoxes, [SKELETON, FIRST_CARD]);
		assert.ok(
			Math.abs(skeleton.height - firstCard.height) <= LAYOUT_TOLERANCE_PX,
			`the skeleton must stand at the stub card's height, measured ${skeleton.height}px vs ${firstCard.height}px`,
		);
		assert.equal(skeleton.x, firstCard.x, "the skeleton must share the card's left edge");
		assert.equal(skeleton.width, firstCard.width, "the skeleton must be the card's width");
		release();

		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length + 2, { timeout: SETTLE_MS });
	});

	test("only turns Save into Saving… on a listing the save does not land on", async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await createVerifiedUser(page, `save-skeleton-done-${run}@example.com`);
		await seedArticles(page, { userId, articles: SEEDED });
		await loginAs(page, `save-skeleton-done-${run}@example.com`);
		await page.goto(`${BASE_URL}/queue?tab=done`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("body.page-readlist");

		const release = await holdSave(page);
		await submitSave(page, `${BASE_URL}/privacy?readlist-save-skeleton=${run}`);
		await expect(page.locator(SAVING_LABEL)).toBeVisible();
		await expect(page.locator(SKELETON)).toHaveClass(/readlist-save-skeleton--inert/);
		await expect(page.locator(SKELETON)).toBeHidden();
		release();

		await expect(page.locator(CARD)).toHaveCount(SEEDED_ARTICLES.length + 1, { timeout: SETTLE_MS });
	});
});
