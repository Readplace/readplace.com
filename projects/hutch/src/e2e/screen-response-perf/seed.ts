/* c8 ignore start -- staging-only perf harness, never run under the local suite */
import assert from "node:assert/strict";
import { type Page, expect } from "@playwright/test";
import {
	ARTICLE_CARD,
	QUEUE_NAV,
	READER_SLOT_READY,
	REPEATING_POLLER,
	type TabId,
	queueNavLink,
	terminalCard,
} from "./screen-response-ops";

const CRAWL_SETTLE_TIMEOUT_MS = 300_000;
const READER_SETTLE_TIMEOUT_MS = 180_000;
const NAVIGATION_TIMEOUT_MS = 30_000;

/** The queue lists from an eventually-consistent GSI, so a save can still be
 * propagating when the listing is read back. */
const GSI_PROPAGATION_SETTLE_MS = 2000;

const ARTICLES_PER_SWITCH_QUEUE = 4;
const READ_PER_SWITCH_QUEUE = 2;
const CARDS_PER_TAB = ARTICLES_PER_SWITCH_QUEUE - READ_PER_SWITCH_QUEUE;
const DEDICATED_ARTICLES = 2;
const TOTAL_ARTICLES = ARTICLES_PER_SWITCH_QUEUE * 2 + DEDICATED_ARTICLES;

export interface SeededDataset {
	assignArticleId: string;
	openArticleId: string;
	alphaSlug: string;
	bravoSlug: string;
	assignSlug: string;
	cardsPerSwitchTab: number;
	defaultQueueUnreadCards: number;
}

export function queueUrl(input: { baseURL: string; queue?: string; tab?: TabId }): string {
	const params = new URLSearchParams();
	if (input.queue !== undefined) params.set("queue", input.queue);
	if (input.tab === "done") params.set("tab", "done");
	params.append("feature", "queues");
	return `${input.baseURL}/queue?${params.toString()}`;
}

export function readerUrl(input: { baseURL: string; articleId: string }): string {
	return `${input.baseURL}/queue/${input.articleId}/view`;
}

async function post(input: {
	page: Page;
	url: string;
	form: Record<string, string>;
	what: string;
}): Promise<void> {
	const response = await input.page.request.post(input.url, { form: input.form });
	assert.ok(response.ok(), `${input.what} answered ${response.status()}`);
}

async function queueSlugsOn(page: Page): Promise<string[]> {
	return page
		.locator(`${QUEUE_NAV} a[data-test-queue]`)
		.evaluateAll((links) =>
			links.flatMap((link) => {
				const slug = link.getAttribute("data-test-queue");
				return slug === null ? [] : [slug];
			}),
		);
}

async function createQueue(input: { page: Page; baseURL: string }): Promise<string> {
	const { page } = input;
	await page.goto(queueUrl({ baseURL: input.baseURL }), { waitUntil: "domcontentloaded" });
	const before = await queueSlugsOn(page);
	await page.locator('[data-test-action="new-queue"]').click();
	await page.waitForSelector(QUEUE_NAV, { timeout: NAVIGATION_TIMEOUT_MS });
	await expect
		.poll(async () => (await queueSlugsOn(page)).length, { timeout: NAVIGATION_TIMEOUT_MS })
		.toBe(before.length + 1);
	const created = (await queueSlugsOn(page)).filter((slug) => !before.includes(slug));
	assert.equal(created.length, 1, `creating a queue produced ${created.length} new slugs`);
	return created[0];
}

async function articleIdsOn(page: Page): Promise<string[]> {
	return page.locator(ARTICLE_CARD).evaluateAll((cards) =>
		cards.flatMap((card) => {
			const id = card.getAttribute("data-test-article");
			return id === null ? [] : [id];
		}),
	);
}

async function waitForEveryCardTerminal(input: {
	page: Page;
	url: string;
	expectedCards: number;
}): Promise<string[]> {
	const { page } = input;
	await expect
		.poll(
			async () => {
				await page.goto(input.url, { waitUntil: "domcontentloaded" });
				const ids = await articleIdsOn(page);
				if (ids.length !== input.expectedCards) return -1;
				const terminal = await Promise.all(
					ids.map((id) => page.locator(terminalCard(id)).count()),
				);
				return terminal.filter((count) => count === 1).length;
			},
			{ timeout: CRAWL_SETTLE_TIMEOUT_MS, intervals: [5000] },
		)
		.toBe(input.expectedCards);
	return articleIdsOn(page);
}

export async function assertNoRepeatingPollers(input: {
	page: Page;
	where: string;
}): Promise<void> {
	const pollers = await input.page
		.locator(REPEATING_POLLER)
		.evaluateAll((elements) => elements.map((element) => element.outerHTML.slice(0, 200)));
	assert.equal(
		pollers.length,
		0,
		`${input.where} still carries ${pollers.length} repeating poller(s), which would mutate the DOM mid-measurement: ${pollers.join(" | ")}`,
	);
}

export async function settleReader(input: {
	page: Page;
	baseURL: string;
	articleId: string;
}): Promise<void> {
	const { page } = input;
	await page.goto(readerUrl({ baseURL: input.baseURL, articleId: input.articleId }), {
		waitUntil: "domcontentloaded",
	});
	await page.waitForSelector(READER_SLOT_READY, { timeout: READER_SETTLE_TIMEOUT_MS });
	await expect(page.locator(REPEATING_POLLER)).toHaveCount(0, {
		timeout: READER_SETTLE_TIMEOUT_MS,
	});
	await assertNoRepeatingPollers({ page, where: `the reader for ${input.articleId}` });
}

export async function settleListing(input: {
	page: Page;
	baseURL: string;
	queue?: string;
	tab?: TabId;
	expectedCards: number;
}): Promise<void> {
	const { page } = input;
	const url = queueUrl({ baseURL: input.baseURL, queue: input.queue, tab: input.tab });
	await page.goto(url, { waitUntil: "domcontentloaded" });
	await expect(page.locator(ARTICLE_CARD)).toHaveCount(input.expectedCards, {
		timeout: CRAWL_SETTLE_TIMEOUT_MS,
	});
	await expect(page.locator(REPEATING_POLLER)).toHaveCount(0, {
		timeout: CRAWL_SETTLE_TIMEOUT_MS,
	});
	await assertNoRepeatingPollers({ page, where: url });
}

export async function seedPerfDataset(input: {
	page: Page;
	baseURL: string;
	runId: string;
	diagnostic: (message: string) => void;
}): Promise<SeededDataset> {
	const { page, baseURL, runId, diagnostic } = input;

	const alphaSlug = await createQueue({ page, baseURL });
	const bravoSlug = await createQueue({ page, baseURL });
	const assignSlug = await createQueue({ page, baseURL });
	diagnostic(`queues: alpha=${alphaSlug} bravo=${bravoSlug} assign=${assignSlug}`);

	for (let index = 0; index < TOTAL_ARTICLES; index += 1) {
		await post({
			page,
			url: `${baseURL}/queue/save`,
			form: { url: `${baseURL}/e2e/article/${runId}-${index}` },
			what: `saving fixture article ${index}`,
		});
	}

	const defaultQueueUrl = queueUrl({ baseURL });
	const ids = await waitForEveryCardTerminal({
		page,
		url: defaultQueueUrl,
		expectedCards: TOTAL_ARTICLES,
	});
	diagnostic(`${ids.length} fixture articles reached a terminal card state`);

	const [assignArticleId, openArticleId, ...filed] = ids;
	const alphaArticles = filed.slice(0, ARTICLES_PER_SWITCH_QUEUE);
	const bravoArticles = filed.slice(ARTICLES_PER_SWITCH_QUEUE);

	for (const [slug, articles] of [
		[alphaSlug, alphaArticles],
		[bravoSlug, bravoArticles],
	] satisfies [string, string[]][]) {
		for (const articleId of articles) {
			await post({
				page,
				url: `${baseURL}/queue/${articleId}/assign`,
				form: { queue: slug, returnTo: `/queue/${articleId}/view` },
				what: `filing ${articleId} into ${slug}`,
			});
		}
		for (const articleId of articles.slice(0, READ_PER_SWITCH_QUEUE)) {
			await post({
				page,
				url: `${baseURL}/queue/${articleId}/status`,
				form: { status: "read" },
				what: `marking ${articleId} read`,
			});
		}
	}

	for (const articleId of [assignArticleId, openArticleId]) {
		await post({
			page,
			url: `${baseURL}/queue/${articleId}/related-dismiss`,
			form: { returnTo: `/queue/${articleId}/view` },
			what: `dismissing next-read on ${articleId}`,
		});
	}

	await page.waitForTimeout(GSI_PROPAGATION_SETTLE_MS);

	const defaultQueueUnreadCards = TOTAL_ARTICLES - READ_PER_SWITCH_QUEUE * 2;
	await settleListing({ page, baseURL, expectedCards: defaultQueueUnreadCards });
	for (const slug of [alphaSlug, bravoSlug]) {
		await settleListing({ page, baseURL, queue: slug, expectedCards: CARDS_PER_TAB });
		await settleListing({
			page,
			baseURL,
			queue: slug,
			tab: "done",
			expectedCards: CARDS_PER_TAB,
		});
	}
	await settleListing({ page, baseURL, queue: assignSlug, expectedCards: 0 });
	await settleReader({ page, baseURL, articleId: assignArticleId });
	await settleReader({ page, baseURL, articleId: openArticleId });

	await page.goto(queueUrl({ baseURL, queue: alphaSlug }), { waitUntil: "domcontentloaded" });
	await expect(page.locator(queueNavLink(bravoSlug))).toHaveCount(1);

	return {
		assignArticleId,
		openArticleId,
		alphaSlug,
		bravoSlug,
		assignSlug,
		cardsPerSwitchTab: CARDS_PER_TAB,
		defaultQueueUnreadCards,
	};
}
/* c8 ignore stop */
