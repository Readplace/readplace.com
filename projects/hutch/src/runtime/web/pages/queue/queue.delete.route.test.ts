import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { QueueSlugSchema } from "@packages/domain/queue";
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

async function createQueue(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues?feature=queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a queue must land the reader on it");
	return slug;
}

async function userIdOf(harness: TestHarness) {
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return userId;
}

async function seedInto(harness: TestHarness, queue: string, url: string) {
	return harness.articleStore.saveQueueArticle({
		userId: await userIdOf(harness),
		queue: QueueSlugSchema.parse(queue),
		url,
		metadata: { title: url, siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" },
		savedAt: new Date(),
	});
}

function queueSlugs(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-queue]"), (el) =>
		el.getAttribute("data-test-queue"),
	);
}

function deleteQueue(agent: TestAgent, slug: string) {
	return agent.post(`/queue/queues/${slug}/delete?feature=queues`);
}

function deleteQueueMovingTo(agent: TestAgent, slug: string, destination: string) {
	return agent
		.post(`/queue/queues/${slug}/delete?feature=queues`)
		.type("form")
		.send({ migrate_to: destination });
}

describe("POST /queue/queues/:slug/delete", () => {
	it("drops the queue and lands the reader back on the default one", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createQueue(agent);

		const response = await deleteQueue(agent, slug);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?feature=queues");
		expect(queueSlugs(parse((await agent.get("/queue?feature=queues")).text))).toEqual([
			"default",
		]);
	});

	it("takes the queue's own rows with it, so nothing is left where no query can reach", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createQueue(agent);
		await seedInto(harness, slug, "https://example.com/only-here");
		const userId = await userIdOf(harness);

		await deleteQueue(agent, slug);

		const remaining = await harness.articleStore.findQueueArticles({
			userId,
			queue: QueueSlugSchema.parse(slug),
		});
		expect(remaining.articles).toEqual([]);
	});

	it("clears a queue holding more rows than one purge page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createQueue(agent);
		for (let index = 0; index < 26; index += 1) {
			await seedInto(harness, slug, `https://example.com/bulk-${index}`);
		}
		const userId = await userIdOf(harness);

		await deleteQueue(agent, slug);

		const remaining = await harness.articleStore.findQueueArticles({
			userId,
			queue: QueueSlugSchema.parse(slug),
		});
		expect(remaining.articles).toEqual([]);
	});

	it("leaves the reader's default queue untouched", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/kept" });
		const slug = await createQueue(agent);

		await deleteQueue(agent, slug);

		const doc = parse((await agent.get("/queue")).text);
		expect(
			Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
				el.getAttribute("data-test-article"),
			),
		).toHaveLength(1);
	});

	it("announces the link as dropped once the queue held the reader's last copy", async () => {
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
		const slug = await createQueue(agent);
		await seedInto(harness, slug, "https://example.com/only-here");

		await deleteQueue(agent, slug);

		expect(dequeued).toEqual(["https://example.com/only-here"]);
	});

	it("stays silent while the reader still holds the link in the default queue", async () => {
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
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/both" });
		const slug = await createQueue(agent);
		await seedInto(harness, slug, "https://example.com/both");

		await deleteQueue(agent, slug);

		expect(dequeued).toEqual([]);
	});

	it("refuses the queue every reader is given, which holds no row to delete", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await deleteQueue(agent, "default");

		expect(response.headers.location).toBe("/queue?feature=queues&queue_error=unknown_queue");
	});

	it("refuses a queue the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await deleteQueue(agent, "ffffffffffffffff");

		expect(response.headers.location).toBe("/queue?feature=queues&queue_error=unknown_queue");
	});

	it("refuses a slug no queue could ever carry", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await deleteQueue(agent, "NOT A SLUG");

		expect(response.headers.location).toBe("/queue?feature=queues&queue_error=unknown_queue");
	});

	it("is unreachable for a reader who owns no queue and never asked for the feature", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/queues/abcdef0123456789/delete");

		expect(response.status).toBe(404);
	});

	it("stays reachable without the flag once the reader owns a queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createQueue(agent);

		const response = await agent.post(`/queue/queues/${slug}/delete`);

		expect(response.headers.location).toBe("/queue");
		expect(queueSlugs(parse((await agent.get("/queue?feature=queues")).text))).toEqual([
			"default",
		]);
	});

	it("sends a signed-out visitor to the login page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post("/queue/queues/abcdef0123456789/delete");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /queue/queues/:slug/delete with a destination queue", () => {
	it("hands the queue's articles to the destination before taking the queue away", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createQueue(agent);
		const destination = await createQueue(agent);
		await seedInto(harness, source, "https://example.com/moved");
		const userId = await userIdOf(harness);

		const response = await deleteQueueMovingTo(agent, source, destination);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?feature=queues");
		const landed = await harness.articleStore.findQueueArticles({
			userId,
			queue: QueueSlugSchema.parse(destination),
		});
		expect(landed.articles.map((article) => article.url)).toEqual([
			"https://example.com/moved",
		]);
		expect(queueSlugs(parse((await agent.get("/queue?feature=queues")).text))).toEqual([
			"default",
			destination,
		]);
	});

	it("carries the read state the article had in the queue it left", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createQueue(agent);
		const destination = await createQueue(agent);
		const { saved } = await seedInto(harness, source, "https://example.com/already-read");
		const userId = await userIdOf(harness);
		await harness.articleStore.updateQueueArticleStatus({
			id: saved.id,
			userId,
			queue: QueueSlugSchema.parse(source),
			status: "read",
		});

		await deleteQueueMovingTo(agent, source, destination);

		const landed = await harness.articleStore.findQueueArticleById({
			id: saved.id,
			userId,
			queue: QueueSlugSchema.parse(destination),
		});
		expect(landed?.status).toBe("read");
	});

	it("moves a queue holding more rows than one purge page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createQueue(agent);
		const destination = await createQueue(agent);
		for (let index = 0; index < 26; index += 1) {
			await seedInto(harness, source, `https://example.com/bulk-${index}`);
		}
		const userId = await userIdOf(harness);

		await deleteQueueMovingTo(agent, source, destination);

		expect(
			await harness.articleStore.countQueueArticles({
				userId,
				queue: QueueSlugSchema.parse(destination),
			}),
		).toBe(26);
		expect(
			await harness.articleStore.countQueueArticles({
				userId,
				queue: QueueSlugSchema.parse(source),
			}),
		).toBe(0);
	});

	it("says nothing was dropped, because the link is still in a queue the reader keeps", async () => {
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
		const source = await createQueue(agent);
		const destination = await createQueue(agent);
		await seedInto(harness, source, "https://example.com/only-here");

		await deleteQueueMovingTo(agent, source, destination);

		expect(dequeued).toEqual([]);
	});

	it("refuses the queue every reader is given as a destination, which already holds every article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createQueue(agent);
		await seedInto(harness, source, "https://example.com/kept");
		const userId = await userIdOf(harness);

		const response = await deleteQueueMovingTo(agent, source, "default");

		expect(response.headers.location).toBe("/queue?feature=queues&queue_error=unknown_queue");
		expect(
			await harness.articleStore.countQueueArticles({
				userId,
				queue: QueueSlugSchema.parse(source),
			}),
		).toBe(1);
	});

	it("refuses a queue handing its articles to itself", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createQueue(agent);

		const response = await deleteQueueMovingTo(agent, source, source);

		expect(response.headers.location).toBe("/queue?feature=queues&queue_error=unknown_queue");
		expect(queueSlugs(parse((await agent.get("/queue?feature=queues")).text))).toEqual([
			"default",
			source,
		]);
	});

	it("refuses a destination the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createQueue(agent);

		const response = await deleteQueueMovingTo(agent, source, "ffffffffffffffff");

		expect(response.headers.location).toBe("/queue?feature=queues&queue_error=unknown_queue");
	});

	it("deletes as it always did when the reader leaves the articles behind", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createQueue(agent);
		const destination = await createQueue(agent);
		await seedInto(harness, source, "https://example.com/left-behind");
		const userId = await userIdOf(harness);

		await deleteQueueMovingTo(agent, source, "");

		expect(
			await harness.articleStore.countQueueArticles({
				userId,
				queue: QueueSlugSchema.parse(destination),
			}),
		).toBe(0);
		expect(queueSlugs(parse((await agent.get("/queue?feature=queues")).text))).toEqual([
			"default",
			destination,
		]);
	});
});
