import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { measureBoxes, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SITE = "[data-test-article-url]";
const SITE_NAME = ".readlist-article__site-name";

const LONG_NAME = "Andi Roberts - Executive Coach | Leadership Trainer | Facilitator";
const SHORT_HOST = "news.ycombinator.com";

const LONG_CARD = {
	url: "https://andiroberts.example.com/how-to-give-feedback",
	title: "A card with a long declared publisher name",
	siteName: LONG_NAME,
};
const SHORT_CARD = {
	url: `https://${SHORT_HOST}/item`,
	title: "A card with a short site name",
};

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await response.json()).userId;
}

async function seedCard(
	page: Page,
	params: { url: string; title: string; siteName?: string; savedAt: string; userId: string },
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: params.url,
			title: params.title,
			...(params.siteName ? { siteName: params.siteName } : {}),
			content: "<p>Seeded body for the readlist-card site-name measurement.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedAt: params.savedAt,
			savedByUserId: params.userId,
			wordCount: 400,
			excerpt: "Seeded excerpt.",
			generatedSummary: { summary: "Seeded summary body.", excerpt: "" },
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function cardId(page: Page, title: string): Promise<string> {
	const id = await page
		.locator("article.readlist-article", {
			has: page.locator("[data-test-article-title]", { hasText: title }),
		})
		.getAttribute("data-test-article");
	assert.ok(id, `a card titled "${title}" must be rendered`);
	return id;
}

async function measureName(
	page: Page,
	id: string,
): Promise<{ display: string; needed: number; painted: number; height: number }> {
	return page.locator(`[data-test-article="${id}"] ${SITE_NAME}`).evaluate((el) => ({
		display: getComputedStyle(el).display,
		needed: el.scrollWidth,
		painted: el.clientWidth,
		height: el.getBoundingClientRect().height,
	}));
}

test.describe("Readlist card site name", () => {
	test.use({ timezoneId: "UTC" });

	test("keeps the meta row on one line, letting a long name give way to an ellipsis", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `readlist-site-name-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		await seedCard(page, {
			...LONG_CARD,
			url: `${LONG_CARD.url}?${stamp}`,
			savedAt: "2026-07-11T09:14:00.000Z",
			userId,
		});
		await seedCard(page, {
			...SHORT_CARD,
			url: `${SHORT_CARD.url}?${stamp}`,
			savedAt: "2026-07-12T09:14:00.000Z",
			userId,
		});
		await loginAs(page, email);
		await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);

		const longId = await cardId(page, LONG_CARD.title);
		const shortId = await cardId(page, SHORT_CARD.title);

		// The full name is always in the DOM and on the link title, whatever is painted.
		await expect(page.locator(`[data-test-article="${longId}"] ${SITE_NAME}`)).toHaveText(LONG_NAME);
		expect(
			await page.locator(`[data-test-article="${longId}"] ${SITE}`).getAttribute("title"),
		).toBe(LONG_NAME);

		const NAME_FLOOR = 60;
		const ONE_LINE_MAX = 24;
		for (const width of [320, 390, 900]) {
			await page.setViewportSize({ width, height: 844 });
			const name = await measureName(page, longId);
			assert.ok(
				!(await page.evaluate(pageOverflowsSideways)),
				`a ${width}px card never scrolls sideways under a long site name`,
			);
			assert.ok(
				name.height <= ONE_LINE_MAX,
				`the long name stays on one line at ${width}px — measured ${name.height}px (${name.display})`,
			);
			assert.ok(
				name.painted >= NAME_FLOOR,
				`the long name keeps naming the source at ${width}px — painted ${name.painted}px, well past the sliver the old ellipsis left`,
			);
		}

		await page.setViewportSize({ width: 320, height: 844 });
		const squeezed = await measureName(page, longId);
		assert.ok(
			squeezed.needed > squeezed.painted,
			`a 320px row truncates the long name rather than wrap it — needs ${squeezed.needed}px, paints ${squeezed.painted}px`,
		);

		await page.setViewportSize({ width: 900, height: 844 });
		const [site, saved, readTime] = await page.evaluate(measureBoxes, [
			`[data-test-article="${longId}"] .readlist-article__site`,
			`[data-test-article="${longId}"] .readlist-article__saved`,
			`[data-test-article="${longId}"] .readlist-article__read-time`,
		]);
		const ROW_TOLERANCE = 1.5;
		assert.ok(
			Math.abs(site.y - saved.y) <= ROW_TOLERANCE && Math.abs(saved.y - readTime.y) <= ROW_TOLERANCE,
			`site, saved and read time share one row where the card is wide — y ${site.y}/${saved.y}/${readTime.y}`,
		);

		const shortName = await measureName(page, shortId);
		assert.equal(
			shortName.painted,
			shortName.needed,
			`a short name seats whole where the row has the width — painted ${shortName.painted}px of ${shortName.needed}px`,
		);
	});
});
