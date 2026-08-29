import assert from "node:assert/strict";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function createReadlist(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues?feature=queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function articleIdFor(agent: TestAgent, url: string): Promise<string> {
	const doc = parse((await agent.get("/queue")).text);
	const card = Array.from(doc.querySelectorAll("[data-test-article]")).find(
		(el) => el.querySelector("[data-test-article-url]")?.getAttribute("href") === url,
	);
	const id = card?.getAttribute("data-test-article");
	assert(id, `the card for ${url} must render`);
	return id;
}

async function saveArticle(agent: TestAgent, url: string): Promise<string> {
	await agent.post("/queue/save").type("form").send({ url });
	return articleIdFor(agent, url);
}

async function openReader(agent: TestAgent, articleId: string): Promise<Document> {
	const response = await agent.get(`/queue/${articleId}/view`);
	expect(response.status).toBe(200);
	return parse(response.text);
}

function pickerSlot(doc: Document): Element {
	const slot = doc.querySelector("[data-test-readlists-slot]");
	assert(slot, "the reader toolbar must render the readlists slot");
	return slot;
}

function pickerOptions(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-assign-readlist]"), (el) =>
		el.getAttribute("data-test-assign-readlist"),
	);
}

function readlistTags(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-readlist-tag]"), (el) =>
		el.getAttribute("data-test-readlist-tag"),
	);
}

async function assignTo(params: {
	agent: TestAgent;
	articleId: string;
	readlist: string;
}): Promise<request.Response> {
	return params.agent
		.post(`/queue/${params.articleId}/assign`)
		.type("form")
		.send({ queue: params.readlist, returnTo: `/queue/${params.articleId}/view` });
}

function listedArticleIds(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
		el.getAttribute("data-test-article"),
	);
}

describe("the reader's add-to-readlist control", () => {
	it("stays hidden for a reader with only the default readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const doc = await openReader(agent, articleId);

		expect(pickerSlot(doc).classList.contains("article-body__readlists-slot--hidden")).toBe(true);
		expect(readlistTags(doc)).toEqual([]);
	});

	it("offers only the readlists the article is not yet in, without the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const later = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const before = await openReader(agent, articleId);
		expect(pickerSlot(before).classList.contains("article-body__readlists-slot--visible")).toBe(
			true,
		);
		expect([...pickerOptions(before)].sort()).toEqual([work, later].sort());
		expect(readlistTags(before)).toEqual([]);

		await assignTo({ agent, articleId, readlist: work });

		const after = await openReader(agent, articleId);
		expect(pickerOptions(after)).toEqual([later]);
		expect(readlistTags(after)).toEqual([work]);
	});

	it("returns to the reader after assigning", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await assignTo({ agent, articleId, readlist: work });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
	});

	it("files the article at the top of the chosen readlist, keeping its read state", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		await saveArticle(agent, "https://example.com/a");
		await saveArticle(agent, "https://example.com/b");
		const first = await articleIdFor(agent, "https://example.com/a");
		const second = await articleIdFor(agent, "https://example.com/b");
		await agent.post(`/queue/${second}/status`).type("form").send({ status: "read" });

		await assignTo({ agent, articleId: first, readlist: work });
		await assignTo({ agent, articleId: second, readlist: work });

		const workUnread = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(workUnread)).toEqual([first]);
		const workRead = parse((await agent.get(`/queue?queue=${work}&tab=done`)).text);
		expect(listedArticleIds(workRead)).toEqual([second]);
		const myReadlist = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myReadlist)).toEqual([first]);
	});

	it("lands a newly assigned article at the top of the readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		await saveArticle(agent, "https://example.com/a");
		await saveArticle(agent, "https://example.com/b");
		const first = await articleIdFor(agent, "https://example.com/a");
		const second = await articleIdFor(agent, "https://example.com/b");

		await assignTo({ agent, articleId: second, readlist: work });
		await assignTo({ agent, articleId: first, readlist: work });

		const myReadlist = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myReadlist)).toEqual([second, first]);
		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([first, second]);
	});

	it("keeps one copy per readlist however often the reader assigns", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		await assignTo({ agent, articleId, readlist: work });
		await assignTo({ agent, articleId, readlist: work });

		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([articleId]);
	});

	it("rejects a readlist the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		expect((await assignTo({ agent, articleId, readlist: "someone-elses" })).status).toBe(404);
		expect((await assignTo({ agent, articleId, readlist: "default" })).status).toBe(404);
		expect((await assignTo({ agent, articleId: "not-an-id", readlist: "default" })).status).toBe(404);
	});

	it("takes the tag off and empties the readlist copy on unassign", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const response = await agent
			.post(`/queue/${articleId}/unassign`)
			.type("form")
			.send({ queue: work, returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([]);
		const myReadlist = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myReadlist)).toEqual([articleId]);
		const reader = await openReader(agent, articleId);
		expect(readlistTags(reader)).toEqual([]);
		expect(pickerOptions(reader)).toEqual([work]);
	});

	it("keeps the reader reachable after unassigning the readlist it was opened from", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const openedFromWork = parse((await agent.get(`/queue/${articleId}/view?queue=${work}`)).text);
		const unassignForm = openedFromWork.querySelector(
			`[data-test-readlist-tag="${work}"] form`,
		);
		assert(unassignForm, "the tag must carry its un-assign form");
		const returnTo = unassignForm.querySelector('input[name="returnTo"]')?.getAttribute("value");
		expect(returnTo).toBe(`/queue/${articleId}/view`);

		const response = await agent
			.post(`/queue/${articleId}/unassign`)
			.type("form")
			.send({ queue: work, returnTo });
		expect(response.status).toBe(303);
		const landed = await agent.get(response.headers.location);
		expect(landed.status).toBe(200);
		expect(readlistTags(parse(landed.text))).toEqual([]);
	});

	it("carries the tags on the polled header so a settling crawl cannot drop them", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const poll = await agent.get(`/queue/${articleId}/reader?poll=1`);
		expect(poll.status).toBe(200);
		expect(readlistTags(parse(poll.text))).toEqual([work]);

		const summaryPoll = await agent.get(`/queue/${articleId}/summary?poll=1`);
		expect(summaryPoll.status).toBe(200);
		expect(readlistTags(parse(summaryPoll.text))).toEqual([work]);
	});

	it("sends a signed-out visitor to log in rather than assigning anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/ffffffffffffffffffffffffffffffff/assign")
			.type("form")
			.send({ queue: "work", returnTo: "/queue" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("sends a signed-out visitor to log in rather than unassigning anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/ffffffffffffffffffffffffffffffff/unassign")
			.type("form")
			.send({ queue: "work", returnTo: "/queue" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("never unassigns the default readlist's copy", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await agent
			.post(`/queue/${articleId}/unassign`)
			.type("form")
			.send({ queue: "default", returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(303);
		const myReadlist = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myReadlist)).toEqual([articleId]);
	});

	it("answers a no-op redirect when the default copy is already gone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const later = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });
		await agent.post(`/queue/${articleId}/delete`);

		const response = await assignTo({ agent, articleId, readlist: later });

		expect(response.status).toBe(303);
		const onLater = parse((await agent.get(`/queue?queue=${later}`)).text);
		expect(listedArticleIds(onLater)).toEqual([]);
	});

	it("stops offering the picker once the default copy is gone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });
		await agent.post(`/queue/${articleId}/delete`);

		const doc = parse((await agent.get(`/queue/${articleId}/view?queue=${work}`)).text);

		expect(pickerSlot(doc).classList.contains("article-body__readlists-slot--hidden")).toBe(true);
		expect(readlistTags(doc)).toEqual([work]);
	});

	it("marks every copy read from a flagless readlist-scoped status post", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const response = await agent
			.post(`/queue/${articleId}/status?queue=${work}`)
			.type("form")
			.send({ status: "read" });

		expect(response.status).toBe(303);
		const workRead = parse((await agent.get(`/queue?queue=${work}&tab=done`)).text);
		expect(listedArticleIds(workRead)).toEqual([articleId]);
		expect(listedArticleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect(listedArticleIds(parse((await agent.get("/queue?tab=done")).text))).toEqual([articleId]);
	});

	it("keeps the chromeless marker on the poll URLs and filing forms of the iOS reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const reader = parse((await agent.get(`/queue/${articleId}/view?platform=ios`)).text);
		const tagForm = reader.querySelector(`[data-test-readlist-tag="${work}"] form`);
		assert(tagForm, "the tag must carry its un-assign form");
		expect(tagForm.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			`/queue/${articleId}/view?platform=ios`,
		);

		const poll = await agent.get(`/queue/${articleId}/reader?poll=1&platform=ios`);
		expect(poll.status).toBe(200);
		const polled = parse(poll.text);
		const polledForm = polled.querySelector(`[data-test-readlist-tag="${work}"] form`);
		assert(polledForm, "the polled header must carry the un-assign form");
		expect(polledForm.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			`/queue/${articleId}/view?platform=ios`,
		);
	});
});
