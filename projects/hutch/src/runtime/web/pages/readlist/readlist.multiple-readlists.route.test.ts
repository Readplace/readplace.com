import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { READLIST_LABEL_MAX_LENGTH, READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function articleIds(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
		el.getAttribute("data-test-article"),
	).filter((id): id is string => Boolean(id));
}

function cardStatuses(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
		el.className.includes("readlist-article--read") ? "read" : "unread",
	);
}

async function createReadlist(agent: TestAgent) {
	return agent.post("/queue/queues");
}

function openedSlug(location: string): string {
	const slug = new URL(location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

function renameable(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-readlist-rename]"), (el) =>
		el.getAttribute("data-test-readlist"),
	);
}

async function createReadlistAndOpen(agent: TestAgent): Promise<string> {
	const response = await createReadlist(agent);
	return openedSlug(response.headers.location);
}

function queueLabels(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-readlist]"), (el) => el.textContent);
}

async function save(agent: TestAgent, url: string) {
	return agent.post("/queue/save").type("form").send({ url });
}

async function saveFrom(agent: TestAgent, readlist: string, url: string) {
	return agent.post(`/queue/save?queue=${readlist}`).type("form").send({ url });
}

async function seedInto(harness: TestHarness, readlist: string, url: string) {
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return harness.articleStore.saveReadlistArticle({
		userId,
		readlist: ReadlistSlugSchema.parse(readlist),
		url,
		metadata: { title: url, siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" },
		savedAt: new Date(),
	});
}

function saveFormClasses(doc: Document): string[] {
	const form = doc.querySelector('[data-test-form="save-article"]');
	assert(form, "the readlist page must render the save bar");
	return form.className.split(" ");
}

describe("POST /queue/queues", () => {
	it("creates the readlist on the spot and lands the reader on it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createReadlist(agent);

		expect(response.status).toBe(303);
		const slug = openedSlug(response.headers.location);
		expect(response.headers.location).toBe(`/queue?queue=${slug}`);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(queueLabels(doc)).toEqual(["All", "New Readlist"]);
		expect(doc.querySelector("[data-test-empty-readlist]")?.textContent).toContain(
			"Nothing saved yet",
		);
	});

	it("numbers each new readlist past the default names already in use", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const first = await createReadlistAndOpen(agent);
		const second = await createReadlistAndOpen(agent);

		expect(second).not.toBe(first);
		expect(queueLabels(parse((await agent.get("/queue")).text))).toEqual([
			"All",
			"New Readlist",
			"New Readlist 2",
		]);
	});

	it("addresses a readlist by an opaque id, not by what it is called", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const slug = await createReadlistAndOpen(agent);

		expect(slug).toMatch(/^[a-f0-9]{16}$/);
	});

	it("offers the readlist the reader is on for renaming, with the script that does it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createReadlist(agent);

		const slug = openedSlug(response.headers.location);
		const doc = parse((await agent.get(response.headers.location)).text);
		const tab = doc.querySelector(`[data-test-readlist="${slug}"]`);
		assert(tab, "the created readlist must render a tab");
		expect(tab.tagName).toBe("A");
		expect(tab.getAttribute("href")).toContain(`queue=${slug}`);
		expect(tab.getAttribute("hx-boost")).toBe("false");
		expect(tab.getAttribute("data-readlist-rename")).toBe(`/queue/queues/${slug}/rename`);
		expect(tab.getAttribute("data-readlist-label-max")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(doc.querySelector('script[src="/client-dist/readlist-rename.client.js"]')).not.toBeNull();
	});

	it("withholds the rename from a reader who has lost write access", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlistAndOpen(agent);
		const lookup = await harness.auth.findUserByEmail("test@example.com");
		assert(lookup, "the logged-in reader must exist");
		await harness.subscriptionProviders.upsertTrialing({
			userId: lookup.userId,
			trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
		});

		const doc = parse((await agent.get(`/queue?queue=${slug}`)).text);

		expect(renameable(doc)).toEqual([]);
		expect(doc.querySelector('[data-test-action="new-readlist"]')).toBeNull();
		expect(doc.querySelector(`[data-test-readlist="${slug}"]`)?.getAttribute("href")).toContain(
			`queue=${slug}`,
		);
	});

	it("never offers the readlist every reader is given for renaming", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlistAndOpen(agent);

		const onDefault = parse((await agent.get("/queue")).text);
		const onCreated = parse((await agent.get(`/queue?queue=${slug}`)).text);

		expect(renameable(onDefault)).toEqual([]);
		expect(renameable(onCreated)).toEqual([slug]);
	});

	it("stops the reader at the per-account readlist cap and says so", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		for (let index = 0; index < READLIST_MAX_PER_USER; index += 1) {
			await createReadlist(agent);
		}

		const response = await createReadlist(agent);

		expect(response.headers.location).toContain("queue_error=limit");
		const doc = parse((await agent.get(response.headers.location)).text);
		const flash = doc.querySelector("[data-test-readlist-error]");
		assert(flash, "the cap must be explained where the reader pressed the control");
		expect(flash.textContent).toBe(`You can keep up to ${READLIST_MAX_PER_USER} readlists.`);
	});

	it("sends a signed-out visitor to log in rather than creating anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post("/queue/queues");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("a URL saved into more than one readlist", () => {
	it("keeps an independent copy in each readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, readlist, "https://example.com/a");

		const onDefault = parse((await agent.get("/queue")).text);
		const onWork = parse((await agent.get(`/queue?queue=${readlist}`)).text);

		expect(articleIds(onDefault)).toEqual(articleIds(onWork));
		expect(articleIds(onWork)).toHaveLength(1);
	});

	it("marks every copy read from whichever readlist the reader was looking at", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, readlist, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent
			.post(`/queue/${articleId}/status?queue=${readlist}`)
			.type("form")
			.send({ status: "read" });

		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect(articleIds(parse((await agent.get("/queue?tab=done")).text))).toEqual([articleId]);
		const workDone = parse((await agent.get(`/queue?queue=${readlist}&tab=done`)).text);
		expect(articleIds(workDone)).toEqual([articleId]);
	});

	it("reverses every copy when the reader marks it unread again", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, readlist, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");
		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "unread" });

		expect(cardStatuses(parse((await agent.get("/queue")).text))).toEqual(["unread"]);
		expect(cardStatuses(parse((await agent.get(`/queue?queue=${readlist}`)).text))).toEqual([
			"unread",
		]);
	});

	it("deletes one copy without touching the other", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, readlist, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		const response = await agent.post(`/queue/${articleId}/delete?queue=${readlist}`);

		expect(response.headers.location).toBe(`/queue?queue=${readlist}`);
		expect(articleIds(parse((await agent.get(`/queue?queue=${readlist}`)).text))).toEqual([]);
		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([articleId]);
	});

	it("only announces the link as dropped once the reader holds it nowhere", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const dequeued: string[] = [];
		const harness = useApp({
			...fixture,
			events: {
				...fixture.events,
				publishLinkDequeued: async ({ url }) => {
					dequeued.push(url);
				},
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, readlist, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent.post(`/queue/${articleId}/delete?queue=${readlist}`);
		expect(dequeued).toEqual([]);

		await agent.post(`/queue/${articleId}/delete`);
		expect(dequeued).toEqual(["https://example.com/a"]);
	});

	it("keeps the link announced when the default copy goes first and a readlist still holds it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const dequeued: string[] = [];
		const harness = useApp({
			...fixture,
			events: {
				...fixture.events,
				publishLinkDequeued: async ({ url }) => {
					dequeued.push(url);
				},
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, readlist, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent.post(`/queue/${articleId}/delete`);
		expect(dequeued).toEqual([]);

		await agent.post(`/queue/${articleId}/delete?queue=${readlist}`);
		expect(dequeued).toEqual(["https://example.com/a"]);
	});
});

describe("a readlist the reader opened", () => {
	it("lists, counts and paginates only its own saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await save(agent, "https://example.com/default-only");
		await seedInto(harness, readlist, "https://example.com/work-only");

		const onWork = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		expect(
			Array.from(onWork.querySelectorAll("[data-test-article-url]"), (el) => el.textContent),
		).toEqual(["example.com"]);
		expect(articleIds(onWork)).toHaveLength(1);

		const counts = await agent.get(`/queue/counts?queue=${readlist}`);
		expect(counts.text).toContain("To Read (1)");
	});

	it("drops the save into the default readlist however the request names another", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);

		const response = await saveFrom(agent, readlist, "https://example.com/only-here");

		expect(response.headers.location).toBe("/queue#latest-saved");
		expect(articleIds(parse((await agent.get("/queue")).text))).toHaveLength(1);
		expect(articleIds(parse((await agent.get(`/queue?queue=${readlist}`)).text))).toEqual([]);
	});

	it("hides the save bar and points the empty state at the default readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);

		const onWork = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		const onDefault = parse((await agent.get("/queue")).text);

		expect(saveFormClasses(onWork)).toContain("readlist__save-form--hidden");
		expect(saveFormClasses(onDefault)).toContain("readlist__save-form--visible");
		const empty = onWork.querySelector("[data-test-empty-readlist]");
		assert(empty, "an untouched readlist must render its empty state");
		expect(empty.textContent).toContain("Every link you save lands in All");
	});

	it("opens the owner reader for an article only that readlist holds", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await seedInto(harness, readlist, "https://example.com/only-here");
		const doc = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		const readerHref = doc.querySelector("[data-test-article-title]")?.getAttribute("href");
		assert(readerHref, "the card title must link to the reader");
		expect(readerHref).toContain(`queue=${readlist}`);

		const response = await agent.get(readerHref);

		expect(response.status).toBe(200);
	});
});

describe("the readlist every reader is given", () => {
	it("links each owned readlist from the rail", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await seedInto(harness, readlist, "https://example.com/work-only");

		const doc = parse((await agent.get("/queue")).text);

		expect(queueLabels(doc)).toEqual(["All", "New Readlist"]);
		const workTab = doc.querySelector(`[data-test-readlist="${readlist}"]`);
		assert(workTab, "the owned readlist must render its tab");
		expect(workTab.getAttribute("href")).toBe(
			`/queue?queue=${readlist}&utm_source=queue-nav&utm_medium=internal&utm_content=queue-${readlist}`,
		);

		const onWork = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		expect(
			Array.from(onWork.querySelectorAll("[data-test-article-title]"), (el) => el.textContent),
		).toEqual(["https://example.com/work-only"]);
	});

	it("keeps the save bar on a readlist URL that was never minted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlistAndOpen(agent);

		const doc = parse((await agent.get("/queue?queue=never-minted")).text);

		expect(saveFormClasses(doc)).toContain("readlist__save-form--visible");
	});

	it("counts and lists only its own saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent);
		await seedInto(harness, readlist, "https://example.com/work-only");

		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect((await agent.get("/queue/counts")).text).toContain("To Read (0)");
	});
});
