import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const OWNER_PASSWORD = "password123";
const GATED_URL = "https://mail.google.com/mail/u/0/";
const GATED_PATH = "mail.google.com/mail/u/0/";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const CAPTURED_TITLE = "Inbox (42) - someone@example.com";
const CAPTURED_BODY = "<p>Re: your invoice is attached, please find the PDF below.</p>";
const NOTICE = '[data-test-reader-slot][data-reader-status="not-an-article"]';
const NOTICE_TEXT = ".article-body__reader-notice-text";
const NOTICE_CTA = "[data-test-reader-failed-primary]";
const READER_VIEWPORT = { width: 1280, height: 900 };

const CreatedUser = z.union([
	z.object({ ok: z.literal(true), userId: z.string() }),
	z.object({ ok: z.literal(false), reason: z.string() }),
]);
const SeededArticle = z.object({ articleId: z.string().optional() });

async function createOwner(page: Page, email: string): Promise<string> {
	const response = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: OWNER_PASSWORD, verified: true },
	});
	assert.equal(response.status(), 201, "the e2e user fixture must answer the create request");
	const created = CreatedUser.parse(await response.json());
	assert(created.ok, `the e2e user fixture must create the owner ${email}`);
	return created.userId;
}

async function seedCapturedInbox(
	page: Page,
	savedByUserId?: string,
): Promise<string | undefined> {
	const response = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: GATED_URL,
			title: CAPTURED_TITLE,
			content: CAPTURED_BODY,
			contentFetchedAt: CONTENT_FETCHED_AT,
			excerpt: "Re: your invoice is attached",
			generatedSummary: {
				summary: "Your inbox has 42 unread messages.",
				excerpt: "Re: your invoice is attached",
			},
			...(savedByUserId ? { savedByUserId } : {}),
		},
	});
	assert.equal(response.status(), 201, "seed endpoint must create the captured article");
	return SeededArticle.parse(await response.json()).articleId;
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(OWNER_PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function noticeSettled(page: Page): Promise<void> {
	await page.waitForSelector(NOTICE);
	await page.evaluate(() => {
		document.querySelector(".offline-banner")?.remove();
		document.querySelector(".trial-countdown")?.remove();
	});
}

async function noticeGeometry(page: Page): Promise<void> {
	const notice = page.locator(NOTICE);
	assert.equal(
		(await notice.locator(NOTICE_TEXT).innerText()).trim(),
		"This link isn't an article, so there's no reader view.",
	);
	const cta = notice.locator(NOTICE_CTA);
	assert.equal((await cta.innerText()).trim(), "View the link");
	assert.equal(await cta.getAttribute("href"), GATED_URL);

	const rendered = await page.locator("body").innerText();
	assert.ok(
		!rendered.includes(CAPTURED_TITLE),
		"the captured mail-session title must not reach the page",
	);
	assert.ok(
		!rendered.includes("Your inbox has 42 unread messages."),
		"the stored AI summary must not reach the page",
	);

	const pageOverflow = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	assert.equal(
		pageOverflow.scrollWidth,
		pageOverflow.clientWidth,
		"the notice must stay inside the reader column and never scroll the page sideways",
	);
}

function checkpointNamed(name: string): VisualCheckpoint {
	return {
		name,
		settled: noticeSettled,
		geometry: noticeGeometry,
		target: NOTICE,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("A link whose host can never hold an article", () => {
	test.use({ timezoneId: "UTC", viewport: READER_VIEWPORT });

	test("the public reader shows the friendly notice instead of the captured session", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("readplace.extension-suggestion-dismissed", "1");
		});
		await page.emulateMedia({ colorScheme: "light" });
		await seedCapturedInbox(page);

		await page.goto(`${BASE_URL}/view/${GATED_PATH}`, { waitUntil: "domcontentloaded" });

		await captureCheckpoint(page, checkpointNamed("reader-not-an-article-public"));
	});

	test("the owner's reader shows the same notice", async ({ page }, testInfo) => {
		const email = `reader-not-an-article-${testInfo.workerIndex}-${Date.now()}@example.com`;
		await page.addInitScript(() => {
			window.localStorage.setItem("readplace.extension-suggestion-dismissed", "1");
		});
		await page.emulateMedia({ colorScheme: "light" });
		const ownerUserId = await createOwner(page, email);
		const articleId = await seedCapturedInbox(page, ownerUserId);
		assert(articleId, "the seeded article must be saved to the owner");
		await loginAs(page, email);

		await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });

		await captureCheckpoint(page, checkpointNamed("reader-not-an-article-owner"));
	});
});
