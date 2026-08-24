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

async function createQueue(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues?feature=queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a queue must land the reader on it");
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
	const slot = doc.querySelector("[data-test-queues-slot]");
	assert(slot, "the reader toolbar must render the queues slot");
	return slot;
}

function pickerOptions(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-assign-queue]"), (el) =>
		el.getAttribute("data-test-assign-queue"),
	);
}

function queueTags(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-queue-tag]"), (el) =>
		el.getAttribute("data-test-queue-tag"),
	);
}

async function assignTo(params: {
	agent: TestAgent;
	articleId: string;
	queue: string;
}): Promise<request.Response> {
	return params.agent
		.post(`/queue/${params.articleId}/assign`)
		.type("form")
		.send({ queue: params.queue, returnTo: `/queue/${params.articleId}/view` });
}

function listedArticleIds(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
		el.getAttribute("data-test-article"),
	);
}

describe("the reader's add-to-queue control", () => {
	it("stays hidden for a reader with only the default queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const doc = await openReader(agent, articleId);

		expect(pickerSlot(doc).classList.contains("article-body__queues-slot--hidden")).toBe(true);
		expect(queueTags(doc)).toEqual([]);
	});

	it("offers only the queues the article is not yet in, without the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const later = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const before = await openReader(agent, articleId);
		expect(pickerSlot(before).classList.contains("article-body__queues-slot--visible")).toBe(
			true,
		);
		expect([...pickerOptions(before)].sort()).toEqual([work, later].sort());
		expect(queueTags(before)).toEqual([]);

		await assignTo({ agent, articleId, queue: work });

		const after = await openReader(agent, articleId);
		expect(pickerOptions(after)).toEqual([later]);
		expect(queueTags(after)).toEqual([work]);
	});

	it("returns to the reader after assigning", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await assignTo({ agent, articleId, queue: work });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
	});

	it("files the article at the top of the chosen queue, keeping its read state", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		await saveArticle(agent, "https://example.com/a");
		await saveArticle(agent, "https://example.com/b");
		const first = await articleIdFor(agent, "https://example.com/a");
		const second = await articleIdFor(agent, "https://example.com/b");
		await agent.post(`/queue/${second}/status`).type("form").send({ status: "read" });

		await assignTo({ agent, articleId: first, queue: work });
		await assignTo({ agent, articleId: second, queue: work });

		const workUnread = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(workUnread)).toEqual([first]);
		const workRead = parse((await agent.get(`/queue?queue=${work}&tab=done`)).text);
		expect(listedArticleIds(workRead)).toEqual([second]);
		const myQueue = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myQueue)).toEqual([first]);
	});

	it("lands a newly assigned article at the top of the queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		await saveArticle(agent, "https://example.com/a");
		await saveArticle(agent, "https://example.com/b");
		const first = await articleIdFor(agent, "https://example.com/a");
		const second = await articleIdFor(agent, "https://example.com/b");

		await assignTo({ agent, articleId: second, queue: work });
		await assignTo({ agent, articleId: first, queue: work });

		const myQueue = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myQueue)).toEqual([second, first]);
		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([first, second]);
	});

	it("keeps one copy per queue however often the reader assigns", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		await assignTo({ agent, articleId, queue: work });
		await assignTo({ agent, articleId, queue: work });

		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([articleId]);
	});

	it("rejects a queue the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		expect((await assignTo({ agent, articleId, queue: "someone-elses" })).status).toBe(404);
		expect((await assignTo({ agent, articleId, queue: "default" })).status).toBe(404);
		expect((await assignTo({ agent, articleId: "not-an-id", queue: "default" })).status).toBe(404);
	});

	it("takes the tag off and empties the queue copy on unassign", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, queue: work });

		const response = await agent
			.post(`/queue/${articleId}/unassign`)
			.type("form")
			.send({ queue: work, returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([]);
		const myQueue = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myQueue)).toEqual([articleId]);
		const reader = await openReader(agent, articleId);
		expect(queueTags(reader)).toEqual([]);
		expect(pickerOptions(reader)).toEqual([work]);
	});

	it("keeps the reader reachable after unassigning the queue it was opened from", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, queue: work });

		const openedFromWork = parse((await agent.get(`/queue/${articleId}/view?queue=${work}`)).text);
		const unassignForm = openedFromWork.querySelector(
			`[data-test-queue-tag="${work}"] form`,
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
		expect(queueTags(parse(landed.text))).toEqual([]);
	});

	it("carries the tags on the polled header so a settling crawl cannot drop them", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, queue: work });

		const poll = await agent.get(`/queue/${articleId}/reader?poll=1`);
		expect(poll.status).toBe(200);
		expect(queueTags(parse(poll.text))).toEqual([work]);

		const summaryPoll = await agent.get(`/queue/${articleId}/summary?poll=1`);
		expect(summaryPoll.status).toBe(200);
		expect(queueTags(parse(summaryPoll.text))).toEqual([work]);
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

	it("never unassigns the default queue's copy", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await agent
			.post(`/queue/${articleId}/unassign`)
			.type("form")
			.send({ queue: "default", returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(303);
		const myQueue = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myQueue)).toEqual([articleId]);
	});

	it("answers a no-op redirect when the default copy is already gone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const later = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, queue: work });
		await agent.post(`/queue/${articleId}/delete`);

		const response = await assignTo({ agent, articleId, queue: later });

		expect(response.status).toBe(303);
		const onLater = parse((await agent.get(`/queue?queue=${later}`)).text);
		expect(listedArticleIds(onLater)).toEqual([]);
	});

	it("stops offering the picker once the default copy is gone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, queue: work });
		await agent.post(`/queue/${articleId}/delete`);

		const doc = parse((await agent.get(`/queue/${articleId}/view?queue=${work}`)).text);

		expect(pickerSlot(doc).classList.contains("article-body__queues-slot--hidden")).toBe(true);
		expect(queueTags(doc)).toEqual([work]);
	});

	it("marks the queue's own copy read from a flagless queue-scoped status post", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, queue: work });

		const response = await agent
			.post(`/queue/${articleId}/status?queue=${work}`)
			.type("form")
			.send({ status: "read" });

		expect(response.status).toBe(303);
		const workRead = parse((await agent.get(`/queue?queue=${work}&tab=done`)).text);
		expect(listedArticleIds(workRead)).toEqual([articleId]);
		const myQueue = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myQueue)).toEqual([articleId]);
	});

	it("keeps the chromeless marker on the poll URLs and filing forms of the iOS reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createQueue(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, queue: work });

		const reader = parse((await agent.get(`/queue/${articleId}/view?platform=ios`)).text);
		const tagForm = reader.querySelector(`[data-test-queue-tag="${work}"] form`);
		assert(tagForm, "the tag must carry its un-assign form");
		expect(tagForm.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			`/queue/${articleId}/view?platform=ios`,
		);

		const poll = await agent.get(`/queue/${articleId}/reader?poll=1&platform=ios`);
		expect(poll.status).toBe(200);
		const polled = parse(poll.text);
		const polledForm = polled.querySelector(`[data-test-queue-tag="${work}"] form`);
		assert(polledForm, "the polled header must carry the un-assign form");
		expect(polledForm.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			`/queue/${articleId}/view?platform=ios`,
		);
	});
});
