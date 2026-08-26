import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { QUEUE_LABEL_MAX_LENGTH, QUEUE_MAX_PER_USER, QueueSlugSchema } from "@packages/domain/queue";
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
		el.className.includes("queue-article--read") ? "read" : "unread",
	);
}

async function createQueue(agent: TestAgent) {
	return agent.post("/queue/queues?feature=queues");
}

function openedSlug(location: string): string {
	const slug = new URL(location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a queue must land the reader on it");
	return slug;
}

function renameable(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-queue-rename]"), (el) =>
		el.getAttribute("data-test-queue"),
	);
}

async function createQueueAndOpen(agent: TestAgent): Promise<string> {
	const response = await createQueue(agent);
	return openedSlug(response.headers.location);
}

function queueLabels(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-queue]"), (el) => el.textContent);
}

async function save(agent: TestAgent, url: string) {
	return agent.post("/queue/save").type("form").send({ url });
}

async function saveFrom(agent: TestAgent, queue: string, url: string) {
	return agent.post(`/queue/save?feature=queues&queue=${queue}`).type("form").send({ url });
}

async function seedInto(harness: TestHarness, queue: string, url: string) {
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return harness.articleStore.saveQueueArticle({
		userId,
		queue: QueueSlugSchema.parse(queue),
		url,
		metadata: { title: url, siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" },
		savedAt: new Date(),
	});
}

function saveFormClasses(doc: Document): string[] {
	const form = doc.querySelector('[data-test-form="save-article"]');
	assert(form, "the queue page must render the save bar");
	return form.className.split(" ");
}

describe("POST /queue/queues", () => {
	it("creates the queue on the spot and lands the reader on it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createQueue(agent);

		expect(response.status).toBe(303);
		const slug = openedSlug(response.headers.location);
		expect(response.headers.location).toBe(`/queue?queue=${slug}&feature=queues`);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(queueLabels(doc)).toEqual(["My Queue", "New Queue"]);
		expect(doc.querySelector("[data-test-empty-queue]")?.textContent).toContain(
			"Nothing saved yet",
		);
	});

	it("creates another queue without the flag once the reader owns one", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent);

		const response = await agent.post("/queue/queues");

		expect(response.status).toBe(303);
		const slug = openedSlug(response.headers.location);
		expect(response.headers.location).toBe(`/queue?queue=${slug}`);
		expect(queueLabels(parse((await agent.get("/queue")).text))).toEqual([
			"My Queue",
			"New Queue",
			"New Queue 2",
		]);
	});

	it("does not create a first queue without the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/queues");

		expect(response.status).toBe(404);
		expect(queueLabels(parse((await agent.get("/queue?feature=queues")).text))).toEqual([
			"My Queue",
		]);
	});

	it("numbers each new queue past the default names already in use", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const first = await createQueueAndOpen(agent);
		const second = await createQueueAndOpen(agent);

		expect(second).not.toBe(first);
		expect(queueLabels(parse((await agent.get("/queue?feature=queues")).text))).toEqual([
			"My Queue",
			"New Queue",
			"New Queue 2",
		]);
	});

	it("addresses a queue by an opaque id, not by what it is called", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const slug = await createQueueAndOpen(agent);

		expect(slug).toMatch(/^[a-f0-9]{16}$/);
	});

	it("offers the queue the reader is on for renaming, with the script that does it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createQueue(agent);

		const slug = openedSlug(response.headers.location);
		const doc = parse((await agent.get(response.headers.location)).text);
		const tab = doc.querySelector(`[data-test-queue="${slug}"]`);
		assert(tab, "the created queue must render a tab");
		expect(tab.tagName).toBe("A");
		expect(tab.getAttribute("href")).toContain(`queue=${slug}`);
		expect(tab.getAttribute("hx-boost")).toBe("false");
		expect(tab.getAttribute("data-queue-rename")).toBe(
			`/queue/queues/${slug}/rename?feature=queues`,
		);
		expect(tab.getAttribute("data-queue-label-max")).toBe(String(QUEUE_LABEL_MAX_LENGTH));
		expect(doc.querySelector('script[src="/client-dist/queue-rename.client.js"]')).not.toBeNull();
	});

	it("keeps offering the rename however the reader arrives at the queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createQueueAndOpen(agent);

		const doc = parse((await agent.get(`/queue?queue=${slug}&feature=queues`)).text);

		expect(renameable(doc)).toEqual([slug]);
	});

	it("withholds the rename from a reader who has lost write access", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createQueueAndOpen(agent);
		const lookup = await harness.auth.findUserByEmail("test@example.com");
		assert(lookup, "the logged-in reader must exist");
		await harness.subscriptionProviders.upsertTrialing({
			userId: lookup.userId,
			trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
		});

		const doc = parse((await agent.get(`/queue?queue=${slug}&feature=queues`)).text);

		expect(renameable(doc)).toEqual([]);
		expect(doc.querySelector('[data-test-action="new-queue"]')).toBeNull();
		expect(doc.querySelector(`[data-test-queue="${slug}"]`)?.getAttribute("href")).toContain(
			`queue=${slug}`,
		);
	});

	it("never offers the queue every reader is given for renaming", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createQueueAndOpen(agent);

		const onDefault = parse((await agent.get("/queue?feature=queues")).text);
		const onCreated = parse((await agent.get(`/queue?queue=${slug}&feature=queues`)).text);

		expect(renameable(onDefault)).toEqual([]);
		expect(renameable(onCreated)).toEqual([slug]);
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
		await save(agent, "https://example.com/a");
		await seedInto(harness, queue, "https://example.com/a");

		const onDefault = parse((await agent.get("/queue")).text);
		const onWork = parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text);

		expect(articleIds(onDefault)).toEqual(articleIds(onWork));
		expect(articleIds(onWork)).toHaveLength(1);
	});

	it("marks every copy read from whichever queue the reader was looking at", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, queue, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent
			.post(`/queue/${articleId}/status?feature=queues&queue=${queue}`)
			.type("form")
			.send({ status: "read" });

		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect(articleIds(parse((await agent.get("/queue?tab=done")).text))).toEqual([articleId]);
		const workDone = parse((await agent.get(`/queue?feature=queues&queue=${queue}&tab=done`)).text);
		expect(articleIds(workDone)).toEqual([articleId]);
	});

	it("reverses every copy when the reader marks it unread again", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, queue, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");
		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "unread" });

		expect(cardStatuses(parse((await agent.get("/queue")).text))).toEqual(["unread"]);
		expect(
			cardStatuses(parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text)),
		).toEqual(["unread"]);
	});

	it("deletes one copy without touching the other", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await save(agent, "https://example.com/a");
		await seedInto(harness, queue, "https://example.com/a");
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
		await save(agent, "https://example.com/a");
		await seedInto(harness, queue, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent.post(`/queue/${articleId}/delete?feature=queues&queue=${queue}`);
		expect(dequeued).toEqual([]);

		await agent.post(`/queue/${articleId}/delete`);
		expect(dequeued).toEqual(["https://example.com/a"]);
	});

	it("keeps the link announced when the default copy goes first and a queue still holds it", async () => {
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
		await save(agent, "https://example.com/a");
		await seedInto(harness, queue, "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent.post(`/queue/${articleId}/delete`);
		expect(dequeued).toEqual([]);

		await agent.post(`/queue/${articleId}/delete?feature=queues&queue=${queue}`);
		expect(dequeued).toEqual(["https://example.com/a"]);
	});
});

describe("a queue the reader opened", () => {
	it("lists, counts and paginates only its own saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await save(agent, "https://example.com/default-only");
		await seedInto(harness, queue, "https://example.com/work-only");

		const onWork = parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text);
		expect(
			Array.from(onWork.querySelectorAll("[data-test-article-url]"), (el) => el.textContent),
		).toEqual(["example.com"]);
		expect(articleIds(onWork)).toHaveLength(1);

		const counts = await agent.get(`/queue/counts?feature=queues&queue=${queue}`);
		expect(counts.text).toContain("To Read (1)");
	});

	it("drops the save into the default queue however the request names another", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);

		const response = await saveFrom(agent, queue, "https://example.com/only-here");

		expect(response.headers.location).toBe("/queue?feature=queues#latest-saved");
		expect(articleIds(parse((await agent.get("/queue")).text))).toHaveLength(1);
		expect(articleIds(parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text))).toEqual([]);
	});

	it("hides the save bar and points the empty state at the default queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);

		const onWork = parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text);
		const onDefault = parse((await agent.get("/queue?feature=queues")).text);

		expect(saveFormClasses(onWork)).toContain("queue__save-form--hidden");
		expect(saveFormClasses(onDefault)).toContain("queue__save-form--visible");
		const empty = onWork.querySelector("[data-test-empty-queue]");
		assert(empty, "an untouched queue must render its empty state");
		expect(empty.textContent).toContain("Every link you save lands in My Queue");
	});

	it("opens the owner reader for an article only that queue holds", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await seedInto(harness, queue, "https://example.com/only-here");
		const doc = parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text);
		const readerHref = doc.querySelector("[data-test-article-title]")?.getAttribute("href");
		assert(readerHref, "the card title must link to the reader");
		expect(readerHref).toContain(`queue=${queue}`);

		const response = await agent.get(readerHref);

		expect(response.status).toBe(200);
	});
});

describe("a reader who never turned the queues feature on", () => {
	it("keeps the plain page until they own another queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/a");

		const doc = parse((await agent.get("/queue")).text);

		const main = doc.querySelector("main.queue");
		assert(main, "the queue page must render a main landmark");
		expect(main.className).toBe("queue");
		expect(main.querySelectorAll("[data-test-queue]")).toHaveLength(0);
	});

	it("is offered the rail without the flag once they own another queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await seedInto(harness, queue, "https://example.com/work-only");

		const doc = parse((await agent.get("/queue")).text);

		expect(queueLabels(doc)).toEqual(["My Queue", "New Queue"]);
		const workTab = doc.querySelector(`[data-test-queue="${queue}"]`);
		assert(workTab, "the owned queue must render its tab without the flag");
		expect(workTab.getAttribute("href")).toBe(
			`/queue?queue=${queue}&utm_source=queue-nav&utm_medium=internal&utm_content=queue-${queue}`,
		);

		const onWork = parse((await agent.get(`/queue?queue=${queue}`)).text);
		expect(
			Array.from(onWork.querySelectorAll("[data-test-article-title]"), (el) => el.textContent),
		).toEqual(["https://example.com/work-only"]);
	});

	it("hides the save bar on an owned queue's URL even without the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);

		const doc = parse((await agent.get(`/queue?queue=${queue}`)).text);

		expect(saveFormClasses(doc)).toContain("queue__save-form--hidden");
	});

	it("keeps the save bar on a queue URL that was never minted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueueAndOpen(agent);

		const doc = parse((await agent.get("/queue?queue=never-minted")).text);

		expect(saveFormClasses(doc)).toContain("queue__save-form--visible");
	});

	it("counts and lists only the default queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueueAndOpen(agent);
		await seedInto(harness, queue, "https://example.com/work-only");

		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect((await agent.get("/queue/counts")).text).not.toContain("To Read (1)");
	});
});
