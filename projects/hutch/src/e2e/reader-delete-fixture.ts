import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { requireEnv } from "@packages/require-env";

export const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
export const ARTICLE_TITLE = "How Google Sold Its Engineers on Management";
export const MENU_TOGGLE = '[data-test-action="reader-menu"]';
export const MENU = "[data-test-reader-menu]";
export const MENU_PANEL = "[data-test-reader-menu-panel]";
export const MENU_DELETE = `${MENU_PANEL} [data-test-action="delete"]`;
export const CONFIRM = '[data-test-confirm-popover="delete"]';
export const OPEN_CONFIRM = `${CONFIRM}:popover-open`;
export const CONFIRM_DELETE = `${OPEN_CONFIRM} [data-test-action="delete-confirm"]`;
export const CONFIRM_NEVER = `${OPEN_CONFIRM} [data-test-action="delete-confirm-never"]`;

const PASSWORD = "password123";
const CONTENT_FETCHED_AT = "2026-07-10T09:14:00.000Z";
const LONG_BODY = Array.from(
	{ length: 40 },
	() => "<p>Seeded body for the reader deletion checks, repeated so the reader scrolls past its toolbar.</p>",
).join("");

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ articleId: z.string() });

export interface Reader {
	userId: string;
	email: string;
}

export async function createReader(page: Page, stamp: string): Promise<Reader> {
	const email = `reader-delete-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	return { userId: CreatedUser.parse(await created.json()).userId, email };
}

export async function seedArticle(
	page: Page,
	input: { reader: Reader; slug: string; title?: string },
): Promise<{ articleId: string; url: string }> {
	const url = `https://example.com/${input.slug}`;
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url,
			title: input.title ?? ARTICLE_TITLE,
			content: LONG_BODY,
			contentFetchedAt: CONTENT_FETCHED_AT,
			savedByUserId: input.reader.userId,
			generatedSummary: {
				summary: "Seeded summary so the reader's summary poller settles before the checks.",
				excerpt: "Seeded summary.",
			},
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the crawled article");
	return { articleId: SeededArticle.parse(await seeded.json()).articleId, url };
}

export async function login(page: Page, reader: Reader): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(reader.email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

export async function createReadlist(page: Page, label: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label } });
	const slug = new URL(created.url()).searchParams.get("queue");
	assert.ok(slug, "creating a readlist must land on it");
	return slug;
}

export async function fileInto(page: Page, input: { articleId: string; readlist: string }): Promise<void> {
	const assigned = await page.request.post(`${BASE_URL}/queue/${input.articleId}/assign`, {
		form: { queue: input.readlist, returnTo: `/queue/${input.articleId}/view` },
	});
	assert.ok(assigned.ok(), "filing the article must succeed");
}

export async function openReader(page: Page, input: { articleId: string; query?: string }): Promise<void> {
	await page.goto(`${BASE_URL}/queue/${input.articleId}/view${input.query ?? ""}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-reader");
	await page.waitForSelector(MENU_TOGGLE);
}

export async function openMenu(page: Page): Promise<void> {
	await page.click(MENU_TOGGLE);
	await page.waitForSelector(`${MENU}[open] ${MENU_PANEL}`);
}
