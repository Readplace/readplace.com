import assert from "node:assert/strict";
import { QUEUE_LABEL_MAX_LENGTH, QUEUE_MAX_PER_USER } from "@packages/domain/queue";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

const PER_REQUEST_NONCE = /nonce="[^"]*"/g;

function mainMarkup(doc: Document): string {
	const main = doc.querySelector("main.queue");
	assert(main, "the queue page must render a main landmark");
	return main.innerHTML.replace(PER_REQUEST_NONCE, 'nonce="[normalised]"');
}

function articleIds(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
		el.getAttribute("data-test-article"),
	).filter((id): id is string => Boolean(id));
}

function cardStatuses(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
		el.className.includes("queue-article--read") ? "read" : "unread",
	);
}

async function createQueue(agent: TestAgent) {
	return agent.post("/queue/queues?feature=queues");
}

function createdSlug(location: string): string {
	const slug = new URL(location, TEST_APP_ORIGIN).searchParams.get("created");
	assert(slug, "creating a queue must land the reader on it, ready to name");
	return slug;
}

async function createQueueAndOpen(agent: TestAgent): Promise<string> {
	const response = await createQueue(agent);
	return createdSlug(response.headers.location);
}

function queueLabels(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-queue]"), (el) => el.textContent);
}

async function saveInto(agent: TestAgent, queue: string | undefined, url: string) {
	const action = queue === undefined ? "/queue/save" : `/queue/save?feature=queues&queue=${queue}`;
	return agent.post(action).type("form").send({ url });
}

describe("POST /queue/queues", () => {
	it("creates the queue on the spot and lands the reader on it, ready to name", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createQueue(agent);

		expect(response.status).toBe(303);
		const slug = createdSlug(response.headers.location);
		expect(response.headers.location).toBe(
			`/queue?queue=${slug}&feature=queues&created=${slug}`,
		);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(queueLabels(doc)).toEqual(["My Queue", "New Queue 1"]);
		expect(doc.querySelector("[data-test-empty-queue]")).not.toBeNull();
		expect(doc.querySelector("[data-test-queue-created]")?.textContent).toBe(
			"Created New Queue 1.",
		);
	});

	it("numbers each new queue past the default names already in use", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const first = await createQueueAndOpen(agent);
		const second = await createQueueAndOpen(agent);

		expect(second).not.toBe(first);
		expect(queueLabels(parse((await agent.get("/queue?feature=queues")).text))).toEqual([
			"My Queue",
			"New Queue 1",
			"New Queue 2",
		]);
	});

	it("addresses a queue by an opaque id, not by what it is called", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const slug = await createQueueAndOpen(agent);

		expect(slug).toMatch(/^[a-f0-9]{16}$/);
	});

	it("hands the new queue's tab over to be named in place, with the script that does it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createQueue(agent);

		const slug = createdSlug(response.headers.location);
		const doc = parse((await agent.get(response.headers.location)).text);
		const tab = doc.querySelector(`[data-test-queue="${slug}"]`);
		assert(tab, "the created queue must render a tab");
		expect(tab.getAttribute("data-queue-rename")).toBe(
			`/queue/queues/${slug}/rename?feature=queues`,
		);
		expect(tab.getAttribute("data-queue-label-max")).toBe(String(QUEUE_LABEL_MAX_LENGTH));
		expect(doc.querySelector('script[src="/client-dist/queue-rename.client.js"]')).not.toBeNull();
	});

	it("leaves the tab a plain link once the naming moment has passed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createQueueAndOpen(agent);

		const doc = parse((await agent.get("/queue?feature=queues")).text);

		const tab = doc.querySelector(`[data-test-queue="${slug}"]`);
		assert(tab, "the created queue must render a tab");
		expect(tab.tagName).toBe("A");
		expect(tab.getAttribute("href")).toContain(`queue=${slug}`);
	});

	it("stops the reader at the per-account queue cap and says so", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		for (let index = 0; index < QUEUE_MAX_PER_USER; index += 1) {
			await createQueue(agent);
		}

		const response = await createQueue(agent);

		expect(response.headers.location).toContain("queue_error=limit");
		const doc = parse((await agent.get(response.headers.location)).text);
		const flash = doc.querySelector("[data-test-queue-error]");
		assert(flash, "the cap must be explained where the reader pressed the control");
		expect(flash.textContent).toBe(`You can keep up to ${QUEUE_MAX_PER_USER} queues.`);
	});

	it("hands a second press of the control to the queue the first one made", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				createQueueDefinition: async () => ({ created: false }),
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createQueue(agent);

		expect(response.status).toBe(303);
		expect(response.headers.location).toMatch(/^\/queue\?queue=[a-f0-9]{16}&feature=queues$/);
	});

	it("does not exist for a reader who never turned the queues feature on", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/queues");

		expect(response.status).toBe(404);
		expect(
			parse((await agent.get("/queue?feature=queues")).text).querySelectorAll(
				"[data-test-queue]",
			),
		).toHaveLength(1);
	});

	it("sends a signed-out visitor to log in rather than creating anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post("/queue/queues");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("a URL saved into more than one queue", () => {
	it("keeps an independent copy in each queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await saveInto(agent, undefined, "https://example.com/a");
		await saveInto(agent, queue, "https://example.com/a");

		const onDefault = parse((await agent.get("/queue")).text);
		const onWork = parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text);

		expect(articleIds(onDefault)).toEqual(articleIds(onWork));
		expect(articleIds(onWork)).toHaveLength(1);
	});

	it("marks one copy read without touching the other", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await saveInto(agent, undefined, "https://example.com/a");
		await saveInto(agent, queue, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent
			.post(`/queue/${articleId}/status?feature=queues&queue=${queue}`)
			.type("form")
			.send({ status: "read" });

		expect(cardStatuses(parse((await agent.get("/queue")).text))).toEqual(["unread"]);
		const workDone = parse((await agent.get(`/queue?feature=queues&queue=${queue}&tab=done`)).text);
		expect(articleIds(workDone)).toEqual([articleId]);
	});

	it("deletes one copy without touching the other", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await saveInto(agent, undefined, "https://example.com/a");
		await saveInto(agent, queue, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		const response = await agent.post(`/queue/${articleId}/delete?feature=queues&queue=${queue}`);

		expect(response.headers.location).toBe(`/queue?queue=${queue}&feature=queues`);
		expect(articleIds(parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text))).toEqual([]);
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
		const queue = await createQueueAndOpen(agent);
		await saveInto(agent, undefined, "https://example.com/a");
		await saveInto(agent, queue, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent.post(`/queue/${articleId}/delete?feature=queues&queue=${queue}`);
		expect(dequeued).toEqual([]);

		await agent.post(`/queue/${articleId}/delete`);
		expect(dequeued).toEqual(["https://example.com/a"]);
	});
});

describe("a queue the reader opened", () => {
	it("lists, counts and paginates only its own saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await saveInto(agent, undefined, "https://example.com/default-only");
		await saveInto(agent, queue, "https://example.com/work-only");

		const onWork = parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text);
		expect(
			Array.from(onWork.querySelectorAll("[data-test-article-url]"), (el) => el.textContent),
		).toEqual(["example.com"]);
		expect(articleIds(onWork)).toHaveLength(1);

		const counts = await agent.get(`/queue/counts?feature=queues&queue=${queue}`);
		expect(counts.text).toContain("To Read (1)");
	});

	it("takes the save bar's link even when the reader never touched the default queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);

		const response = await saveInto(agent, queue, "https://example.com/only-here");

		expect(response.headers.location).toBe(`/queue?queue=${queue}&feature=queues#latest-saved`);
		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect(articleIds(parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text))).toHaveLength(1);
	});

	it("opens the owner reader for an article only that queue holds", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await saveInto(agent, queue, "https://example.com/only-here");
		const doc = parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text);
		const readerHref = doc.querySelector("[data-test-article-title]")?.getAttribute("href");
		assert(readerHref, "the card title must link to the reader");
		expect(readerHref).toContain(`queue=${queue}`);

		const response = await agent.get(readerHref);

		expect(response.status).toBe(200);
	});
});

describe("a reader who never turned the queues feature on", () => {
	it("sees the same page whether or not they own other queues", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveInto(agent, undefined, "https://example.com/a");
		const before = parse((await agent.get("/queue")).text);

		const queue = await createQueueAndOpen(agent);
		await saveInto(agent, queue, "https://example.com/work-only");

		const after = parse((await agent.get("/queue")).text);
		expect(mainMarkup(after)).toBe(mainMarkup(before));
	});

	it("is never offered the rail or the create control", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent);

		const doc = parse((await agent.get("/queue")).text);

		expect(doc.querySelector("[data-test-queue-nav]")).toBeNull();
		expect(doc.querySelector('[data-test-action="new-queue"]')).toBeNull();
		expect(doc.querySelector("main.queue")?.className).toBe("queue");
	});

	it("counts and lists only the default queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await saveInto(agent, queue, "https://example.com/work-only");

		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect((await agent.get("/queue/counts")).text).not.toContain("To Read (1)");
	});
});
