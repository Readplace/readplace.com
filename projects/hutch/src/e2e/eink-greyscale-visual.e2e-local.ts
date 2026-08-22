import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	expect,
	snapToWholePixels,
	test,
	waitForBrandFonts,
	waitForImagePixels,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { neutraliseVolatileChrome } from "./queue-nav.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";

const EINK_VIEWPORT = { width: 758, height: 1024 };

const CONTRAST_SENSITIVE = {
	stylePath: join(__dirname, "eink-greyscale.css"),
	threshold: 0.02,
	maxDiffPixelRatio: 0.0005,
} as const;

const READER_ROOT = "main.reader";
const QUEUE_LIST = "[data-test-article-list]";
const THUMBNAIL_URL = "https://cdn.example.com/eink-greyscale-thumbnail.svg";
const FETCHED_AT = "2026-04-27T08:00:00.000Z";

const VOLATILE_CHROME = [
	".trial-countdown",
	".offline-banner",
	"[data-test-extension-suggestion-banner]",
	"[data-test-changelog-banner]",
	".crawl-bookmark",
	".reader__float-stack",
	".article-body__progress",
];
const PINNED_SAVED_TIMES = ["2 days ago", "3 days ago"];

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

const READER_BODY = [
	"<p>An e-ink panel renders sixteen shades of grey and cannot animate, so anything that carries meaning through hue alone disappears the moment the page reaches the screen.</p>",
	'<p>The reference is the <a href="https://www.w3.org/TR/WCAG22/#contrast-minimum">WCAG 2.2 contrast minimum</a>, which asks for 4.5:1 on body text, and <a href="https://www.w3.org/TR/WCAG22/#use-of-color">use of colour</a> for the case where hue is the only cue.</p>',
	"<p>Every page here renders on the server and every interaction is a plain form, so what is left for the panel is legibility.</p>",
].join("");

const QUEUE_ARTICLES = [
	{
		slug: "eink-greyscale-second",
		title: "The second article in the queue",
		savedAt: "2026-07-11T09:14:00.000Z",
		excerpt: "A fixed excerpt, long enough to occupy the two lines a real card excerpt occupies.",
	},
	{
		slug: "eink-greyscale-third",
		title: "Sixteen greys and the death of the colour cue",
		savedAt: "2026-07-10T09:14:00.000Z",
		excerpt: "A second fixed excerpt so the listing shows more than a single card.",
	},
];

async function pinThumbnail(page: Page): Promise<void> {
	await page.route(THUMBNAIL_URL, (route) =>
		route.fulfill({
			contentType: "image/svg+xml",
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#B9712A"/><rect x="24" y="150" width="272" height="16" fill="#F6EFE7"/></svg>',
		}),
	);
}

async function seedReaderAndQueue(page: Page, stamp: string): Promise<{ email: string; readerUrl: string }> {
	const email = `eink-greyscale-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
	const { userId } = CreatedUser.parse(await created.json());

	for (const article of QUEUE_ARTICLES) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/${article.slug}`,
				title: article.title,
				content: "<p>Seeded body for the greyscale queue baseline.</p>",
				contentFetchedAt: FETCHED_AT,
				savedAt: article.savedAt,
				savedByUserId: userId,
				excerpt: article.excerpt,
				imageUrl: THUMBNAIL_URL,
				generatedSummary: { summary: "Seeded summary.", excerpt: article.excerpt },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the queue article");
	}

	const reader = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: "https://example.com/eink-greyscale-reader",
			title: "Reading Readplace on an e-ink screen",
			content: READER_BODY,
			contentFetchedAt: FETCHED_AT,
			savedAt: "2026-07-12T09:14:00.000Z",
			savedByUserId: userId,
			excerpt: "Sixteen greys, no animation, and a browser that may not run JavaScript.",
			generatedSummary: {
				summary: "A fixed summary so the panel is baselined in one state.",
				excerpt: "A fixed summary so the panel is baselined in one state.",
			},
		},
	});
	assert.equal(reader.status(), 201, "the seed endpoint must create the reader article");
	const { articleId } = SeededArticle.parse(await reader.json());

	return { email, readerUrl: `${BASE_URL}/queue/${articleId}/view` };
}

/** Omitting generatedSummary leaves the row's summary pending, which is the one
 * state that renders the animated ellipsis. */
async function seedPendingSummary(
	page: Page,
	stamp: string,
): Promise<{ email: string; readerUrl: string }> {
	const email = `eink-greyscale-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
	const { userId } = CreatedUser.parse(await created.json());

	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/eink-greyscale-${stamp}`,
			title: "A summary that has not landed yet",
			content: READER_BODY,
			contentFetchedAt: FETCHED_AT,
			savedAt: "2026-07-12T09:14:00.000Z",
			savedByUserId: userId,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the reader article");
	const { articleId } = SeededArticle.parse(await seeded.json());

	return { email, readerUrl: `${BASE_URL}/queue/${articleId}/view` };
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-queue");
}

async function settle(page: Page, target: string): Promise<void> {
	await waitForBrandFonts(page, ["Inter"]);
	await page.evaluate(neutraliseVolatileChrome, {
		volatile: VOLATILE_CHROME,
		times: PINNED_SAVED_TIMES,
	});
	await page.mouse.move(0, 0);
	let previous = "";
	await expect
		.poll(async () => {
			const box = await page.locator(target).boundingBox();
			const current = JSON.stringify(box);
			const stable = current === previous;
			previous = current;
			return stable;
		})
		.toBe(true);
	await snapToWholePixels(page, target);
}

test.describe("Readplace holds its ink when the screen has only greys", () => {
	test.use({ timezoneId: "UTC", viewport: EINK_VIEWPORT });

	for (const theme of ["light", "dark"] as const) {
		test(`the reader keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await pinThumbnail(page);
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, readerUrl } = await seedReaderAndQueue(
				page,
				`reader-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await page.goto(readerUrl, { waitUntil: "domcontentloaded" });
			await page.waitForSelector('[data-test-reader-slot][data-reader-status="ready"]');
			await settle(page, READER_ROOT);

			await expect(page.locator(READER_ROOT)).toHaveScreenshot(
				`eink-reader-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});

		test(`the queue keeps its contrast in greyscale (${theme})`, async ({ page }, testInfo) => {
			await pinThumbnail(page);
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await seedReaderAndQueue(
				page,
				`queue-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await expect(page.locator("[data-test-article]")).toHaveCount(QUEUE_ARTICLES.length + 1);
			await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
			await waitForImagePixels(page, ".queue-article__thumbnail");
			await settle(page, QUEUE_LIST);

			await expect(page.locator(QUEUE_LIST)).toHaveScreenshot(
				`eink-queue-${theme}.png`,
				CONTRAST_SENSITIVE,
			);
		});
	}

	test("a summary still says it is working when the panel refuses motion", async ({
		page,
	}, testInfo) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		const { email, readerUrl } = await seedPendingSummary(
			page,
			`dots-${testInfo.workerIndex}-${Date.now()}`,
		);
		await loginAs(page, email);
		await page.goto(readerUrl, { waitUntil: "domcontentloaded" });

		const dots = page.locator(".article-body__summary-loading");
		await expect(dots).toBeVisible();
		const painted = await dots.evaluate((el) => {
			const after = getComputedStyle(el, "::after");
			return { animationName: after.animationName, content: after.content };
		});

		assert.equal(painted.animationName, "none", "a panel that refuses motion must not animate");
		assert.equal(painted.content, '"..."', "the dots the animation drew must still be painted");
	});
});
