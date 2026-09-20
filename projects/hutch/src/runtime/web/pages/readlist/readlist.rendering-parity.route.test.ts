import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { MAX_POLLS } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;

interface Rendering {
	name: string;
	at: (path: string) => string;
	mainSelector: string;
	cardFeature: string | null;
}

const RENDERINGS: Rendering[] = [
	{ name: "classic", at: (path) => path, mainSelector: "main.readlist", cardFeature: null },
	{
		name: "design",
		at: (path) => (path.includes("?") ? `${path}&feature=design` : `${path}?feature=design`),
		mainSelector: "main[data-test-readlist-design]",
		cardFeature: "design",
	},
];

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function parseFragment(html: string): Document {
	return new JSDOM(`<main>${html}</main>`).window.document;
}

function cards(doc: Document): Element[] {
	return [...doc.querySelectorAll("[data-test-article-list] [data-test-article]")];
}

function articleIds(doc: Document): string[] {
	return cards(doc)
		.map((card) => card.getAttribute("data-test-article"))
		.filter((id): id is string => Boolean(id));
}

function readStatusOf(card: Element): string | null {
	return (
		card.querySelector("[data-test-read-status]")?.getAttribute("data-test-read-status") ?? null
	);
}

function panels(doc: Document, kind: "mark-status" | "delete"): Element[] {
	return [...doc.querySelectorAll(`[data-test-confirm-popover='${kind}']`)];
}

async function save(agent: TestAgent, url: string) {
	return agent.post("/queue/save").type("form").send({ url });
}

async function saveMany(agent: TestAgent, count: number, prefix: string) {
	for (let i = 0; i < count; i++) await save(agent, `${prefix}${i}`);
}

async function createReadlist(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function fileIntoReadlist(harness: TestHarness, readlist: string, url: string) {
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "the seeded login user must exist");
	await harness.articleStore.saveReadlistArticle({
		userId,
		readlist: ReadlistSlugSchema.parse(readlist),
		url,
		metadata: { title: url, siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" },
		savedAt: new Date(),
	});
}

describe.each(RENDERINGS)("`/queue` behaviour in the $name rendering", (rendering) => {
	const at = rendering.at;

	it("is the rendering this row names, so every assertion below is about it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get(at("/queue"))).text);

		assert(doc.querySelector(rendering.mainSelector), `${rendering.name} must serve its own main`);
		const other = RENDERINGS.find((each) => each.name !== rendering.name);
		assert(other, "there are two renderings to tell apart");
		expect(doc.querySelector(other.mainSelector)).toBeNull();
	});

	it("flips the read-status indicator from unread to read and back", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");

		const [savedCard] = cards(parse((await agent.get(at("/queue"))).text));
		assert(savedCard, "the saved article must render as a card");
		expect(readStatusOf(savedCard)).toBe("unread");
		const articleId = savedCard.getAttribute("data-test-article");
		assert(articleId, "the card must expose its article id");

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });
		const [readCard] = cards(parse((await agent.get(at("/queue?tab=done"))).text));
		assert(readCard, "the read article must render on the Read tab");
		expect(readStatusOf(readCard)).toBe("read");

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "unread" });
		const [unreadCard] = cards(parse((await agent.get(at("/queue"))).text));
		assert(unreadCard, "the article must return to the To Read tab");
		expect(readStatusOf(unreadCard)).toBe("unread");
	});

	it("walks a multi-page listing forwards and back through the pagination controls", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveMany(agent, 21, "https://example.com/p-");

		const firstPage = parse((await agent.get(at("/queue"))).text);
		const firstPageIds = articleIds(firstPage);
		expect(firstPageIds).toHaveLength(20);

		const next = firstPage.querySelector("[data-test-pagination-next]");
		assert(next, "page 1 of a multi-page listing must render a Next control");
		const nextHref = next.getAttribute("href");
		assert(nextHref, "the Next control must be a real link");
		expect(new URL(nextHref, TEST_APP_ORIGIN).searchParams.get("page")).toBe("2");

		const secondPage = parse((await agent.get(nextHref)).text);
		expect(articleIds(secondPage)).toHaveLength(1);

		const prev = secondPage.querySelector("[data-test-pagination-prev]");
		assert(prev, "page 2 must render a Previous control");
		const prevHref = prev.getAttribute("href");
		assert(prevHref, "the Previous control must be a real link");

		expect(articleIds(parse((await agent.get(prevHref)).text))).toEqual(firstPageIds);
	});

	it("asks before marking read once the article sits in more than one readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);
		await save(agent, "https://example.com/filed");
		await fileIntoReadlist(harness, readlist, "https://example.com/filed");

		const doc = parse((await agent.get(at("/queue"))).text);
		const [panel] = panels(doc, "mark-status");
		assert(panel, "an article in two readlists must earn a confirmation panel");
		expect(panel.parentElement?.tagName).toBe("MAIN");
		expect(panel.closest("[data-test-article]")).toBeNull();

		const triggersByArticle = new Map(
			cards(doc).map((card) => [
				card.getAttribute("data-test-article"),
				card.querySelector("[data-test-action='mark-read']")?.getAttribute("popovertarget"),
			]),
		);
		const panelsByArticle = new Map(
			panels(doc, "mark-status").map((each) => [
				each.getAttribute("data-test-confirm-subject"),
				each.getAttribute("id"),
			]),
		);
		expect(triggersByArticle.size).toBe(1);
		expect(triggersByArticle).toEqual(panelsByArticle);

		const [articleId] = articleIds(doc);
		assert(articleId, "the card must expose its article id");
		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read", ack: "never" });

		const after = parse((await agent.get(at("/queue?tab=done"))).text);
		const [readCard] = cards(after);
		assert(readCard, "the confirmed article must land on the Read tab");
		expect(readStatusOf(readCard)).toBe("read");
		expect(panels(after, "mark-status")).toHaveLength(0);
	});

	it("asks before deleting, from a panel the card cannot swap away", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/one");
		await save(agent, "https://example.com/two");

		const doc = parse((await agent.get(at("/queue"))).text);
		expect(panels(doc, "delete")).toHaveLength(2);
		for (const panel of panels(doc, "delete")) {
			expect(panel.parentElement?.tagName).toBe("MAIN");
			expect(panel.closest("[data-test-article]")).toBeNull();
		}

		const triggersByArticle = new Map(
			cards(doc).map((card) => [
				card.getAttribute("data-test-article"),
				card.querySelector("[data-test-action='delete']")?.getAttribute("popovertarget"),
			]),
		);
		const panelsByArticle = new Map(
			panels(doc, "delete").map((panel) => [
				panel.getAttribute("data-test-confirm-subject"),
				panel.getAttribute("id"),
			]),
		);
		expect(triggersByArticle).toEqual(panelsByArticle);

		const [articleId] = articleIds(doc);
		assert(articleId, "the card must expose its article id");
		await agent.post(`/queue/${articleId}/delete`).type("form").send({});

		const after = parse((await agent.get(at("/queue"))).text);
		expect(articleIds(after)).toHaveLength(1);
		expect(articleIds(after)).not.toContain(articleId);
	});

	it("swaps its counts fragment onto ids the page it came from actually rendered", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveMany(agent, 21, "https://example.com/swap-");

		const page = parse((await agent.get(at("/queue"))).text);
		const trigger = page.querySelector("[data-test-readlist-counts]");
		assert(trigger, "the page must arm the out-of-band counts request");
		const countsUrl = trigger.getAttribute("hx-get");
		assert(countsUrl, "the counts trigger must name the fragment it fetches");
		const fragment = parseFragment((await agent.get(countsUrl)).text);

		const swapped = [...fragment.querySelectorAll("[hx-swap-oob]")];
		expect(swapped.length).toBeGreaterThan(0);
		for (const replacement of swapped) {
			const target = page.getElementById(replacement.id);
			assert(target, `the page must render #${replacement.id} for the counts swap to land on`);
			expect(replacement.tagName).toBe(target.tagName);
			expect(replacement.getAttribute("class")).toBe(target.getAttribute("class"));
		}
	});

	it("re-renders its own listing when reading the last row would leave the page adrift", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/only");
		const [articleId] = articleIds(parse((await agent.get(at("/queue"))).text));
		assert(articleId, "the card must expose its article id");

		const response = await agent
			.post(at(`/queue/${articleId}/status?swap=card`))
			.set("HX-Request", "true")
			.type("form")
			.send({ status: "read" });

		expect(response.status).toBe(200);
		expect(response.headers["hx-retarget"]).toBe("main");
		expect(response.headers["hx-reselect"]).toBe("main");
		const doc = parse(response.text);
		assert(doc.querySelector(rendering.mainSelector), "the fallback re-renders this rendering");
		assert(doc.querySelector("[data-test-empty-readlist]"), "the To Read tab is now empty");
		assert(doc.querySelector("[data-test-toast]"), "the Undo toast survives the fallback");
	});

	it("keeps the reader's filters on the card's next poll, and stops polling at the budget", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/polled");
		const [articleId] = articleIds(parse((await agent.get(at("/queue"))).text));
		assert(articleId, "the card must expose its article id");

		const polling = parse(
			(await agent.get(at(`/queue/${articleId}/card?poll=1&tab=done&order=asc`))).text,
		).querySelector("[data-test-article]");
		assert(polling, "the card fragment must render");
		const next = polling.getAttribute("hx-get");
		assert(next, "a pending card must carry its next poll");
		const nextUrl = new URL(next, TEST_APP_ORIGIN);
		expect(nextUrl.searchParams.get("poll")).toBe("2");
		expect(nextUrl.searchParams.get("tab")).toBe("done");
		expect(nextUrl.searchParams.get("order")).toBe("asc");
		expect(nextUrl.searchParams.get("feature")).toBe(rendering.cardFeature);

		const exhausted = parse(
			(await agent.get(at(`/queue/${articleId}/card?poll=${MAX_POLLS}`))).text,
		).querySelector("[data-test-article]");
		assert(exhausted, "the card fragment must render at the budget");
		expect(exhausted.hasAttribute("hx-get")).toBe(false);
	});

	it("arms the save skeleton above the row a save will land in, and only where a save can land", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const fresh = parse((await agent.get(at("/queue"))).text);
		const freshSkeleton = fresh.querySelector("[data-test-save-skeleton]");
		assert(freshSkeleton, "the listing must always carry the save skeleton");
		expect(freshSkeleton.classList.contains("readlist-save-skeleton--armed")).toBe(true);
		const freshEmpty = fresh.querySelector("[data-test-empty-readlist]");
		assert(freshEmpty, "a fresh readlist must render its empty state");
		expect(freshSkeleton.nextElementSibling).toBe(freshEmpty);

		await save(agent, "https://example.com/landed");
		const populated = parse((await agent.get(at("/queue"))).text);
		const populatedSkeleton = populated.querySelector("[data-test-save-skeleton]");
		assert(populatedSkeleton, "the listing must always carry the save skeleton");
		const populatedList = populated.querySelector("[data-test-article-list]");
		assert(populatedList, "a populated readlist must render its article list");
		expect(populatedSkeleton.nextElementSibling).toBe(populatedList);

		const doneTab = parse((await agent.get(at("/queue?tab=done"))).text);
		const inert = doneTab.querySelector("[data-test-save-skeleton]");
		assert(inert, "the skeleton renders on every tab");
		expect(inert.classList.contains("readlist-save-skeleton--inert")).toBe(true);
	});
});
