import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import { READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture, createFakeSummaryProvider } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { JSDOM } from "jsdom";
import request from "supertest";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken, saveAccessTokenForClient, saveAccessTokenForUser } from "../../test-helpers/oauth-token";
import { loginAgent, useTestServer } from "../../../test-app";
import { initInMemoryBulkSelections } from "../../../bulk-articles/selection-store";

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
	imported?: boolean;
}

function pinnedFixture(summary: SummaryProvider = createFakeSummaryProvider({ findItemOwner: async () => undefined })) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	return { ...fixture, summary, shared: { ...fixture.shared, now: () => NOW } };
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
		provenance: article.imported ? { kind: "import" as const } : { kind: "web" as const },
		savedAt: article.savedAt ?? new Date(NOW.getTime() - HOUR),
		saveTrigger: "manual" as const,
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

async function createReadlist(agent: TestAgent, label: string): Promise<string> {
	const response = await agent.post("/queue/queues").type("form").send({ label });
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function makeFreePlan(harness: TestHarness): Promise<void> {
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
	return [...params(href)].filter(([name]) => ["q", "time", "saved"].includes(name));
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

function searchSubmission(doc: Document, q: string): string {
	const query = new URLSearchParams(
		hiddenFields(element(doc, '[data-test-form="readlist-search"]')).map(([name, value]) => [name ?? "", value ?? ""]),
	);
	query.append("q", q);
	return `/queue?${query}`;
}

function actionOf(form: Element): string {
	const action = form.getAttribute("action");
	assert(action, "the form must name where it submits");
	return action;
}

async function applyFilters(agent: TestAgent, doc: Document, tick: string[]): Promise<string> {
	const form = element(doc, '[data-test-discovery-form="popover"]');
	expect(form.getAttribute("method")).toBe("POST");
	const body = new URLSearchParams(tick.map((option) => option.split(":")).map(([name, value]) => [name, value]));
	const response = await agent.post(actionOf(form)).type("form").send(body.toString());
	expect(response.status).toBe(303);
	return response.headers.location;
}

async function clearAllFilters(agent: TestAgent, doc: Document): Promise<string> {
	const clearAll = element(doc, '[data-test-discovery-form="popover"] [data-test-action="clear-discovery-filters"]');
	const response = await agent.post(actionOf(element(doc, `form[id="${clearAll.getAttribute("form")}"]`))).type("form").send("");
	expect(response.status).toBe(303);
	return response.headers.location;
}

function filterButton(doc: Document): [string | null, boolean] {
	const button = element(doc, '[data-test-action="open-discovery-filters"]');
	return [button.textContent, button.classList.contains("readlist-discovery__filter--active")];
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

		it("searches the title, never the generated summary, and ignores a topic filter carried by an old link", async () => {
			const summary = createFakeSummaryProvider({ findItemOwner: async () => undefined });
			const harness = useApp(pinnedFixture(summary));
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/finance", title: "Personal finance basics", savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/spending", title: "Spending plans", savedAt: new Date(NOW.getTime() - 2 * HOUR) },
			]);
			summary.markSummaryReady({
				url: "https://example.com/spending",
				summary: "A finance guide to monthly budgets.",
				excerpt: "Plan your finance month by month.",
			});

			expect(await listedOn(agent, "/queue?q=finance")).toEqual(["https://example.com/finance"]);
			expect(await listedOn(agent, "/queue?topic=Focus&topic=others")).toEqual([
				"https://example.com/finance",
				"https://example.com/spending",
			]);
		});

		it("round-trips what Apply submits, keeping the search and dropping the page", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [
				{ url: "https://example.com/short", title: "Focus short", minutes: 3, savedAt: new Date(NOW.getTime() - HOUR) },
				{ url: "https://example.com/medium", title: "Focus medium", minutes: 8, savedAt: new Date(NOW.getTime() - 2 * HOUR) },
				{ url: "https://example.com/other", title: "Budget medium", minutes: 8, savedAt: new Date(NOW.getTime() - 3 * HOUR) },
			]);

			const landed = await applyFilters(agent, await page(agent, "/queue?q=focus&saved=month"), ["time:5-10"]);

			expect(landed).toBe("/queue?q=focus&time=5-10");
			expect(await listedOn(agent, landed)).toEqual(["https://example.com/medium"]);
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
				"queue",
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
			expect([deleted.status, deleted.headers.location]).toEqual([303, "/queue?queue=default"]);
		});

		it("lands a save from a narrowed listing on the whole listing", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/queue/save?q=focus&time=5-10")
				.type("form")
				.send({ url: "https://example.com/new-save" });

			expect([response.status, response.headers.location]).toEqual([303, "/queue?queue=default#latest-saved"]);
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
				"Nothing in To Read matches your search and filters: 5–10 min. Your filters stay on as you browse until you clear them.",
			);
			const action = element(doc, '[data-test-empty-action="clear-discovery"]');
			const form = element(doc, ".readlist-empty__cta");
			expect([action.textContent, form.getAttribute("method"), form.getAttribute("action")]).toEqual([
				"Clear search and filters",
				"POST",
				"/queue/filters?utm_source=queue-empty&utm_medium=internal&utm_content=clear-discovery",
			]);
			const cleared = await agent.post(actionOf(form)).type("form").send("");
			expect([cleared.status, cleared.headers.location]).toEqual([303, "/queue?queue=default"]);
			expect(await listedOn(agent, "/queue")).toEqual(["https://example.com/focus"]);
		});

		it("reflects the URL in both copies of the drawer", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const work = await createReadlist(agent, "Work");
			await seed(harness, { url: "https://example.com/focus", title: "Focus", readlist: work });
			await agent.post(`/queue/${articleIdOf(await page(agent, `/queue?queue=${work}`), "https://example.com/focus")}/status?queue=${work}`).type("form").send({ status: "read" });

			const doc = await page(agent, `/queue?queue=${work}&tab=done&order=asc&q=focus&time=5-10&saved=month`);

			for (const scope of ["popover", "fallback"]) {
				expect(checkedOptions(doc, scope)).toEqual(["time:5-10", "saved:month"]);
				expect([...params(actionOf(element(doc, `[data-test-discovery-form="${scope}"]`)))]).toEqual([
					["queue", work],
					["tab", "done"],
					["order", "asc"],
					["q", "focus"],
					["utm_source", "queue-filter-drawer"],
					["utm_medium", "internal"],
					["utm_content", "apply"],
				]);
				const clearAll = element(doc, `[data-test-discovery-form="${scope}"] [data-test-action="clear-discovery-filters"]`);
				expect(discoveryParamsOf(actionOf(element(doc, `form[id="${clearAll.getAttribute("form")}"]`)))).toEqual([["q", "focus"]]);
			}
			const closes = Array.from(doc.querySelectorAll('[data-test-action="close-discovery-filters"]'), (close) =>
				close.closest("[data-test-discovery-form]")?.getAttribute("data-test-discovery-form"),
			);
			expect(closes).toEqual(["popover"]);
		});

		it("still offers the search row and the drawer to a free-plan reader", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seed(harness, { url: "https://example.com/focus", title: "Focus" });
			await makeFreePlan(harness);

			const doc = await page(agent, "/queue?q=focus");

			expect(element(doc, "[data-test-discovery]").classList.contains("readlist-discovery--visible")).toBe(true);
			expect(element(doc, "[data-test-discovery-drawer]").getAttribute("popover")).toBe("auto");
			expect(listedUrls(doc)).toEqual(["https://example.com/focus"]);
		});
	});

	describe("the remembered filter", () => {
		const SHORT = { url: "https://example.com/short", title: "Short", minutes: 3 };
		const MEDIUM = { url: "https://example.com/medium", title: "Medium", minutes: 8, savedAt: new Date(NOW.getTime() - 2 * HOUR) };

		it("keeps the applied filter on a bare readlist link and across a reload", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);

			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);
			const first = await page(agent, "/queue");
			const reloaded = await page(agent, "/queue");

			for (const doc of [first, reloaded]) {
				expect(listedUrls(doc)).toEqual([MEDIUM.url]);
				expect(filterButton(doc)).toEqual(["Filters (1)", true]);
				expect(checkedOptions(doc, "popover")).toEqual(["time:5-10"]);
			}
		});

		it("carries the remembered filter onto the page's own links", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);

			const doc = await page(agent, "/queue");

			expect(discoveryParamsOf(element(doc, "[data-test-sort]").getAttribute("href"))).toEqual([["time", "5-10"]]);
		});

		it("keeps the filter when the reader moves to another readlist and to the Read tab", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			const work = await createReadlist(agent, "Work");
			await seedAll(harness, [
				{ ...SHORT, readlist: work },
				{ ...MEDIUM, readlist: work },
			]);
			await applyFilters(agent, await page(agent, `/queue?queue=${work}`), ["time:5-10"]);

			const custom = await page(agent, `/queue?queue=${work}`);
			const readTab = await page(agent, "/queue?tab=done");

			expect(listedUrls(custom)).toEqual([MEDIUM.url]);
			expect(filterButton(custom)).toEqual(["Filters (1)", true]);
			expect(filterButton(readTab)).toEqual(["Filters (1)", true]);
		});

		it("keeps the remembered filter beside a new search, without remembering the search", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue?q=medium"), ["time:5-10"]);

			const searched = await page(agent, "/queue?q=short");
			const bare = await page(agent, "/queue");

			expect(element(searched, "[data-test-empty-title]").textContent).toBe("No matching articles");
			expect(element(bare, "[data-test-discovery-search]").getAttribute("value")).toBe("");
			expect(listedUrls(bare)).toEqual([MEDIUM.url]);
		});

		it("lets a link that names its own filters win for that page, without replacing the remembered filter", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);

			const linked = await listedOn(agent, "/queue?time=under-5");
			const bare = await listedOn(agent, "/queue");

			expect(linked).toEqual([SHORT.url]);
			expect(bare).toEqual([MEDIUM.url]);
		});

		it("forgets the filter on Clear all, keeping the search and the place", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);

			const landed = await clearAllFilters(agent, await page(agent, "/queue?tab=done&order=asc&q=medium"));
			const bare = await page(agent, "/queue");

			expect(landed).toBe("/queue?tab=done&order=asc&q=medium");
			expect(listedUrls(bare)).toEqual([SHORT.url, MEDIUM.url]);
			expect(filterButton(bare)).toEqual(["Filters", false]);
		});

		it("forgets the filter when a form posts no body at all", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);

			const response = await agent.post("/queue/filters");

			expect([response.status, response.headers.location]).toEqual([303, "/queue?queue=default"]);
			expect(await listedOn(agent, "/queue")).toEqual([SHORT.url, MEDIUM.url]);
		});

		it("drops the filter when the reader logs out and back in", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);

			await agent.post("/logout");
			await agent.post("/login").type("form").send({ email: "test@example.com", password: "password123" });
			const doc = await page(agent, "/queue");

			expect(listedUrls(doc)).toEqual([SHORT.url, MEDIUM.url]);
			expect(filterButton(doc)).toEqual(["Filters", false]);
		});

		it("keeps the filter to the session that applied it, so a second login starts unfiltered", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);

			const otherDevice = await loginAgent(harness.server, harness.auth);

			expect(await listedOn(otherDevice, "/queue")).toEqual([SHORT.url, MEDIUM.url]);
			expect(await listedOn(agent, "/queue")).toEqual([MEDIUM.url]);
		});

		it("forgets the filter when the reader saves a link, so the new card lands in view", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/new-save" });
			const doc = await page(agent, "/queue");

			expect(filterButton(doc)).toEqual(["Filters", false]);
			expect(checkedOptions(doc, "popover")).toEqual([]);
		});

		it("keeps the filter when the Add link refuses the link", async () => {
			const harness = useApp(pinnedFixture());
			const agent = await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			await applyFilters(agent, await page(agent, "/queue"), ["time:5-10"]);

			const refused = await agent.post("/queue/save").set("HX-Request", "true").type("form").send({ url: "not a link" });
			const doc = await page(agent, "/queue");

			expect(refused.status).toBe(422);
			expect(listedUrls(doc)).toEqual([MEDIUM.url]);
			expect(filterButton(doc)).toEqual(["Filters (1)", true]);
		});

		it("lists every article to a Siren client whatever search and filters the link names", async () => {
			const harness = useApp(pinnedFixture());
			await loginAgent(harness.server, harness.auth);
			await seedAll(harness, [SHORT, MEDIUM]);
			const token = await saveAccessTokenForUser(harness, await readerId(harness));

			const response = await request(harness.server)
				.get("/queue?q=short&time=5-10&saved=week")
				.set("Authorization", `Bearer ${token}`)
				.set("Accept", SIREN_MEDIA_TYPE);

			expect(response.status).toBe(200);
			expect(
				response.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url).sort(),
			).toEqual([MEDIUM.url, SHORT.url]);
		});

		it("answers a client with no session by landing it on the filtered link, remembering nothing", async () => {
			const harness = useApp(pinnedFixture());
			const token = await createAccessToken(harness);

			const response = await request(harness.server)
				.post("/queue/filters?tab=done")
				.set("Authorization", `Bearer ${token}`)
				.set("Accept", SIREN_MEDIA_TYPE)
				.type("form")
				.send("time=5-10&saved=week");

			expect([response.status, response.headers.location]).toEqual([303, "/queue?tab=done&time=5-10&saved=week"]);
		});
	});
});

interface FindArticlesOption {
	value: string;
	title: string;
	selected: boolean;
}

interface FindArticlesField {
	name: string;
	type: string;
	title?: string;
	value?: string;
	options?: FindArticlesOption[];
}

interface SirenAction {
	name: string;
	href: string;
	method: string;
	title?: string;
	fields?: FindArticlesField[];
}

interface TitledHref {
	title: string;
	href: string;
}

interface SirenListing {
	entities: { properties: { url: string } }[];
	links: { rel: string[]; href: string }[];
	actions: SirenAction[];
	properties: {
		total?: { label: string };
		tabs: { label: string; rel: string[]; href: string }[];
		sort?: { order: string; rel: string[]; href: string }[];
		readlists: { label: string; href: string }[];
		findArticles?: { clear: TitledHref; clearSearch?: TitledHref; clearFilters?: TitledHref; noMatches?: { title: string } };
	};
}

describe("find-articles (Siren search and filters for the apps)", () => {
	async function appToken(harness: TestHarness): Promise<string> {
		return saveAccessTokenForClient(harness, { userId: await readerId(harness), clientId: "ios-app" });
	}

	async function sirenAt(harness: TestHarness, token: string, href: string): Promise<SirenListing> {
		const response = await request(harness.server)
			.get(href)
			.set("Authorization", `Bearer ${token}`)
			.set("Accept", SIREN_MEDIA_TYPE);
		expect(response.status).toBe(200);
		return response.body;
	}

	function findArticlesOf(listing: SirenListing): SirenAction {
		const action = listing.actions.find((candidate) => candidate.name === "find-articles");
		assert(action, "the listing must advertise find-articles");
		return action;
	}

	function fieldOf(action: SirenAction, name: string): FindArticlesField {
		const field = action.fields?.find((candidate) => candidate.name === name);
		assert(field, `find-articles must declare ${name}`);
		return field;
	}

	function submit(action: SirenAction, input: { q?: string; time?: string[]; saved?: string[] }): string {
		expect(action.method).toBe("GET");
		const query = new URLSearchParams();
		for (const field of action.fields ?? []) {
			if (field.type === "hidden" && field.value !== undefined) query.append(field.name, field.value);
		}
		if (input.q !== undefined) query.append("q", input.q);
		for (const value of input.time ?? []) query.append("time", value);
		for (const value of input.saved ?? []) query.append("saved", value);
		return `${new URL(action.href, TEST_APP_ORIGIN).pathname}?${query}`;
	}

	async function find(
		harness: TestHarness,
		token: string,
		input: { q?: string; time?: string[]; saved?: string[] },
	): Promise<SirenListing> {
		const entry = await sirenAt(harness, token, "/queue");
		return sirenAt(harness, token, submit(findArticlesOf(entry), input));
	}

	function urlsOf(listing: SirenListing): string[] {
		return listing.entities.map((entity) => entity.properties.url);
	}

	function linkOf(listing: SirenListing, rel: string): string | undefined {
		return listing.links.find((link) => link.rel.includes(rel))?.href;
	}

	function criteriaOf(href: string | undefined): [string, string][] {
		return [...params(href ?? null)].filter(([name]) => ["find", "q", "time", "saved"].includes(name));
	}

	const RUST_OLD: SeededArticle = { url: "https://blog.example.net/rust-ownership", title: "Rust ownership explained", minutes: 7, savedAt: new Date(NOW.getTime() - 40 * DAY) };
	const RUST_NEW: SeededArticle = { url: "https://rust-lang.org/news", title: "This week in Rust", siteName: "Rust Lang", minutes: 3, savedAt: new Date(NOW.getTime() - 2 * DAY) };
	const QUICK: SeededArticle = { url: "https://example.com/quick", title: "Quick read", minutes: 3, savedAt: new Date(NOW.getTime() - 2 * HOUR) };
	const MID: SeededArticle = { url: "https://example.com/mid", title: "Mid read", minutes: 7, savedAt: new Date(NOW.getTime() - 3 * DAY) };
	const LONG: SeededArticle = { url: "https://example.com/long", title: "Long read", minutes: 15, savedAt: new Date(NOW.getTime() - 3 * DAY) };
	const UNTIMED: SeededArticle = { url: "https://example.com/untimed", title: "Untimed read", savedAt: new Date(NOW.getTime() - 4 * DAY) };

	it("advertises a title-less action whose fields carry their labels, choices and the listing's place", async () => {
		const harness = useApp(pinnedFixture());
		await loginAgent(harness.server, harness.auth);
		const token = await appToken(harness);

		const action = findArticlesOf(await sirenAt(harness, token, "/queue?status=read&order=asc"));

		expect(action.title).toBeUndefined();
		expect(action.fields?.filter((field) => field.type === "hidden").map((field) => [field.name, field.value])).toEqual([
			["find", "articles"],
			["status", "read"],
			["order", "asc"],
		]);
		expect([fieldOf(action, "q").type, fieldOf(action, "q").title]).toEqual(["search", "Search articles or sources"]);
		expect(fieldOf(action, "time").title).toBe("Reading time");
		expect(fieldOf(action, "time").options?.map((option) => [option.value, option.title, option.selected])).toEqual([
			["under-5", "Under 5 min", false],
			["5-10", "5–10 min", false],
			["10-20", "10–20 min", false],
			["20-plus", "20+ min", false],
		]);
		expect(fieldOf(action, "saved").title).toBe("Saved date");
		expect(fieldOf(action, "saved").options?.map((option) => option.value)).toEqual(["today", "week", "month", "older"]);
	});

	it("finds matches the first unfiltered page does not hold, counted over the whole readlist", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		const newer: SeededArticle[] = [];
		for (let index = 0; index < 22; index += 1) {
			newer.push({ url: `https://example.com/filler-${index}`, title: `Filler ${index}`, savedAt: new Date(NOW.getTime() - (index + 1) * HOUR) });
		}
		await seedAll(harness, [...newer, RUST_NEW, RUST_OLD]);
		const token = await appToken(harness);

		const unfiltered = await sirenAt(harness, token, "/queue");
		const found = await find(harness, token, { q: "RUST" });

		expect(urlsOf(unfiltered)).not.toContain(RUST_NEW.url);
		expect(urlsOf(found)).toEqual([RUST_NEW.url, RUST_OLD.url]);
		expect(urlsOf(found)).toEqual(await listedOn(agent, "/queue?q=RUST"));
		expect(found.properties.total?.label).toBe(unfiltered.properties.total?.label.replace(/^\d+/, "2"));
		expect(fieldOf(findArticlesOf(found), "q").value).toBe("RUST");
	});

	it("narrows by reading time and saved date: any choice within a group, every group at once", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await seedAll(harness, [QUICK, MID, LONG, UNTIMED, RUST_OLD]);
		const token = await appToken(harness);

		const found = await find(harness, token, { time: ["under-5", "5-10"], saved: ["week"] });

		expect(urlsOf(found)).toEqual([QUICK.url, MID.url]);
		expect(urlsOf(found)).toEqual(await listedOn(agent, "/queue?time=under-5&time=5-10&saved=week"));
		const action = findArticlesOf(found);
		expect(fieldOf(action, "time").options?.filter((option) => option.selected).map((option) => option.value)).toEqual(["under-5", "5-10"]);
		expect(fieldOf(action, "saved").options?.filter((option) => option.selected).map((option) => option.value)).toEqual(["week"]);
	});

	it("pages through every match on next links that keep the search", async () => {
		const harness = useApp(pinnedFixture());
		await loginAgent(harness.server, harness.auth);
		const articles: SeededArticle[] = [];
		for (let index = 0; index < 23; index += 1) {
			articles.push({ url: `https://example.com/match-${index}`, title: `Match ${index}`, savedAt: new Date(NOW.getTime() - (index + 1) * HOUR) });
		}
		articles.push({ url: "https://example.com/other", title: "Other", savedAt: new Date(NOW.getTime() - 2 * HOUR) });
		await seedAll(harness, articles);
		const token = await appToken(harness);

		const first = await find(harness, token, { q: "match" });
		const next = linkOf(first, "next");
		const second = await sirenAt(harness, token, next ?? "");

		expect(urlsOf(first)).toHaveLength(20);
		expect(criteriaOf(next)).toEqual([["find", "articles"], ["q", "match"]]);
		expect(urlsOf(second)).toEqual(["https://example.com/match-20", "https://example.com/match-21", "https://example.com/match-22"]);
		expect(linkOf(second, "next")).toBeUndefined();
		expect(criteriaOf(linkOf(second, "self"))).toEqual([["find", "articles"], ["q", "match"]]);
	});

	it("keeps the search and filters on tab and sort links, and only the filters on readlist links", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent, "Later");
		await seedAll(harness, [QUICK, MID]);
		const token = await appToken(harness);

		const found = await find(harness, token, { q: "read", time: ["under-5"] });

		for (const tab of found.properties.tabs) {
			expect(criteriaOf(tab.href)).toEqual([["find", "articles"], ["q", "read"], ["time", "under-5"]]);
		}
		for (const sort of found.properties.sort ?? []) {
			expect(criteriaOf(sort.href)).toEqual([["find", "articles"], ["q", "read"], ["time", "under-5"]]);
		}
		expect(found.properties.readlists.map((readlist) => criteriaOf(readlist.href))).toEqual([
			[["find", "articles"], ["time", "under-5"]],
			[["find", "articles"], ["time", "under-5"]],
		]);
		const ascending = found.properties.sort?.find((sort) => sort.order === "asc");
		expect(urlsOf(await sirenAt(harness, token, ascending?.href ?? ""))).toEqual([QUICK.url]);
	});

	it("searches only the named readlist it was advertised on", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent, "Systems");
		await seedAll(harness, [RUST_NEW, { ...RUST_OLD, readlist: slug }, { ...QUICK, readlist: slug }]);
		const token = await appToken(harness);

		const entry = await sirenAt(harness, token, "/queue");
		const named = entry.properties.readlists.find((readlist) => readlist.label === "Systems");
		const action = findArticlesOf(await sirenAt(harness, token, named?.href ?? ""));
		const found = await sirenAt(harness, token, submit(action, { q: "rust" }));

		expect(urlsOf(found)).toEqual([RUST_OLD.url]);
		expect(urlsOf(found)).toEqual(await listedOn(agent, `/queue?queue=${slug}&q=rust`));
	});

	it("searches only Hand Picked when it was advertised on Hand Picked", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await seedAll(harness, [RUST_NEW, RUST_OLD]);
		const picked = articleIdOf(await page(agent, "/queue"), RUST_NEW.url);
		await agent.post(`/queue/${picked}/move`).type("form").send({ from: "default", to: "~hand-picked" }).expect(303);
		const token = await appToken(harness);

		const action = findArticlesOf(await sirenAt(harness, token, "/queue?scope=hand-picked"));
		const found = await sirenAt(harness, token, submit(action, { q: "rust" }));

		expect(urlsOf(found)).toEqual([RUST_NEW.url]);
		expect(urlsOf(found)).toEqual(await listedOn(agent, "/queue?scope=hand-picked&q=rust"));
		expect(params(linkOf(found, "self") ?? null).get("scope")).toBe("hand-picked");
	});

	it("tells a tab with no match from an empty tab, and offers the clears that apply", async () => {
		const harness = useApp(pinnedFixture());
		await loginAgent(harness.server, harness.auth);
		await seedAll(harness, [QUICK, MID]);
		const token = await appToken(harness);

		const unread = await find(harness, token, { q: "nothing-like-this", time: ["under-5"] });
		const read = await sirenAt(harness, token, unread.properties.tabs.find((tab) => tab.label === "Read")?.href ?? "");

		expect([urlsOf(unread), unread.properties.findArticles?.noMatches?.title]).toEqual([[], "No matching articles"]);
		expect(unread.properties.findArticles?.clear.title).toBe("Clear search and filters");
		expect(criteriaOf(unread.properties.findArticles?.clear.href)).toEqual([["find", "articles"]]);
		expect(criteriaOf(unread.properties.findArticles?.clearSearch?.href)).toEqual([["find", "articles"], ["time", "under-5"]]);
		expect(criteriaOf(unread.properties.findArticles?.clearFilters?.href)).toEqual([["find", "articles"], ["q", "nothing-like-this"]]);
		expect(urlsOf(await sirenAt(harness, token, unread.properties.findArticles?.clear.href ?? ""))).toEqual([QUICK.url, MID.url]);
		expect([urlsOf(read), read.properties.findArticles?.noMatches]).toEqual([[], undefined]);
	});

	it("keeps an exact-URL lookup out of find-articles even when the URL carries its marker", async () => {
		const harness = useApp(pinnedFixture());
		await loginAgent(harness.server, harness.auth);
		await seedAll(harness, [QUICK]);
		const token = await appToken(harness);

		const missed = await sirenAt(harness, token, `/queue?lookup=1&url=${encodeURIComponent(MID.url)}&find=articles&q=quick`);

		expect([urlsOf(missed), missed.properties.findArticles, criteriaOf(linkOf(missed, "self"))]).toEqual([[], undefined, []]);
	});

	it("leaves out the clear links when nothing is searched or filtered", async () => {
		const harness = useApp(pinnedFixture());
		await loginAgent(harness.server, harness.auth);
		await seedAll(harness, [QUICK]);
		const token = await appToken(harness);

		const found = await find(harness, token, {});

		expect([urlsOf(found), found.properties.findArticles]).toEqual([[QUICK.url], undefined]);
	});

	it("never finds another reader's article with the same title", async () => {
		const harness = useApp(pinnedFixture());
		await loginAgent(harness.server, harness.auth);
		await seedAll(harness, [QUICK]);
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("another-reader"),
			url: "https://example.com/someone-elses-quick",
			metadata: { title: QUICK.title, siteName: "example.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(3),
			provenance: { kind: "web" },
			savedAt: new Date(NOW.getTime() - HOUR),
			saveTrigger: "manual",
		});
		const token = await appToken(harness);

		expect(urlsOf(await find(harness, token, { q: "quick read" }))).toEqual([QUICK.url]);
	});
});

const useManagedApp = useTestServer({ bulkArticles: { store: initInMemoryBulkSelections(), dispatch: async () => {}, readEverywhere: false } });

describe("Readlist search scope under Manage articles", () => {
	const IMPORTED_ATLAS: SeededArticle = { url: "https://maps.example.org/atlas", title: "Atlas of rivers", imported: true };
	const SAVED_ATLAS: SeededArticle = { url: "https://notes.example.org/atlas", title: "Atlas of cities" };

	function label(doc: Document): string | null | undefined {
		return doc.querySelector('label[for="readlist-search-input"]')?.textContent;
	}

	function scopeDescription(doc: Document): string | null | undefined {
		return doc.querySelector("[data-test-discovery-scope]")?.textContent;
	}

	function emptyCopy(doc: Document): [string | null | undefined, string | null | undefined] {
		return [doc.querySelector("[data-test-empty-title]")?.textContent, doc.querySelector(".readlist-empty__text")?.textContent];
	}

	function sourceLink(doc: Document, name: string): string {
		const link = Array.from(doc.querySelectorAll(".readlist__source-menu a")).find((anchor) => anchor.textContent === name);
		const href = link?.getAttribute("href");
		assert(href, `the ${name} source link must render`);
		return href;
	}

	async function followEmptyAction(agent: TestAgent, doc: Document, key: string): Promise<Document> {
		const form = element(doc, `[data-test-empty-action="${key}"]`).closest("form");
		assert(form, "the empty-state action must be a form");
		const fields = new URLSearchParams(hiddenFields(form).map(([name, value]) => [name ?? "", value ?? ""]));
		if (form.getAttribute("method") === "GET") return page(agent, `${actionOf(form)}?${fields}`);
		const response = await agent.post(actionOf(form)).type("form").send(fields.toString());
		expect(response.status).toBe(303);
		return page(agent, response.headers.location);
	}

	it("labels the next submission as searching all sources and shows which source the current results come from", async () => {
		const harness = useManagedApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await seedAll(harness, [IMPORTED_ATLAS, SAVED_ATLAS]);

		const bulk = await page(agent, "/queue?source=bulk");
		expect([label(bulk), scopeDescription(bulk), element(bulk, "[data-test-discovery-search]").getAttribute("value")]).toEqual([
			"Submit to search all sources in this tab by title or site",
			undefined,
			"",
		]);

		const filled = await page(agent, "/queue?source=bulk&q=Atlas");
		const input = element(filled, "[data-test-discovery-search]");
		expect([label(filled), scopeDescription(filled), input.getAttribute("value"), input.getAttribute("aria-describedby")]).toEqual([
			"Submit to search all sources in this tab by title or site",
			"Results shown from Bulk import.",
			"Atlas",
			"readlist-search-scope",
		]);
		expect(listedUrls(filled)).toEqual([IMPORTED_ATLAS.url]);

		const resubmitted = await page(agent, searchSubmission(filled, "Atlas"));
		expect([label(resubmitted), scopeDescription(resubmitted), element(resubmitted, "[data-test-discovery-search]").getAttribute("value")]).toEqual([
			"Search this readlist tab by title or site",
			undefined,
			"Atlas",
		]);
		expect([...listedUrls(resubmitted)].sort()).toEqual([IMPORTED_ATLAS.url, SAVED_ATLAS.url].sort());
	});

	it("keeps the search usable on an empty source and clears back to all sources", async () => {
		const harness = useManagedApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(harness, SAVED_ATLAS);

		const searched = await page(agent, "/queue?q=Atlas");
		const bulkHref = new URL(sourceLink(searched, "Bulk import"), TEST_APP_ORIGIN);
		expect([bulkHref.searchParams.get("source"), bulkHref.searchParams.get("q")]).toEqual(["bulk", "Atlas"]);

		const empty = await page(agent, `${bulkHref.pathname}${bulkHref.search}`);
		expect(listedUrls(empty)).toEqual([]);
		expect(element(empty, "[data-test-discovery]").classList.contains("readlist-discovery--visible")).toBe(true);
		expect(scopeDescription(empty)).toBe("Results shown from Bulk import.");
		expect(emptyCopy(empty)).toEqual([
			"No matching articles",
			"Nothing from Bulk import in To Read matches your search. Clear search also returns to all sources.",
		]);
		expect(element(empty, '[data-test-empty-action="clear-discovery"]').textContent).toBe("Clear search");

		expect(listedUrls(await page(agent, searchSubmission(empty, "Atlas")))).toEqual([SAVED_ATLAS.url]);

		const cleared = await followEmptyAction(agent, empty, "clear-discovery");
		expect([element(cleared, "[data-test-discovery-search]").getAttribute("value"), label(cleared)]).toEqual([
			"",
			"Search this readlist tab by title or site",
		]);
		expect(listedUrls(cleared)).toEqual([SAVED_ATLAS.url]);
	});

	it("names the empty source and tab when nothing is searched, offering all sources", async () => {
		const harness = useManagedApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(harness, SAVED_ATLAS);

		const empty = await page(agent, "/queue?source=bulk");
		expect(element(empty, "[data-test-discovery]").classList.contains("readlist-discovery--visible")).toBe(true);
		expect(emptyCopy(empty)).toEqual(["No articles from Bulk import in To Read", "A search looks in all sources in this tab."]);
		expect(listedUrls(await followEmptyAction(agent, empty, "all-sources"))).toEqual([SAVED_ATLAS.url]);
	});

	it("shows the source search on a new account instead of the first-save onboarding", async () => {
		const harness = useManagedApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);

		const empty = await page(agent, "/queue?source=bulk");
		expect(element(empty, "[data-test-discovery]").classList.contains("readlist-discovery--visible")).toBe(true);
		expect(emptyCopy(empty)[0]).toBe("No articles from Bulk import in To Read");

		expect(emptyCopy(await page(agent, "/queue"))[0]).toBe("Nothing saved yet");
	});

	it("says no sender is selected rather than inventing one", async () => {
		const harness = useManagedApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(harness, SAVED_ATLAS);

		expect(emptyCopy(await page(agent, "/queue?source=sender"))).toEqual([
			"No sender selected",
			"Choose a newsletter sender to see its articles in To Read.",
		]);
		expect(emptyCopy(await page(agent, "/queue?source=sender&sender=news%40example.org"))[0]).toBe(
			"No articles from news@example.org in To Read",
		);
	});

	it("names the source and remembered filters when a filtered source matches nothing", async () => {
		const harness = useManagedApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(harness, SAVED_ATLAS);

		const empty = await page(agent, "/queue?source=bulk&time=under-5");
		const [title, text] = emptyCopy(empty);
		expect(title).toBe("No matching articles");
		expect(text).toMatch(/^Nothing from Bulk import in To Read matches your filters: .+\. Your filters stay on as you browse until you clear them\. Clear filters also returns to all sources\.$/);
	});
});
