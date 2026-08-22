import assert from "node:assert/strict";
import { QUEUE_LABEL_MAX_LENGTH } from "@packages/domain/queue";
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
	assert(slug, "creating a queue must land the reader on it, ready to name");
	return slug;
}

async function renameQueue(agent: TestAgent, slug: string, label: string) {
	return agent
		.post(`/queue/queues/${slug}/rename?feature=queues`)
		.type("form")
		.send({ label });
}

function queueTab(doc: Document, slug: string): Element {
	const tab = doc.querySelector(`[data-test-queue="${slug}"]`);
	assert(tab, `the ${slug} queue must render a tab`);
	return tab;
}

describe("POST /queue/queues/:slug/rename", () => {
	it("takes the name the reader typed and keeps the queue where it was", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);

		const response = await renameQueue(agent, queue, "Work Reading");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ slug: queue, label: "Work Reading" });
		const doc = parse((await agent.get("/queue?feature=queues")).text);
		const tab = queueTab(doc, queue);
		expect(tab.textContent).toBe("Work Reading");
		expect(tab.getAttribute("href")).toContain(`queue=${queue}`);
	});

	it("trims the name before storing it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);

		const response = await renameQueue(agent, queue, "   Deep Work   ");

		expect(response.body.label).toBe("Deep Work");
		expect(queueTab(parse((await agent.get("/queue?feature=queues")).text), queue).textContent).toBe(
			"Deep Work",
		);
	});

	it("lets a queue keep the name it already has, rather than numbering it against itself", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);
		await renameQueue(agent, queue, "Work Reading");

		const response = await renameQueue(agent, queue, "Work Reading");

		expect(response.status).toBe(200);
		expect(response.body.label).toBe("Work Reading");
	});

	it("numbers a name the reader's other queue already carries", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createQueue(agent);
		await renameQueue(agent, first, "Work Reading");
		const second = await createQueue(agent);

		const response = await renameQueue(agent, second, "Work Reading");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ slug: second, label: "Work Reading 2" });
		const doc = parse((await agent.get("/queue?feature=queues")).text);
		expect(queueTab(doc, first).textContent).toBe("Work Reading");
		expect(queueTab(doc, second).textContent).toBe("Work Reading 2");
		expect(queueTab(doc, first).getAttribute("href")).not.toBe(
			queueTab(doc, second).getAttribute("href"),
		);
	});

	it("hands back the name it stored, so the tab can show what actually landed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createQueue(agent);
		await renameQueue(agent, first, "Work Reading");
		const second = await createQueue(agent);

		const response = await renameQueue(agent, second, "Work Reading");

		expect(response.body.label).toBe("Work Reading 2");
		const doc = parse((await agent.get("/queue?feature=queues")).text);
		expect(queueTab(doc, second).textContent).toBe("Work Reading 2");
	});

	it("matches a taken name whatever its capitalisation, storing the casing the reader typed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createQueue(agent);
		await renameQueue(agent, first, "Work");
		const second = await createQueue(agent);

		const response = await renameQueue(agent, second, "work");

		expect(response.status).toBe(200);
		expect(response.body.label).toBe("work 2");
	});

	it("refuses a name with no room left for the number that tells it apart", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const longest = "a".repeat(QUEUE_LABEL_MAX_LENGTH);
		const first = await createQueue(agent);
		await renameQueue(agent, first, longest);
		const second = await createQueue(agent);

		const response = await renameQueue(agent, second, longest);

		expect(response.status).toBe(422);
		expect(response.body.error).toBe("name-taken");
	});

	it("numbers a name the built-in queue carries", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);

		const response = await renameQueue(agent, queue, "My Queue");

		expect(response.status).toBe(200);
		expect(
			Array.from(
				parse((await agent.get("/queue?feature=queues")).text).querySelectorAll(
					"[data-test-queue]",
				),
				(el) => el.textContent,
			),
		).toEqual(["My Queue", "My Queue 2"]);
	});

	it("refuses a name too long to render in full", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);

		const response = await renameQueue(agent, queue, "a".repeat(QUEUE_LABEL_MAX_LENGTH + 1));

		expect(response.status).toBe(422);
		expect(response.body).toEqual({
			error: "invalid-name",
			message: `Give the queue a name of ${QUEUE_LABEL_MAX_LENGTH} characters or fewer.`,
		});
	});

	it("refuses a name emptied of everything but spaces", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);

		const response = await renameQueue(agent, queue, "   ");

		expect(response.status).toBe(422);
		expect(response.body.error).toBe("invalid-name");
	});

	it("takes a name made only of emoji, which the queue's own id addresses", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);

		const response = await renameQueue(agent, queue, "🎉🎉");

		expect(response.status).toBe(200);
		expect(queueTab(parse((await agent.get("/queue?feature=queues")).text), queue).textContent).toBe(
			"🎉🎉",
		);
	});

	it("does not rename a queue the reader does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameQueue(agent, "ffffffffffffffff", "Mine");

		expect(response.status).toBe(404);
		expect(response.body).toEqual({
			error: "unknown-queue",
			message: "That queue no longer exists.",
		});
	});

	it("does not rename the queue every reader is given", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameQueue(agent, "default", "Everything");

		expect(response.status).toBe(404);
		expect(response.body.error).toBe("unknown-queue");
	});

	it("does not rename a queue whose address could never have been minted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameQueue(agent, "Not A Slug", "Mine");

		expect(response.status).toBe(404);
		expect(response.body.error).toBe("unknown-queue");
	});

	it("reports the queue gone when it disappears between the check and the write", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				renameQueueDefinition: async () => ({ renamed: false }),
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);

		const response = await renameQueue(agent, queue, "Work Reading");

		expect(response.status).toBe(404);
		expect(response.body.error).toBe("unknown-queue");
	});

	it("does not exist for a reader who never turned the queues feature on", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const queue = await createQueue(agent);

		const response = await agent
			.post(`/queue/queues/${queue}/rename`)
			.type("form")
			.send({ label: "Work Reading" });

		expect(response.status).toBe(404);
		expect(response.body.error).toBe("unknown-queue");
		expect(queueTab(parse((await agent.get("/queue?feature=queues")).text), queue).textContent).toBe(
			"New Queue",
		);
	});

	it("sends a signed-out visitor to log in rather than renaming anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/queues/ffffffffffffffff/rename")
			.type("form")
			.send({ label: "Work" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});
