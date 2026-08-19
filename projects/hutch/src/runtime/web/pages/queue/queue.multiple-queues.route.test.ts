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

async function createQueue(agent: TestAgent, label: string) {
	return agent.post("/queue/queues?feature=queues").type("form").send({ label });
}

async function saveInto(agent: TestAgent, queue: string | undefined, url: string) {
	const action = queue === undefined ? "/queue/save" : `/queue/save?feature=queues&queue=${queue}`;
	return agent.post(action).type("form").send({ url });
}

describe("POST /queue/queues", () => {
	it("creates the queue and lands the reader on it, empty and named", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createQueue(agent, "Work Reading");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			"/queue?queue=work-reading&feature=queues&created=work-reading",
		);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(
			Array.from(doc.querySelectorAll("[data-test-queue]"), (el) => el.textContent),
		).toEqual(["My Queue", "Work Reading"]);
		expect(doc.querySelector("[data-test-empty-queue]")).not.toBeNull();
		expect(doc.querySelector("[data-test-queue-created]")?.textContent).toBe(
			"Created Work Reading.",
		);
	});

	it("keeps the label the reader typed and slugs only the address", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createQueue(agent, "  Q&A   reads!!  ");

		expect(response.headers.location).toContain("queue=q-a-reads");
		const doc = parse((await agent.get("/queue?feature=queues")).text);
		expect(
			Array.from(doc.querySelectorAll("[data-test-queue]"), (el) => el.textContent),
		).toEqual(["My Queue", "Q&A   reads!!"]);
	});

	it("refuses a name that would collide with a queue the reader already has", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work Reading");

		const response = await createQueue(agent, "work reading");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			"/queue?feature=queues&create=1&error=name-taken&name=work+reading",
		);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(doc.querySelector("[data-test-queue-create-error]")?.textContent).toBe(
			"You already have a queue with that name.",
		);
		expect(doc.querySelector<HTMLInputElement>(".queue-create__input")?.value).toBe(
			"work reading",
		);
	});

	it("refuses the name of the queue every reader already has", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createQueue(agent, "Default");

		expect(response.headers.location).toContain("error=name-taken");
	});

	it("refuses a name too long to render in full, and one with nothing to address it by", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		for (const label of ["a".repeat(QUEUE_LABEL_MAX_LENGTH + 1), "", "   ", "🎉"]) {
			const response = await createQueue(agent, label);
			expect(response.headers.location).toContain("error=name");
		}
		expect(
			parse((await agent.get("/queue?feature=queues")).text).querySelectorAll("[data-test-queue]"),
		).toHaveLength(1);
	});

	it("stops the reader at the per-account queue cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		for (let index = 0; index < QUEUE_MAX_PER_USER; index += 1) {
			await createQueue(agent, `Queue ${index}`);
		}

		const response = await createQueue(agent, "One too many");

		expect(response.headers.location).toContain("error=limit");
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(doc.querySelector("[data-test-queue-create-error]")?.textContent).toBe(
			`You can keep up to ${QUEUE_MAX_PER_USER} queues.`,
		);
	});

	it("sends a signed-out visitor to log in rather than creating anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/queues")
			.type("form")
			.send({ label: "Work" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("a URL saved into more than one queue", () => {
	it("keeps an independent copy in each queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work");
		await saveInto(agent, undefined, "https://example.com/a");
		await saveInto(agent, "work", "https://example.com/a");

		const onDefault = parse((await agent.get("/queue")).text);
		const onWork = parse((await agent.get("/queue?feature=queues&queue=work")).text);

		expect(articleIds(onDefault)).toEqual(articleIds(onWork));
		expect(articleIds(onWork)).toHaveLength(1);
	});

	it("marks one copy read without touching the other", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work");
		await saveInto(agent, undefined, "https://example.com/a");
		await saveInto(agent, "work", "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent
			.post(`/queue/${articleId}/status?feature=queues&queue=work`)
			.type("form")
			.send({ status: "read" });

		expect(cardStatuses(parse((await agent.get("/queue")).text))).toEqual(["unread"]);
		const workDone = parse((await agent.get("/queue?feature=queues&queue=work&tab=done")).text);
		expect(articleIds(workDone)).toEqual([articleId]);
	});

	it("deletes one copy without touching the other", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work");
		await saveInto(agent, undefined, "https://example.com/a");
		await saveInto(agent, "work", "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		const response = await agent.post(`/queue/${articleId}/delete?feature=queues&queue=work`);

		expect(response.headers.location).toBe("/queue?queue=work&feature=queues");
		expect(articleIds(parse((await agent.get("/queue?feature=queues&queue=work")).text))).toEqual([]);
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
		await createQueue(agent, "Work");
		await saveInto(agent, undefined, "https://example.com/a");
		await saveInto(agent, "work", "https://example.com/a");
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent.post(`/queue/${articleId}/delete?feature=queues&queue=work`);
		expect(dequeued).toEqual([]);

		await agent.post(`/queue/${articleId}/delete`);
		expect(dequeued).toEqual(["https://example.com/a"]);
	});
});

describe("a queue the reader opened", () => {
	it("lists, counts and paginates only its own saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work");
		await saveInto(agent, undefined, "https://example.com/default-only");
		await saveInto(agent, "work", "https://example.com/work-only");

		const onWork = parse((await agent.get("/queue?feature=queues&queue=work")).text);
		expect(
			Array.from(onWork.querySelectorAll("[data-test-article-url]"), (el) => el.textContent),
		).toEqual(["example.com"]);
		expect(articleIds(onWork)).toHaveLength(1);

		const counts = await agent.get("/queue/counts?feature=queues&queue=work");
		expect(counts.text).toContain("To Read (1)");
	});

	it("takes the save bar's link even when the reader never touched the default queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work");

		const response = await saveInto(agent, "work", "https://example.com/only-here");

		expect(response.headers.location).toBe("/queue?queue=work&feature=queues#latest-saved");
		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect(articleIds(parse((await agent.get("/queue?feature=queues&queue=work")).text))).toHaveLength(1);
	});

	it("opens the owner reader for an article only that queue holds", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work");
		await saveInto(agent, "work", "https://example.com/only-here");
		const doc = parse((await agent.get("/queue?feature=queues&queue=work")).text);
		const readerHref = doc.querySelector("[data-test-article-title]")?.getAttribute("href");
		assert(readerHref, "the card title must link to the reader");
		expect(readerHref).toContain("queue=work");

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

		await createQueue(agent, "Work");
		await saveInto(agent, "work", "https://example.com/work-only");

		const after = parse((await agent.get("/queue")).text);
		expect(mainMarkup(after)).toBe(mainMarkup(before));
	});

	it("is never offered the rail or the create control", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work");

		const doc = parse((await agent.get("/queue?create=1")).text);

		expect(doc.querySelector("[data-test-queue-nav]")).toBeNull();
		expect(doc.querySelector("[data-test-queue-create]")).toBeNull();
		expect(doc.querySelector("main.queue")?.className).toBe("queue");
	});

	it("counts and lists only the default queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createQueue(agent, "Work");
		await saveInto(agent, "work", "https://example.com/work-only");

		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect((await agent.get("/queue/counts")).text).not.toContain("To Read (1)");
	});
});
