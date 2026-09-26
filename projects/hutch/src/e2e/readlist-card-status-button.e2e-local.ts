import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { measureBoxes } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const THUMBNAIL_URL = "https://cdn.example.com/readlist-status-button-thumbnail.svg";

const SHORT_META_CARD = {
	url: "https://go.dev/blog/short",
	title: "Short meta and no thumbnail",
};
const THUMBNAIL_CARD = {
	url: "https://engineering.a-very-long-publication-name.example.com/deep/post",
	title: "Long site name and a thumbnail",
	imageUrl: THUMBNAIL_URL,
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
	params: {
		url: string;
		title: string;
		imageUrl?: string;
		savedAt: string;
		userId: string;
		summarised: boolean;
	},
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: params.url,
			title: params.title,
			...(params.imageUrl ? { imageUrl: params.imageUrl } : {}),
			content: "<p>Seeded body for the readlist-card status-button placement test.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedAt: params.savedAt,
			savedByUserId: params.userId,
			excerpt: "Seeded excerpt for the status-button placement test.",
			...(params.summarised ? { generatedSummary: { summary: "Seeded summary body.", excerpt: "" } } : {}),
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
}

async function pinThumbnail(page: Page): Promise<void> {
	await page.route(THUMBNAIL_URL, (route) =>
		route.fulfill({
			contentType: "image/svg+xml",
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#B9712A"/></svg>',
		}),
	);
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

async function measureCard(
	page: Page,
	id: string,
): Promise<{ factsBottom: number; factsLeft: number; buttonTop: number; buttonLeft: number }> {
	const [facts, button] = await page.evaluate(measureBoxes, [
		`[data-test-article="${id}"] .readlist-article__facts`,
		`[data-test-article="${id}"] [data-test-action="mark-read"]`,
	]);
	return {
		factsBottom: facts.y + facts.height,
		factsLeft: facts.x,
		buttonTop: button.y,
		buttonLeft: button.x,
	};
}

test.describe("Readlist card status button placement", () => {
	test.use({ timezoneId: "UTC" });

	test("seats the status button on its own row at the card's left edge, every width", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `readlist-status-button-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		await pinThumbnail(page);
		await seedCard(page, {
			...SHORT_META_CARD,
			url: `${SHORT_META_CARD.url}?${stamp}`,
			savedAt: "2026-07-11T09:14:00.000Z",
			userId,
			summarised: true,
		});
		await seedCard(page, {
			...THUMBNAIL_CARD,
			url: `${THUMBNAIL_CARD.url}?${stamp}`,
			savedAt: "2026-07-12T09:14:00.000Z",
			userId,
			summarised: true,
		});
		await loginAs(page, email);
		await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
		await expect(page.locator('[data-test-action="mark-read"]')).toHaveCount(2);

		const shortMetaId = await cardId(page, SHORT_META_CARD.title);
		const thumbnailId = await cardId(page, THUMBNAIL_CARD.title);

		const TOLERANCE = 1.5;
		for (const width of [320, 390, 900, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			const shortMeta = await measureCard(page, shortMetaId);
			const thumbnail = await measureCard(page, thumbnailId);

			for (const [name, card] of [
				["short-meta", shortMeta],
				["thumbnail", thumbnail],
			] as const) {
				assert.ok(
					card.buttonTop >= card.factsBottom - TOLERANCE,
					`at ${width}px the ${name} card's button starts below its facts row — button top ${card.buttonTop}px vs facts bottom ${card.factsBottom}px`,
				);
				assert.ok(
					Math.abs(card.buttonLeft - card.factsLeft) <= TOLERANCE,
					`at ${width}px the ${name} card's button lines up with the card's left edge — button left ${card.buttonLeft}px vs facts left ${card.factsLeft}px`,
				);
			}

			assert.ok(
				Math.abs(shortMeta.buttonLeft - thumbnail.buttonLeft) <= TOLERANCE,
				`at ${width}px both cards' buttons share one x position — short-meta ${shortMeta.buttonLeft}px vs thumbnail ${thumbnail.buttonLeft}px`,
			);
		}
	});

	test("keeps a processing card's unread dot right before its Processing line, every width", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `readlist-processing-dot-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		await pinThumbnail(page);
		await seedCard(page, {
			...SHORT_META_CARD,
			url: `${SHORT_META_CARD.url}?${stamp}`,
			savedAt: "2026-07-11T09:14:00.000Z",
			userId,
			summarised: false,
		});
		await seedCard(page, {
			...THUMBNAIL_CARD,
			url: `${THUMBNAIL_CARD.url}?${stamp}`,
			savedAt: "2026-07-12T09:14:00.000Z",
			userId,
			summarised: false,
		});
		await loginAs(page, email);
		await expect(page.locator('[data-card-status="pending"]')).toHaveCount(2);

		const shortMetaId = await cardId(page, SHORT_META_CARD.title);
		const thumbnailId = await cardId(page, THUMBNAIL_CARD.title);

		const TOLERANCE = 1.5;
		const FACTS_GAP_PX = 14;
		for (const width of [320, 390, 900, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			for (const [name, id] of [
				["short-meta", shortMetaId],
				["thumbnail", thumbnailId],
			] as const) {
				const [dot, processing] = await page.evaluate(measureBoxes, [
					`[data-test-article="${id}"] [data-test-read-status]`,
					`[data-test-article="${id}"] [data-test-processing]`,
				]);
				const gap = processing.x - (dot.x + dot.width);
				assert.ok(
					Math.abs(gap - FACTS_GAP_PX) <= TOLERANCE,
					`at ${width}px the ${name} card's unread dot sits one facts gap before its Processing line — gap ${gap}px`,
				);
				assert.ok(
					Math.abs(dot.y + dot.height / 2 - (processing.y + processing.height / 2)) <= TOLERANCE,
					`at ${width}px the ${name} card's unread dot shares its Processing line — dot top ${dot.y}px vs processing top ${processing.y}px`,
				);
			}
		}
	});
});
