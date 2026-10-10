import assert from "node:assert/strict";
import { MinutesSchema, toArticleTopics, type ArticleTopic } from "@packages/domain/article";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import { READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture, createFakeSummaryProvider } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const NOW = new Date("2026-04-25T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type TestHarness = ReturnType<typeof useApp>;
type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type SummaryProvider = ReturnType<typeof createFakeSummaryProvider>;

interface SeededArticle {
	url: string;
	title: string;
	siteName?: string;
	minutes?: number;
	savedAt?: Date;
	readlist?: string;
}

function pinnedFixture(summary: SummaryProvider = createFakeSummaryProvider()) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN, summary);
	return { ...fixture, shared: { ...fixture.shared, now: () => NOW } };
}

function fixtureWithGmail() {
	const gmail = initInMemoryGmailIntegration({
		grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
		addresses: initInMemoryInboxAddress({ now: () => new Date() }),
		accountEmail: { ok: true, value: GmailAccountEmailSchema.parse("reader@gmail.com") },
	});
	return { ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle };
}

async function readerId(harness: TestHarness): Promise<UserId> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the signed-in reader must exist");
	return user.userId;
}

async function seed(harness: TestHarness, article: SeededArticle): Promise<void> {
	const userId = await readerId(harness);
	const save = {
		userId,
		url: article.url,
		metadata: {
			title: article.title,
			siteName: article.siteName ?? "example.com",
			excerpt: "",
			wordCount: article.minutes === undefined ? 0 : article.minutes * 238,
		},
		estimatedReadTime: MinutesSchema.parse(article.minutes ?? 0),
		provenance: { kind: "web" as const },
		savedAt: article.savedAt ?? new Date(NOW.getTime() - HOUR),
	};
	if (article.readlist === undefined) {
		await harness.articleStore.saveArticle(save);
		return;
	}
	await harness.articleStore.saveReadlistArticle({ ...save, readlist: ReadlistSlugSchema.parse(article.readlist) });
}

async function seedAll(harness: TestHarness, articles: SeededArticle[]): Promise<void> {
	for (const article of articles) await seed(harness, article);
}

function readyWithTopics(summary: SummaryProvider, url: string, topics: readonly ArticleTopic[]): void {
	summary.markSummaryReady({ url, summary: "A summary.", excerpt: "An excerpt.", topics });
}

async function createReadlist(agent: TestAgent, label: string): Promise<string> {
	const response = await agent.post("/queue/queues").type("form").send({ label });
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function makeReadOnly(harness: TestHarness): Promise<void> {
	const userId = await readerId(harness);
	await harness.subscriptionProviders.upsertActive({ userId, subscriptionId: "sub_discovery", customerId: "cus_discovery" });
	await harness.subscriptionProviders.markCancelledByUserId({ userId });
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function page(agent: TestAgent, path: string): Promise<Document> {
	const response = await agent.get(path);
	expect(response.status).toBe(200);
	return parse(response.text);
}

function listedUrls(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-article-list] [data-test-article]"), (card) =>
		card.querySelector("[data-test-article-url]")?.getAttribute("href") ?? null,
	);
}

async function listedOn(agent: TestAgent, path: string): Promise<(string | null)[]> {
	return listedUrls(await page(agent, path));
}

function element(doc: Document, selector: string): Element {
	const found = doc.querySelector(selector);
	assert(found, `${selector} must be rendered`);
	return found;
}

function params(href: string | null): URLSearchParams {
	return new URL(href ?? "", TEST_APP_ORIGIN).searchParams;
}

function discoveryParamsOf(href: string | null): [string, string][] {
	return [...params(href)].filter(([name]) => ["q", "time", "saved", "topic"].includes(name));
}

function hiddenFields(form: Element): [string | null, string | null][] {
	return Array.from(form.querySelectorAll(':scope > input[type="hidden"]'), (input) => [
		input.getAttribute("name"),
		input.getAttribute("value"),
	]);
}

function checkedOptions(doc: Document, scope: string): (string | null)[] {
	return Array.from(doc.querySelectorAll(`[data-test-discovery-form="${scope}"] [data-test-discovery-option]`))
		.filter((option) => option.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked)
		.map((option) => option.getAttribute("data-test-discovery-option"));
}

function offeredOptions(doc: Document, scope: string, group: string): (string | null)[] {
	return Array.from(
		doc.querySelectorAll(`[data-test-discovery-form="${scope}"] [data-test-discovery-option^="${group}:"]`),
		(option) => option.getAttribute("data-test-discovery-option"),
	);
}

function searchSubmission(doc: Document, q: string): string {
	const query = new URLSearchParams(
		hiddenFields(element(doc, '[data-test-form="readlist-search"]')).map(([name, value]) => [name ?? "", value ?? ""]),
	);
	query.append("q", q);
	return `/queue?${query}`;
}

function drawerSubmission(doc: Document, tick: string[]): string {
	const form = element(doc, '[data-test-discovery-form="popover"]');
	const query = new URLSearchParams(hiddenFields(form).map(([name, value]) => [name ?? "", value ?? ""]));
	for (const option of tick) {
		const [name, value] = option.split(":");
		query.append(name, value);
	}
	return `/queue?${query}`;
}

function cardOf(doc: Document, url: string): Element {
	const card = Array.from(doc.querySelectorAll("[data-test-article-list] [data-test-article]")).find(
		(candidate) => candidate.querySelector("[data-test-article-url]")?.getAttribute("href") === url,
	);
	assert(card, `the card for ${url} must render`);
	return card;
}

function formActionOf(control: Element | null): string {
	const action = control?.closest("form")?.getAttribute("action");
	assert(action, "the control must submit a form");
	return action;
}

function cardStatusAction(doc: Document, url: string): string {
	return formActionOf(cardOf(doc, url).querySelector('[data-test-action="mark-read"]'));
}

function articleIdOf(doc: Document, url: string): string {
	const id = cardOf(doc, url).getAttribute("data-test-article");
	assert(id, `the card for ${url} must carry its article id`);
	return id;
}

function toastUndoAction(doc: Document): string {
	const action = doc.querySelector("#status-toast [data-test-toast-action]")?.closest("form")?.getAttribute("action");
	assert(action, "the toast must offer its Undo as a form");
	return action;
}

describe("Readlist discovery (GET /queue with a search or filters)", () => {
	describe("search", () => {
		const ARTICLES: SeededArticle[] = [
			{ url: "https://www.theatlantic.com/remote", title: "Remote work in São Paulo", siteName: "The Atlantic", savedAt: new Date(NOW.getTime() - 3 * HOUR) },
			{ url: "https://finance.example.org/budget", title: "Budget basics", siteName: "Finance Weekly", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
			{ url: "https://calnewport.com/deep", title: "Deep work rituals", siteName: "Cal Newport", savedAt: new Date(NOW.getTime() - HOUR) },
		];

		it("matches the title, the site label and the destination host", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, ARTICLES);

			expect(await listedOn(agent, "/queue?q=budget")).toEqual(["https://finance.example.org/budget"]);
			expect(await listedOn(agent, "/queue?q=atlantic")).toEqual(["https://www.theatlantic.com/remote"]);
			expect(await listedOn(agent, "/queue?q=calnewport.com")).toEqual(["https://calnewport.com/deep"]);
		});

		it("ignores case and accents, and needs every term", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, ARTICLES);

			expect(await listedOn(agent, "/queue?q=SAO")).toEqual(["https://www.theatlantic.com/remote"]);
			expect(await listedOn(agent, "/queue?q=work")).toEqual([
				"https://calnewport.com/deep",
				"https://www.theatlantic.com/remote",
			]);
			expect(await listedOn(agent, "/queue?q=work+deep")).toEqual(["https://calnewport.com/deep"]);
		});

		it("keeps the open tab's order", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, ARTICLES);

			expect(await listedOn(agent, "/queue?q=work&order=asc")).toEqual([
				"https://www.theatlantic.com/remote",
				"https://calnewport.com/deep",
			]);
		});

		it("searches only the read rows on the Read tab", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, ARTICLES);
			const doc = await page(agent, "/queue");
			for (const url of ["https://finance.example.org/budget", "https://calnewport.com/deep"]) {
				await agent.post(`/queue/${articleIdOf(doc, url)}/status`).type("form").send({ status: "read" });
			}

			expect(await listedOn(agent, "/queue?tab=done&q=work")).toEqual(["https://calnewport.com/deep"]);
			expect(await listedOn(agent, "/queue?q=work")).toEqual(["https://www.theatlantic.com/remote"]);
		});

		it("searches a custom readlist's own rows only", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const work = await createReadlist(agent, "Work");
			await seedAll(harness, [
				{ url: "https://example.com/focus-in-all", title: "Focus in All" },
				{ url: "https://example.com/focus-in-work", title: "Focus in Work", readlist: work },
			]);

			expect(await listedOn(agent, `/queue?queue=${work}&q=focus`)).toEqual(["https://example.com/focus-in-work"]);
		});

		it("round-trips what the search form submits", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, ARTICLES);

			const doc = await page(agent, "/queue?order=asc&time=under-5");

			expect(await listedOn(agent, searchSubmission(doc, "work"))).toEqual([]);
			expect(await listedOn(agent, searchSubmission(await page(agent, "/queue?order=asc"), "work"))).toEqual([
				"https://www.theatlantic.com/remote",
				"https://calnewport.com/deep",
			]);
		});
	});

	describe("filters", () => {
		it("keeps a reading-time bucket, ORs two buckets, and never matches a row with no read time", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/three", title: "Three", minutes: 3, savedAt: new Date(NOW.getTime() - 4 * HOUR) },
				{ url: "https://example.com/eight", title: "Eight", minutes: 8, savedAt: new Date(NOW.getTime() - 3 * HOUR) },
				{ url: "https://example.com/twenty-five", title: "Twenty five", minutes: 25, savedAt: new Date(NOW.getTime() - 2 * HOUR) },
				{ url: "https://example.com/no-read-time", title: "No read time", savedAt: new Date(NOW.getTime() - HOUR) },
			]);

			expect(await listedOn(agent, "/queue?time=5-10")).toEqual(["https://example.com/eight"]);
			expect(await listedOn(agent, "/queue?time=under-5&time=20-plus")).toEqual([
				"https://example.com/twenty-five",
				"https://example.com/three",
			]);
		});

		it("keeps the saved-date windows rolling back from the server clock", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/an-hour-ago", title: "An hour ago", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/three-days-ago", title: "Three days ago", savedAt: new Date(NOW.getTime() - 3 * DAY) },
				{ url: "https://example.com/twenty-days-ago", title: "Twenty days ago", savedAt: new Date(NOW.getTime() - 20 * DAY) },
				{ url: "https://example.com/45-days-ago", title: "45 days ago", savedAt: new Date(NOW.getTime() - 45 * DAY) },
			]);

			expect(await listedOn(agent, "/queue?saved=today")).toEqual(["https://example.com/an-hour-ago"]);
			expect(await listedOn(agent, "/queue?saved=week")).toEqual([
				"https://example.com/an-hour-ago",
				"https://example.com/three-days-ago",
			]);
			expect(await listedOn(agent, "/queue?saved=month")).toEqual([
				"https://example.com/an-hour-ago",
				"https://example.com/three-days-ago",
				"https://example.com/twenty-days-ago",
			]);
			expect(await listedOn(agent, "/queue?saved=older")).toEqual(["https://example.com/45-days-ago"]);
			expect(await listedOn(agent, "/queue?saved=today&saved=older")).toEqual([
				"https://example.com/an-hour-ago",
				"https://example.com/45-days-ago",
			]);
		});

		it("combines the search and every filter group with AND", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/match", title: "Focus at work", minutes: 8, savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/too-long", title: "Focus deeply", minutes: 25, savedAt: new Date(NOW.getTime() - 2 * HOUR) },
				{ url: "https://example.com/too-old", title: "Focus now", minutes: 8, savedAt: new Date(NOW.getTime() - 40 * DAY) },
				{ url: "https://example.com/other-words", title: "Budget basics", minutes: 8, savedAt: new Date(NOW.getTime() - 3 * HOUR) },
			]);

			expect(await listedOn(agent, "/queue?q=focus&time=5-10&saved=week")).toEqual(["https://example.com/match"]);
		});

		it("matches a ticked topic in any case, the untopiced rows under Others, and topic labels in the search", async () => {
			const summary = createFakeSummaryProvider();
			const harness = useApp(pinnedFixture(summary));
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/finance", title: "Spending plans", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/focus", title: "Quiet mornings", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
				{ url: "https://example.com/no-topics", title: "Untitled thoughts", savedAt: new Date(NOW.getTime() - 3 * HOUR) },
				{ url: "https://example.com/no-summary", title: "Still summarising", savedAt: new Date(NOW.getTime() - 4 * HOUR) },
			]);
			readyWithTopics(summary, "https://example.com/finance", toArticleTopics(["Personal finance"]));
			readyWithTopics(summary, "https://example.com/focus", toArticleTopics(["Focus"]));
			readyWithTopics(summary, "https://example.com/no-topics", []);

			expect(await listedOn(agent, "/queue?topic=focus")).toEqual(["https://example.com/focus"]);
			expect(await listedOn(agent, "/queue?topic=others")).toEqual([
				"https://example.com/no-topics",
				"https://example.com/no-summary",
			]);
			expect(await listedOn(agent, "/queue?topic=Focus&topic=others")).toEqual([
				"https://example.com/focus",
				"https://example.com/no-topics",
				"https://example.com/no-summary",
			]);
			expect(await listedOn(agent, "/queue?q=finance")).toEqual(["https://example.com/finance"]);
		});

		it("round-trips what Apply submits, keeping the search and dropping the page", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/short", title: "Focus short", minutes: 3, savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/medium", title: "Focus medium", minutes: 8, savedAt: new Date(NOW.getTime() - 2 * HOUR) },
				{ url: "https://example.com/other", title: "Budget medium", minutes: 8, savedAt: new Date(NOW.getTime() - 3 * HOUR) },
			]);

			const submitted = drawerSubmission(await page(agent, "/queue?q=focus&saved=month"), ["time:5-10"]);

			expect([...params(submitted)].filter(([name]) => !name.startsWith("utm_"))).toEqual([
				["q", "focus"],
				["time", "5-10"],
			]);
			expect(await listedOn(agent, submitted)).toEqual(["https://example.com/medium"]);
		});
	});

	describe("pages and counts", () => {
		async function seedMatches(harness: TestHarness): Promise<void> {
			const articles: SeededArticle[] = [];
			for (let index = 0; index < 23; index += 1) {
				articles.push({ url: `https://example.com/match-${index}`, title: `Match ${index}`, savedAt: new Date(NOW.getTime() - (index + 1) * HOUR) });
			}
			for (let index = 0; index < 3; index += 1) {
				articles.push({ url: `https://example.com/other-${index}`, title: `Other ${index}`, savedAt: new Date(NOW.getTime() - (index + 30) * HOUR) });
			}
			await seedAll(harness, articles);
		}

		it("pages through the matching rows and keeps the search on the next link", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedMatches(harness);

			const first = await page(agent, "/queue?q=match");
			expect(listedUrls(first)).toHaveLength(20);
			const next = element(first, "[data-test-pagination-next]").getAttribute("href");
			expect([discoveryParamsOf(next), params(next).get("page")]).toEqual([[["q", "match"]], "2"]);
			expect(listedUrls(await page(agent, "/queue?q=match&page=2"))).toEqual([
				"https://example.com/match-20",
				"https://example.com/match-21",
				"https://example.com/match-22",
			]);
		});

		it("sends an over-deep page to the last page of the matching rows, keeping the search", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedMatches(harness);

			const response = await agent.get("/queue?q=match&page=5");

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe("/queue?q=match&page=2");
		});

		it("counts the matching rows into the header count and the pager", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedMatches(harness);

			const response = await agent.get("/queue/counts?q=match");

			const doc = new JSDOM(`<main>${response.text}</main>`).window.document;
			expect(element(doc, "#readlist-count").textContent).toBe("23 Saved Articles");
			expect(element(doc, "#readlist-pagination-info").textContent).toBe("Showing 20 of 23");
		});

		it("points the counts loader at the matching rows", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedMatches(harness);

			const counts = element(await page(agent, "/queue?q=match"), "#readlist-counts").getAttribute("hx-get");
			expect(discoveryParamsOf(counts)).toEqual([["q", "match"]]);
		});
	});

	describe("links that keep or drop the search", () => {
		it("keeps the search on the sort link and both tab links, and leaves it off the rail", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seed(harness, { url: "https://example.com/focus", title: "Focus" });

			const doc = await page(agent, "/queue?q=focus&time=5-10");

			for (const selector of ["[data-test-sort]", '[data-test-filter="unread"]', '[data-test-filter="read"]']) {
				expect(discoveryParamsOf(element(doc, selector).getAttribute("href"))).toEqual([
					["q", "focus"],
					["time", "5-10"],
				]);
			}
			expect([...params(element(doc, '[data-test-readlist="default"]').getAttribute("href")).keys()]).toEqual([
				"utm_source",
				"utm_medium",
				"utm_content",
			]);
		});

		it("keeps the search on a card's status action, its redirect and the toast's Undo", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/focus-a", title: "Focus A", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/focus-b", title: "Focus B", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
			]);
			const doc = await page(agent, "/queue?q=focus");
			const action = cardStatusAction(doc, "https://example.com/focus-a");
			expect(discoveryParamsOf(action)).toEqual([["q", "focus"]]);

			const response = await agent.post(action).type("form").send({ status: "read" });

			expect(response.status).toBe(303);
			expect(discoveryParamsOf(response.headers.location)).toEqual([["q", "focus"]]);
			const landed = await page(agent, response.headers.location);
			expect(listedUrls(landed)).toEqual(["https://example.com/focus-b"]);
			expect(discoveryParamsOf(toastUndoAction(landed))).toEqual([["q", "focus"]]);
		});

		it("removes only the card while matching rows remain, with the toast's Undo keeping the search", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/focus-a", title: "Focus A", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/focus-b", title: "Focus B", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
			]);
			const id = articleIdOf(await page(agent, "/queue?q=focus"), "https://example.com/focus-a");

			const response = await agent
				.post(`/queue/${id}/status?swap=card&q=focus`)
				.set("HX-Request", "true")
				.type("form")
				.send({ status: "read" });

			expect(response.status).toBe(200);
			expect(response.headers["hx-retarget"]).toBeUndefined();
			expect(discoveryParamsOf(toastUndoAction(parse(response.text)))).toEqual([["q", "focus"]]);
		});

		it("re-renders the listing as no matches once the last matching row leaves, while the tab still holds rows", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/focus", title: "Focus", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/budget", title: "Budget", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
			]);
			const id = articleIdOf(await page(agent, "/queue?q=focus"), "https://example.com/focus");

			const response = await agent
				.post(`/queue/${id}/status?swap=card&q=focus`)
				.set("HX-Request", "true")
				.type("form")
				.send({ status: "read" });

			expect(response.headers["hx-retarget"]).toBe("main");
			const doc = parse(response.text);
			expect(element(doc, "[data-test-empty-title]").textContent).toBe("No matching articles");
			expect(element(doc, "[data-test-discovery]").classList.contains("readlist-discovery--visible")).toBe(true);
		});

		it("keeps the search on a card's delete, through its dialog or its no-popover form, and on the delete's redirect", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/focus-a", title: "Focus A", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/focus-b", title: "Focus B", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
			]);
			const doc = await page(agent, "/queue?q=focus");
			const id = articleIdOf(doc, "https://example.com/focus-a");
			const dialogAction = formActionOf(
				element(doc, `[data-test-confirm-popover="delete"][data-test-confirm-subject="${id}"] [data-test-action="delete-confirm"]`),
			);
			const fallbackAction = formActionOf(
				cardOf(doc, "https://example.com/focus-a").querySelector('[data-test-action="delete-fallback"]'),
			);
			expect([discoveryParamsOf(dialogAction), discoveryParamsOf(fallbackAction)]).toEqual([
				[["q", "focus"]],
				[["q", "focus"]],
			]);

			const response = await agent.post(dialogAction).type("form").send({});

			expect([response.status, response.headers.location]).toEqual([303, "/queue?q=focus"]);
			expect(await listedOn(agent, response.headers.location)).toEqual(["https://example.com/focus-b"]);
		});

		it("keeps the search on a move's redirect and on the move toast's Undo", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			await seed(harness, { url: "https://example.com/budget", title: "Budget basics" });
			const id = articleIdOf(await page(agent, "/queue?q=budget"), "https://example.com/budget");

			const response = await agent
				.post(`/queue/${id}/move?q=budget`)
				.type("form")
				.send({ from: "default", to: finance });

			expect(response.status).toBe(303);
			expect(discoveryParamsOf(response.headers.location)).toEqual([["q", "budget"]]);
			expect(discoveryParamsOf(toastUndoAction(await page(agent, response.headers.location)))).toEqual([
				["q", "budget"],
			]);
		});

		it("drops the search when a readlist is renamed or deleted", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const work = await createReadlist(agent, "Work");

			const renamed = await agent
				.post(`/queue/queues/${work}/rename?queue=${work}&q=focus`)
				.type("form")
				.send({ label: "Day job" });
			const deleted = await agent.post(`/queue/queues/${work}/delete?queue=${work}&q=focus`).type("form").send({});

			expect([renamed.status, renamed.headers.location]).toEqual([303, `/queue?queue=${work}`]);
			expect([deleted.status, deleted.headers.location]).toEqual([303, "/queue"]);
		});

		it("lands a save from a narrowed listing on the whole listing", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/queue/save?q=focus&time=5-10")
				.type("form")
				.send({ url: "https://example.com/new-save" });

			expect([response.status, response.headers.location]).toEqual([303, "/queue#latest-saved"]);
		});

		it("keeps the search when the setup guide is dismissed or its email step is done", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);

			const dismissed = await agent.post("/queue/dismiss-onboarding?q=focus&time=5-10");
			const done = await agent.post("/queue/onboarding/email/done?q=focus&time=5-10");

			expect([dismissed.status, dismissed.headers.location]).toEqual([303, "/queue?q=focus&time=5-10"]);
			expect([done.status, done.headers.location]).toEqual([303, "/queue?q=focus&time=5-10"]);
		});

		it("keeps the search when the Gmail step is dismissed", async () => {
			const harness = useApp(fixtureWithGmail());
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/queue/onboarding/gmail/dismiss?q=focus&saved=week");

			expect([response.status, response.headers.location]).toEqual([303, "/queue?q=focus&saved=week"]);
		});

		it("keeps the search on the rail's new-readlist dialog and on its no-popover form", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = await page(agent, "/queue?q=focus&time=5-10");

			const dialog = element(doc, '[data-test-form="readlist-create"]');
			const fallback = element(doc, '[data-test-form="readlist-create-fallback"]');
			const tagged = "/queue/queues?q=focus&time=5-10&utm_source=queue-nav&utm_medium=internal&utm_content=new-readlist";
			expect([dialog.getAttribute("action"), dialog.getAttribute("hx-post"), fallback.getAttribute("action")]).toEqual([
				tagged,
				tagged,
				tagged,
			]);
		});

		it("keeps the search when the readlist cap refuses a new readlist, and drops it on a new one", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const created = await agent.post("/queue/queues?q=focus").type("form").send({ label: "Weekend" });
			for (let index = 2; index <= READLIST_MAX_PER_USER; index += 1) {
				await createReadlist(agent, `Readlist ${index}`);
			}

			const refused = await agent.post("/queue/queues?q=focus").type("form").send({ label: "One too many" });

			expect([created.status, [...params(created.headers.location).keys()]]).toEqual([303, ["queue"]]);
			expect([refused.status, refused.headers.location]).toEqual([303, "/queue?q=focus&queue_error=limit"]);
		});
	});

	describe("the search row and the filter drawer", () => {
		it("shows the row over a tab that holds rows, and keeps it over no matches", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seed(harness, { url: "https://example.com/focus", title: "Focus" });

			for (const path of ["/queue", "/queue?q=no-such-words-anywhere"]) {
				const row = element(await page(agent, path), "[data-test-discovery]");
				expect(row.classList.contains("readlist-discovery--visible")).toBe(true);
			}
		});

		it("hides the row whenever the open tab holds nothing, whatever the search", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const work = await createReadlist(agent, "Work");
			const emptyStates = [];
			for (const path of ["/queue", "/queue?q=focus", `/queue?queue=${work}&q=focus`]) {
				const doc = await page(agent, path);
				expect(element(doc, "[data-test-discovery]").classList.contains("readlist-discovery--hidden")).toBe(true);
				emptyStates.push(element(doc, "[data-test-empty-title]").textContent);
			}
			await seed(harness, { url: "https://example.com/focus", title: "Focus" });
			const readTab = await page(agent, "/queue?tab=done&q=focus");
			expect(element(readTab, "[data-test-discovery]").classList.contains("readlist-discovery--hidden")).toBe(true);
			emptyStates.push(element(readTab, "[data-test-empty-title]").textContent);

			expect(emptyStates).toEqual([
				"Nothing saved yet",
				"Nothing saved yet",
				"No articles in this readlist yet",
				"No finished articles yet",
			]);
		});

		it("says nothing matches and offers one action back to the whole tab", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seed(harness, { url: "https://example.com/focus", title: "Focus" });

			const doc = await page(agent, "/queue?q=no-such-words-anywhere&time=5-10");

			expect(element(doc, "[data-test-empty-title]").textContent).toBe("No matching articles");
			expect(element(doc, ".readlist-empty__text").textContent).toBe(
				"Nothing in To Read matches your search and filters.",
			);
			const action = element(doc, '[data-test-empty-action="clear-discovery"]');
			expect([action.textContent, action.getAttribute("href")]).toEqual([
				"Clear search and filters",
				"/queue?utm_source=queue-empty&utm_medium=internal&utm_content=clear-discovery",
			]);
		});

		it("reflects the URL in both copies of the drawer", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const work = await createReadlist(agent, "Work");
			await seed(harness, { url: "https://example.com/focus", title: "Focus", readlist: work });
			await agent.post(`/queue/${articleIdOf(await page(agent, `/queue?queue=${work}`), "https://example.com/focus")}/status?queue=${work}`).type("form").send({ status: "read" });

			const doc = await page(agent, `/queue?queue=${work}&tab=done&order=asc&q=focus&time=5-10&saved=month&topic=others`);

			for (const scope of ["popover", "fallback"]) {
				expect(checkedOptions(doc, scope)).toEqual(["time:5-10", "saved:month", "topic:others"]);
				expect(hiddenFields(element(doc, `[data-test-discovery-form="${scope}"]`))).toEqual([
					["queue", work],
					["tab", "done"],
					["order", "asc"],
					["q", "focus"],
					["utm_source", "queue-filter-drawer"],
					["utm_medium", "internal"],
					["utm_content", "apply"],
				]);
				const clearAll = element(doc, `[data-test-discovery-form="${scope}"] [data-test-action="clear-discovery-filters"]`);
				expect(discoveryParamsOf(clearAll.getAttribute("href"))).toEqual([["q", "focus"]]);
			}
			const closes = Array.from(doc.querySelectorAll('[data-test-action="close-discovery-filters"]'), (close) =>
				close.closest("[data-test-discovery-form]")?.getAttribute("data-test-discovery-form"),
			);
			expect(closes).toEqual(["popover"]);
		});

		it("still offers a topic that only the rows a ticked topic excludes carry", async () => {
			const summary = createFakeSummaryProvider();
			const harness = useApp(pinnedFixture(summary));
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/focus", title: "Quiet mornings", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/lifestyle", title: "Slow weekends", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
			]);
			readyWithTopics(summary, "https://example.com/focus", toArticleTopics(["Focus"]));
			readyWithTopics(summary, "https://example.com/lifestyle", toArticleTopics(["Lifestyle"]));

			const doc = await page(agent, "/queue?topic=Focus");

			expect(listedUrls(doc)).toEqual(["https://example.com/focus"]);
			expect(offeredOptions(doc, "popover", "topic")).toEqual(["topic:Focus", "topic:Lifestyle", "topic:others"]);
		});

		it("offers the topics of the page's rows while nothing narrows the list", async () => {
			const summary = createFakeSummaryProvider();
			const harness = useApp(pinnedFixture(summary));
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/focus", title: "Quiet mornings", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/focus-trends", title: "New habits", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
			]);
			readyWithTopics(summary, "https://example.com/focus", toArticleTopics(["Focus"]));
			readyWithTopics(summary, "https://example.com/focus-trends", toArticleTopics(["Trends", "Focus"]));

			const doc = await page(agent, "/queue");

			expect(offeredOptions(doc, "popover", "topic")).toEqual(["topic:Focus", "topic:Trends", "topic:others"]);
		});

		it("carries the preferences flag through both forms and both clear links on a custom readlist", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const work = await createReadlist(agent, "Work");
			await seed(harness, { url: "https://example.com/focus", title: "Focus", readlist: work });

			const flagged = await page(agent, `/queue?queue=${work}&q=no-such-words-anywhere&feature=pref`);
			const plain = await page(agent, `/queue?queue=${work}&q=no-such-words-anywhere`);

			const featureOf = (doc: Document) => [
				hiddenFields(element(doc, '[data-test-form="readlist-search"]')).find(([name]) => name === "feature")?.[1] ?? null,
				hiddenFields(element(doc, '[data-test-discovery-form="popover"]')).find(([name]) => name === "feature")?.[1] ?? null,
				params(element(doc, '[data-test-discovery-form="popover"] [data-test-action="clear-discovery-filters"]').getAttribute("href")).get("feature"),
				params(element(doc, '[data-test-empty-action="clear-discovery"]').getAttribute("href")).get("feature"),
			];
			expect(featureOf(flagged)).toEqual(["pref", "pref", "pref", "pref"]);
			expect(featureOf(plain)).toEqual([null, null, null, null]);
		});

		it("still offers the search row and the drawer to a read-only reader", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seed(harness, { url: "https://example.com/focus", title: "Focus" });
			await makeReadOnly(harness);

			const doc = await page(agent, "/queue?q=focus");

			expect(element(doc, "[data-test-discovery]").classList.contains("readlist-discovery--visible")).toBe(true);
			expect(element(doc, "[data-test-discovery-drawer]").getAttribute("popover")).toBe("auto");
			expect(listedUrls(doc)).toEqual(["https://example.com/focus"]);
		});
	});
});
