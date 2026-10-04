import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { measureBoxes } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";

const SHORT_META_CARD = {
	url: "https://go.dev/blog/short",
	title: "Short meta",
};
const LONG_SITE_CARD = {
	url: "https://engineering.a-very-long-publication-name.example.com/deep/post",
	title: "Long site name",
};

const WIDTHS = [320, 390, 900, 1024, 1280];
const TOLERANCE = 1.5;

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
		savedAt: string;
		userId: string;
		summarised: boolean;
	},
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: params.url,
			title: params.title,
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

type Placement = "beside-the-facts" | "own-leading-row";

async function measurePlacement(
	page: Page,
	input: { id: string; lead: string; width: number; name: string },
): Promise<Placement> {
	const [foot, lead, button] = await page.evaluate(measureBoxes, [
		`[data-test-article="${input.id}"] .readlist-article__foot`,
		`[data-test-article="${input.id}"] ${input.lead}`,
		`[data-test-article="${input.id}"] [data-test-action="mark-read"]`,
	]);
	assert.ok(
		Math.abs(lead.x - foot.x) <= TOLERANCE,
		`at ${input.width}px the ${input.name} card's foot leads from the card's content edge — lead left ${lead.x}px vs foot left ${foot.x}px`,
	);
	const leadBottom = lead.y + lead.height;
	if (button.y >= leadBottom - TOLERANCE) {
		assert.ok(
			Math.abs(button.x - lead.x) <= TOLERANCE,
			`at ${input.width}px the ${input.name} card's wrapped button lines up with the leading edge — button left ${button.x}px vs lead left ${lead.x}px`,
		);
		return "own-leading-row";
	}
	const buttonCentre = button.y + button.height / 2;
	assert.ok(
		buttonCentre >= lead.y - TOLERANCE && buttonCentre <= leadBottom + TOLERANCE,
		`at ${input.width}px the ${input.name} card's button is centred on its lead row — centre ${buttonCentre}px vs row ${lead.y}–${leadBottom}px`,
	);
	const contentEdge = foot.x + foot.width;
	assert.ok(
		Math.abs(button.x + button.width - contentEdge) <= TOLERANCE,
		`at ${input.width}px the ${input.name} card's button ends at the row's content edge — button right ${button.x + button.width}px vs ${contentEdge}px`,
	);
	return "beside-the-facts";
}

test.describe("Readlist card status button placement", () => {
	test.use({ timezoneId: "UTC" });

	test("seats the status button beside the facts where the card fits it, and on its own leading-edge row where it doesn't", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `readlist-status-button-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		await seedCard(page, {
			...SHORT_META_CARD,
			url: `${SHORT_META_CARD.url}?${stamp}`,
			savedAt: "2026-07-11T09:14:00.000Z",
			userId,
			summarised: true,
		});
		await seedCard(page, {
			...LONG_SITE_CARD,
			url: `${LONG_SITE_CARD.url}?${stamp}`,
			savedAt: "2026-07-12T09:14:00.000Z",
			userId,
			summarised: true,
		});
		await loginAs(page, email);
		await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
		await expect(page.locator('[data-test-action="mark-read"]')).toHaveCount(2);

		const shortMetaId = await cardId(page, SHORT_META_CARD.title);
		const longSiteId = await cardId(page, LONG_SITE_CARD.title);

		const placements: Placement[] = [];
		for (const width of WIDTHS) {
			await page.setViewportSize({ width, height: 900 });
			const shortMeta = await measurePlacement(page, {
				id: shortMetaId,
				lead: ".readlist-article__meta",
				width,
				name: "short-meta",
			});
			const longSite = await measurePlacement(page, {
				id: longSiteId,
				lead: ".readlist-article__meta",
				width,
				name: "long-site",
			});
			assert.equal(
				longSite,
				shortMeta,
				`at ${width}px both cards take one placement — short-meta ${shortMeta} vs long-site ${longSite}`,
			);
			placements.push(shortMeta);
		}
		assert.deepEqual(
			placements,
			["own-leading-row", "own-leading-row", "beside-the-facts", "own-leading-row", "beside-the-facts"],
			`the button wraps only where the card is too narrow for the facts beside it, across ${WIDTHS.join(", ")}px`,
		);
	});

	test("leads a processing card's foot with its Processing line and wraps its disabled toggle like a terminal row", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `readlist-processing-foot-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		await seedCard(page, {
			...SHORT_META_CARD,
			url: `${SHORT_META_CARD.url}?${stamp}`,
			savedAt: "2026-07-11T09:14:00.000Z",
			userId,
			summarised: true,
		});
		await seedCard(page, {
			...LONG_SITE_CARD,
			url: `${LONG_SITE_CARD.url}?${stamp}`,
			savedAt: "2026-07-12T09:14:00.000Z",
			userId,
			summarised: false,
		});
		await loginAs(page, email);
		await expect(page.locator('[data-card-status="pending"]')).toHaveCount(1);
		await expect(page.locator('[data-test-action="mark-read"]')).toHaveCount(2);

		const terminalId = await cardId(page, SHORT_META_CARD.title);
		const pendingId = await cardId(page, LONG_SITE_CARD.title);
		await expect(
			page.locator(`[data-test-article="${pendingId}"] [data-test-action="mark-read"]`),
		).toBeDisabled();

		for (const width of WIDTHS) {
			await page.setViewportSize({ width, height: 900 });
			const terminal = await measurePlacement(page, {
				id: terminalId,
				lead: ".readlist-article__meta",
				width,
				name: "terminal",
			});
			const pending = await measurePlacement(page, {
				id: pendingId,
				lead: "[data-test-processing]",
				width,
				name: "processing",
			});
			assert.equal(
				pending,
				terminal,
				`at ${width}px the processing card's toggle takes the terminal card's placement — ${pending} vs ${terminal}`,
			);
		}
	});
});
