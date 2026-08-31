import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
	captureCheckpoint,
	measuredBox,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const PASSWORD = "Sup3r-Secret-Pw!";

const DESKTOP = { width: 1280, height: 900 };

const SECTION = "[data-test-account-shared]";
const HEADING = `${SECTION} .account-shared__heading`;
const MESSAGE = `${SECTION} [data-test-shared-message]`;
const FETCHED_AT = "2026-04-27T08:00:00.000Z";

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

const SHARED_ARTICLES = [
	{
		slug: "the-quiet-web",
		title: "The Quiet Web",
		savedAt: "2026-07-12T09:14:00.000Z",
		pinnedTime: "just now",
	},
	{
		slug: "how-compilers-actually-work",
		title: "How Compilers Actually Work",
		savedAt: "2026-07-11T09:14:00.000Z",
		pinnedTime: "5 hours ago",
	},
	{
		slug: "the-case-for-reading-on-paper",
		title: "The Case for Reading on Paper",
		savedAt: "2026-07-10T09:14:00.000Z",
		pinnedTime: "2 days ago",
	},
];

function rowSelector(position: number): string {
	return `${SECTION} .account-shared__item:nth-of-type(${position})`;
}

async function createOwner(page: Page, stamp: string): Promise<{ email: string; userId: string }> {
	const email = `account-shared-${stamp}@example.com`;
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must create the owner");
	const { userId } = CreatedUser.parse(await created.json());
	return { email, userId };
}

async function seedSharedArticles(page: Page, stamp: string): Promise<{ email: string; articleIds: string[] }> {
	const { email, userId } = await createOwner(page, stamp);
	const articleIds: string[] = [];
	for (const article of SHARED_ARTICLES) {
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/${article.slug}`,
				title: article.title,
				content: "<p>Seeded body for the shared-links baseline.</p>",
				contentFetchedAt: FETCHED_AT,
				savedAt: article.savedAt,
				savedByUserId: userId,
				excerpt: "A fixed excerpt for the shared-links baseline.",
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the shared article");
		articleIds.push(SeededArticle.parse(await seeded.json()).articleId);
	}
	return { email, articleIds };
}

async function loginAs(page: Page, email: string): Promise<void> {
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
}

async function shareOldestListedFirst(page: Page, articleIds: readonly string[]): Promise<void> {
	for (const articleId of [...articleIds].reverse()) {
		const shared = await page.request.post(`${BASE_URL}/queue/${articleId}/share`);
		assert.equal(shared.status(), 204, "the share beacon target must record the share");
	}
}

async function openAccount(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-account");
}

async function allRowsRendered(page: Page): Promise<void> {
	await page.waitForSelector(rowSelector(SHARED_ARTICLES.length));
}

async function emptyStateRendered(page: Page): Promise<void> {
	await page.waitForSelector(MESSAGE);
}

async function rowsReadAsADividedList(page: Page): Promise<void> {
	const section = await measuredBox(page, SECTION);
	const heading = await measuredBox(page, HEADING);
	assert.ok(
		heading.y + heading.height <= (await measuredBox(page, rowSelector(1))).y,
		"the heading must sit above the first shared row",
	);
	let previousBottom = 0;
	for (const [index, article] of SHARED_ARTICLES.entries()) {
		const position = index + 1;
		const row = await measuredBox(page, rowSelector(position));
		const link = await measuredBox(page, `${rowSelector(position)} .account-shared__link`);
		const time = await measuredBox(page, `${rowSelector(position)} .account-shared__time`);
		assert.ok(
			row.x >= section.x && row.x + row.width <= section.x + section.width,
			`row ${position} must sit inside the section chassis`,
		);
		assert.ok(
			row.y >= previousBottom,
			`row ${position} must stack below the previous row, not overlap it`,
		);
		previousBottom = row.y + row.height;
		assert.ok(
			time.x >= link.x + link.width,
			`row ${position} must keep its shared-time to the right of its title link`,
		);
		assert.ok(
			time.y < link.y + link.height && link.y < time.y + time.height,
			`row ${position} must keep the title and its shared-time on one line`,
		);
		const href = await page
			.locator(`${rowSelector(position)} .account-shared__link`)
			.getAttribute("href");
		assert.equal(
			href,
			`/view/example.com/${article.slug}`,
			`row ${position} must link to the newest-shared-first /view permalink`,
		);
	}
}

async function emptyStateInvitesTheFirstShare(page: Page): Promise<void> {
	const section = await measuredBox(page, SECTION);
	const heading = await measuredBox(page, HEADING);
	const message = await measuredBox(page, MESSAGE);
	assert.ok(
		message.y >= heading.y + heading.height,
		"the empty-state message must sit under the heading",
	);
	assert.ok(
		message.x >= section.x && message.x + message.width <= section.x + section.width,
		"the empty-state message must sit inside the section chassis",
	);
}

function sharedListCheckpoint(theme: "light" | "dark"): VisualCheckpoint {
	return {
		name: `account-shared-list-${theme}`,
		settled: allRowsRendered,
		geometry: rowsReadAsADividedList,
		target: SECTION,
		capture: "element",
		pinnedText: SHARED_ARTICLES.map((article, index) => ({
			selector: `${rowSelector(index + 1)} .account-shared__time`,
			text: article.pinnedTime,
		})),
	};
}

function emptyStateCheckpoint(theme: "light" | "dark"): VisualCheckpoint {
	return {
		name: `account-shared-empty-${theme}`,
		settled: emptyStateRendered,
		geometry: emptyStateInvitesTheFirstShare,
		target: SECTION,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("Account shared links", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP });

	for (const theme of ["light", "dark"] as const) {
		test(`the shared list reads as a divided list of permalinks (${theme})`, async ({
			page,
		}, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email, articleIds } = await seedSharedArticles(
				page,
				`list-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await shareOldestListedFirst(page, articleIds);
			await openAccount(page);

			await captureCheckpoint(page, sharedListCheckpoint(theme));
		});

		test(`the empty state invites the first share (${theme})`, async ({ page }, testInfo) => {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			const { email } = await createOwner(
				page,
				`empty-${theme}-${testInfo.workerIndex}-${Date.now()}`,
			);
			await loginAs(page, email);
			await openAccount(page);

			await captureCheckpoint(page, emptyStateCheckpoint(theme));
		});
	}
});
