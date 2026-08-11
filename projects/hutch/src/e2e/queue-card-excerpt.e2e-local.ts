import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;

const OWNER_PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const PARSED_CARD = '[data-test-article]:has([data-test-article-title]:text-is("Parsed excerpt"))';
const GENERATED_CARD =
	'[data-test-article]:has([data-test-article-title]:text-is("Generated excerpt"))';
const EXCERPT = "[data-test-article-excerpt]";

/* A real Readability first-paragraph excerpt: prose that was never written to be
 * a teaser, which is why it ends mid-word. Long enough to run past two lines at
 * every viewport this spec uses. */
const PARSED_EXCERPT =
	'I have been a director of engineering for a bit over three years now, and I still hear and read what I call the "old rules" repeated over and over: a director should not spend time coding, good work takes time, protect the team from the business, get consensus before you commit, etc. For a while I thought the people repeating these lines were behind. Then we introduced LLMs in my org and the cost of producing code dropped, and I started checking each rule against the assumption underneath it. T';

/* A model-written teaser. Also past two lines, so the clamp it keeps is doing
 * visible work rather than passing because the text happens to be short. */
const GENERATED_EXCERPT =
	"Attention is the scarce resource, and the queue is where it gets spent: every card you skim is a decision about what you will never read, which is why the teaser has to carry the whole thought instead of trailing off into an ellipsis that costs a click.";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	return CreatedUser.parse(await response.json()).userId;
}

/* Every card seeds a ready summary: with the crawl ready and the summary still
 * unresolved the card keeps its 3s htmx poll, and that swap replaces the excerpt
 * element underneath the measurement. An empty summary excerpt is what routes the
 * parsed card down the metadata.excerpt branch while staying terminal. */
async function seedCard(
	page: Page,
	params: { url: string; title: string; excerpt: string; summaryExcerpt: string; userId: string },
): Promise<void> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: params.url,
			title: params.title,
			content: "<p>Seeded body for the queue-card excerpt measurement.</p>",
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: params.userId,
			excerpt: params.excerpt,
			generatedSummary: { summary: "Seeded summary body.", excerpt: params.summaryExcerpt },
		},
	});
	assert.equal(response.status(), 201, "the seed endpoint must create the crawled article");
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-queue");
}

async function measureExcerpt(
	page: Page,
	card: string,
): Promise<{ lineHeight: number; contentHeight: number; paintedHeight: number }> {
	return page.locator(`${card} ${EXCERPT}`).evaluate((el) => ({
		lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
		contentHeight: el.scrollHeight,
		paintedHeight: el.clientHeight,
	}));
}

test.describe("Queue card excerpt", () => {
	test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });

	test("seats a crawler-parsed excerpt whole and keeps a generated one clamped", async ({
		page,
	}, testInfo) => {
		const stamp = `${testInfo.workerIndex}-${Date.now()}`;
		const email = `queue-excerpt-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		await seedCard(page, {
			url: `https://example.com/queue-parsed-excerpt-${stamp}`,
			title: "Parsed excerpt",
			excerpt: PARSED_EXCERPT,
			summaryExcerpt: "",
			userId,
		});
		await seedCard(page, {
			url: `https://example.com/queue-generated-excerpt-${stamp}`,
			title: "Generated excerpt",
			excerpt: "Unused — the generated excerpt wins this card.",
			summaryExcerpt: GENERATED_EXCERPT,
			userId,
		});
		await loginAs(page, email);

		await expect(page.locator('[data-card-status="pending"]')).toHaveCount(0);
		await expect(page.locator(`${PARSED_CARD} ${EXCERPT}`)).toHaveText(PARSED_EXCERPT);
		await expect(page.locator(`${GENERATED_CARD} ${EXCERPT}`)).toHaveText(GENERATED_EXCERPT);

		const parsed = await measureExcerpt(page, PARSED_CARD);
		const generated = await measureExcerpt(page, GENERATED_CARD);

		// Both must overflow two lines, or neither assertion below proves anything.
		assert.ok(
			parsed.contentHeight > parsed.lineHeight * 2,
			`the parsed excerpt must run past two lines, measured ${parsed.contentHeight}px against a ${parsed.lineHeight}px line`,
		);
		assert.ok(
			generated.contentHeight > generated.lineHeight * 2,
			`the generated excerpt must run past two lines, measured ${generated.contentHeight}px against a ${generated.lineHeight}px line`,
		);

		assert.equal(
			parsed.paintedHeight,
			parsed.contentHeight,
			"the card must grow to seat the whole parsed excerpt, not hide its tail behind a line clamp",
		);
		assert.ok(
			generated.paintedHeight < generated.contentHeight,
			`a generated excerpt is a teaser the model sized to a two-line budget, so the card keeps clamping it — painted ${generated.paintedHeight}px of ${generated.contentHeight}px`,
		);
	});
});
