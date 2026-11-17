import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { expect, test } from "@packages/e2e-harness";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	SAVE_TIP_COOKIE_NAME,
	SAVE_TIP_SEEN,
} from "../runtime/web/shared/save-tip/save-tip-cookie";
import { openAddLink } from "./page-interactions";
import {
	recordFirstSettledBannerClass,
	stampNode,
} from "./reader-poll-stability.browser";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const OWNER_PASSWORD = "correct-horse-battery-staple";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const SEEDED_PARAGRAPH =
	"<p>Reader view renders the article text in a clean, distraction-free column so the reading experience stays consistent across every site you save.</p>";
const UNFETCHABLE_FIXTURE = `${BASE_URL}/e2e/fixtures/unfetchable/`;

const READER_CONTENT =
	'[data-test-reader-slot][data-reader-status="ready"] [data-test-reader-content]';
const STAMPED_CONTENT = `${READER_CONTENT}[data-test-poll-stamp]`;
const SUMMARY = "[data-test-reader-summary]";
const SUMMARY_PENDING = `${SUMMARY}[data-summary-status="pending"]`;
const SUMMARY_READY = `${SUMMARY}[data-summary-status="ready"]`;
const TRANSCRIPT_FAILED_NOTICE =
	'[data-test-reader-notice][data-reader-status="transcript-failed"]';
const PENDING_SLOT = '[data-test-reader-slot][data-reader-status="pending"]';
const BANNER = ".extension-suggestion-banner";
const BANNER_OFFERED = `${BANNER}[data-show-extension-suggestion="true"]`;
const BANNER_SETTLED_ATTRIBUTE = "data-test-offered-banner-settled-class";
const BANNER_SETTLED = `body[${BANNER_SETTLED_ATTRIBUTE}]`;
const SAVED_CARD = "[data-test-article]";
const SAVED_CARD_TITLE = "[data-test-article-title]";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD, verified: true },
	});
	assert.equal(
		response.status(),
		201,
		"the e2e user fixture must answer the create request",
	);
	return CreatedUser.parse(await response.json()).userId;
}

async function seedArticle(
	page: Page,
	input: {
		url: string;
		savedByUserId: string;
		media?: {
			kind: "audio" | "video" | "book";
			fileName: string;
			transcript?: "no-speech" | "transcript-failed";
		};
	},
): Promise<string> {
	const response = await page.request.post(
		`${BASE_URL}/e2e/seed-crawled-article`,
		{
			data: {
				title: "Why Your Postgres Query Suddenly Got Slow",
				content: Array.from({ length: 6 }, () => SEEDED_PARAGRAPH).join("\n"),
				contentFetchedAt: CONTENT_FETCHED_AT,
				summaryState: { status: "pending" },
				...input,
			},
		},
	);
	assert.equal(
		response.status(),
		201,
		`the seed endpoint must create ${input.url}`,
	);
	return SeededArticle.parse(await response.json()).articleId;
}

async function seedCrawlStatus(
	page: Page,
	input:
		| { url: string; status: "pending" }
		| { url: string; status: "failed"; reason: string },
): Promise<void> {
	const response = await page.request.post(
		`${BASE_URL}/e2e/seed-crawl-status`,
		{ data: input },
	);
	assert.equal(
		response.status(),
		201,
		`the crawl-status seed must move the crawl to ${input.status}`,
	);
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function openReader(page: Page, articleId: string): Promise<void> {
	await page.goto(`${BASE_URL}/queue/${articleId}/view`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector("body.page-reader");
}

function countSummaryPolls(page: Page, articleId: string): () => number {
	const answeredPaths: string[] = [];
	page.on("response", (response) => {
		answeredPaths.push(new URL(response.url()).pathname);
	});
	return () =>
		answeredPaths.filter((path) => path === `/queue/${articleId}/summary`)
			.length;
}

test.describe("A reader's settled content survives the polls that settle the rest of the page", () => {
	test("the article body node stays in place while the summary poll settles", async ({
		page,
	}) => {
		const stamp = `${Date.now()}-settled`;
		const email = `reader-poll-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		const articleId = await seedArticle(page, {
			url: `https://example.com/reader-poll-${stamp}`,
			savedByUserId: userId,
		});
		await loginAs(page, email);
		await openReader(page, articleId);

		await page.waitForSelector(READER_CONTENT);
		await expect(page.locator(SUMMARY)).toHaveAttribute(
			"data-summary-status",
			"pending",
		);
		await page.locator(READER_CONTENT).evaluate(stampNode, {
			name: "data-test-poll-stamp",
			value: "before-polls",
		});
		const answeredPolls = countSummaryPolls(page, articleId);

		await page.waitForSelector(SUMMARY_READY, { timeout: 30_000 });
		assert.ok(
			answeredPolls() >= 1,
			"the summary must have settled through at least one answered poll",
		);
		await expect(page.locator(STAMPED_CONTENT)).toHaveAttribute(
			"data-test-poll-stamp",
			"before-polls",
		);
	});

	test("an uploaded audio file keeps its transcript notice after the summary settles", async ({
		page,
	}) => {
		const stamp = `${Date.now()}-audio`;
		const email = `reader-poll-${stamp}@example.com`;
		const userId = await createOwner(page, email);
		const articleId = await seedArticle(page, {
			url: `https://uploads.readplace.invalid/${randomBytes(16).toString("hex")}`,
			savedByUserId: userId,
			media: {
				kind: "audio",
				fileName: `reader-poll-${stamp}.mp3`,
				transcript: "transcript-failed",
			},
		});
		await loginAs(page, email);
		await openReader(page, articleId);

		await page.waitForSelector(TRANSCRIPT_FAILED_NOTICE);
		await page.waitForSelector(SUMMARY_PENDING);
		await page.waitForSelector(SUMMARY_READY, { timeout: 30_000 });
		await expect(page.locator("[data-test-reader-notice]")).toHaveAttribute(
			"data-reader-status",
			"transcript-failed",
		);
	});

	test("the extension suggestion banner shows once a refresh of the reader fails", async ({
		page,
	}) => {
		const stamp = `${Date.now()}-banner`;
		const email = `reader-poll-${stamp}@example.com`;
		const url = `${UNFETCHABLE_FIXTURE}${stamp}`;
		await createOwner(page, email);
		await page
			.context()
			.addCookies([
				{ name: SAVE_TIP_COOKIE_NAME, value: SAVE_TIP_SEEN, url: BASE_URL },
			]);
		await loginAs(page, email);

		const saveForm = await openAddLink(page);
		await saveForm.locator('input[name="url"]').fill(url);
		await page.locator('#add-link [data-test-action="add-link-save"]').click();
		await expect(page.locator(SAVED_CARD)).toHaveCount(1);
		const href = await page.locator(SAVED_CARD_TITLE).getAttribute("href");
		assert.ok(href, "the saved card must link into the reader");

		await seedCrawlStatus(page, { url, status: "pending" });
		await page.goto(new URL(href, BASE_URL).href, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForSelector("body.page-reader");
		await page.waitForSelector(PENDING_SLOT);
		await page.evaluate(recordFirstSettledBannerClass, {
			firstOfferedBanner: `body:not([${BANNER_SETTLED_ATTRIBUTE}]) ${BANNER_OFFERED}`,
			settledAttribute: BANNER_SETTLED_ATTRIBUTE,
		});
		await seedCrawlStatus(page, {
			url,
			status: "failed",
			reason: JSON.stringify({ kind: "fetch-failed" }),
		});

		await page.waitForSelector(BANNER_SETTLED, {
			state: "attached",
			timeout: 30_000,
		});
		await expect(page.locator(BANNER_SETTLED)).toHaveAttribute(
			BANNER_SETTLED_ATTRIBUTE,
			/(^| )extension-suggestion-banner--visible( |$)/,
		);
	});
});
