import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
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

async function createReadlist(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function userIdOf(harness: TestHarness) {
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return userId;
}

async function seedInto(harness: TestHarness, readlist: string, url: string) {
	return harness.articleStore.saveReadlistArticle({
		userId: await userIdOf(harness),
		readlist: ReadlistSlugSchema.parse(readlist),
		url,
		metadata: { title: url, siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" },
		savedAt: new Date(),
	});
}

function queueSlugs(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-readlist]"), (el) =>
		el.getAttribute("data-test-readlist"),
	);
}

function deleteReadlist(agent: TestAgent, slug: string) {
	return agent.post(`/queue/queues/${slug}/delete`);
}

function deleteReadlistMovingTo(agent: TestAgent, slug: string, destination: string) {
	return agent
		.post(`/queue/queues/${slug}/delete`)
		.type("form")
		.send({ migrate_to: destination });
}

function deleteReadlistViewing(agent: TestAgent, input: { slug: string; viewed: string }) {
	return agent.post(`/queue/queues/${input.slug}/delete?queue=${input.viewed}`);
}

describe("POST /queue/queues/:slug/delete", () => {
	it("drops the readlist and lands the reader back on the default one they were viewing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await deleteReadlist(agent, slug);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		expect(queueSlugs(parse((await agent.get("/queue")).text))).toEqual(["default"]);
	});

	it("keeps the reader on the readlist they were viewing when another one goes", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const viewed = await createReadlist(agent);
		const deleted = await createReadlist(agent);

		const response = await deleteReadlistViewing(agent, { slug: deleted, viewed });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue?queue=${viewed}`);
		expect(queueSlugs(parse((await agent.get("/queue")).text))).toEqual(["default", viewed]);
	});

	it("sends the reader to the default readlist when the one they were viewing is the one deleted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await deleteReadlistViewing(agent, { slug, viewed: slug });

		expect(response.headers.location).toBe("/queue");
	});

	it("takes the readlist's own rows with it, so nothing is left where no query can reach", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		await seedInto(harness, slug, "https://example.com/only-here");
		const userId = await userIdOf(harness);

		await deleteReadlist(agent, slug);

		const remaining = await harness.articleStore.findReadlistArticles({
			userId,
			readlist: ReadlistSlugSchema.parse(slug),
		});
		expect(remaining.articles).toEqual([]);
	});

	it("clears a readlist holding more rows than one purge page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		for (let index = 0; index < 26; index += 1) {
			await seedInto(harness, slug, `https://example.com/bulk-${index}`);
		}
		const userId = await userIdOf(harness);

		await deleteReadlist(agent, slug);

		const remaining = await harness.articleStore.findReadlistArticles({
			userId,
			readlist: ReadlistSlugSchema.parse(slug),
		});
		expect(remaining.articles).toEqual([]);
	});

	it("leaves the reader's default readlist untouched", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/kept" });
		const slug = await createReadlist(agent);

		await deleteReadlist(agent, slug);

		const doc = parse((await agent.get("/queue")).text);
		expect(
			Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
				el.getAttribute("data-test-article"),
			),
		).toHaveLength(1);
	});

	it("announces the link as dropped once the readlist held the reader's last copy", async () => {
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
		const slug = await createReadlist(agent);
		await seedInto(harness, slug, "https://example.com/only-here");

		await deleteReadlist(agent, slug);

		expect(dequeued).toEqual(["https://example.com/only-here"]);
	});

	it("stays silent while the reader still holds the link in the default readlist", async () => {
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
		const slug = await createReadlist(agent);
		await seedInto(harness, slug, "https://example.com/both");

		await deleteReadlist(agent, slug);

		expect(dequeued).toEqual([]);
	});

	it("refuses the readlist every reader is given, which holds no row to delete", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await deleteReadlist(agent, "default");

		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("refuses a readlist the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await deleteReadlist(agent, "ffffffffffffffff");

		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("refuses a slug no readlist could ever carry", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await deleteReadlist(agent, "NOT A SLUG");

		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("sends a signed-out visitor to the login page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post("/queue/queues/abcdef0123456789/delete");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /queue/queues/:slug/delete with a destination readlist", () => {
	it("hands the readlist's articles to the destination before taking the readlist away", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createReadlist(agent);
		const destination = await createReadlist(agent);
		await seedInto(harness, source, "https://example.com/moved");
		const userId = await userIdOf(harness);

		const response = await deleteReadlistMovingTo(agent, source, destination);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const landed = await harness.articleStore.findReadlistArticles({
			userId,
			readlist: ReadlistSlugSchema.parse(destination),
		});
		expect(landed.articles.map((article) => article.url)).toEqual([
			"https://example.com/moved",
		]);
		expect(queueSlugs(parse((await agent.get("/queue")).text))).toEqual(["default", destination]);
	});

	it("keeps the reader on the destination it moved the articles to when that is the readlist being viewed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createReadlist(agent);
		const destination = await createReadlist(agent);
		await seedInto(harness, source, "https://example.com/moved");

		const response = await deleteReadlistViewing(agent, { slug: source, viewed: destination })
			.type("form")
			.send({ migrate_to: destination });

		expect(response.headers.location).toBe(`/queue?queue=${destination}`);
	});

	it("carries the read state the article had in the readlist it left", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createReadlist(agent);
		const destination = await createReadlist(agent);
		const { saved } = await seedInto(harness, source, "https://example.com/already-read");
		const userId = await userIdOf(harness);
		await harness.articleStore.setReadlistArticleStatus({
			id: saved.id,
			userId,
			readlist: ReadlistSlugSchema.parse(source),
			status: "read",
		});

		await deleteReadlistMovingTo(agent, source, destination);

		const landed = await harness.articleStore.findReadlistArticleById({
			id: saved.id,
			userId,
			readlist: ReadlistSlugSchema.parse(destination),
		});
		expect(landed?.status).toBe("read");
	});

	it("moves a readlist holding more rows than one purge page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createReadlist(agent);
		const destination = await createReadlist(agent);
		for (let index = 0; index < 26; index += 1) {
			await seedInto(harness, source, `https://example.com/bulk-${index}`);
		}
		const userId = await userIdOf(harness);

		await deleteReadlistMovingTo(agent, source, destination);

		expect(
			await harness.articleStore.countReadlistArticles({
				userId,
				readlist: ReadlistSlugSchema.parse(destination),
			}),
		).toBe(26);
		expect(
			await harness.articleStore.countReadlistArticles({
				userId,
				readlist: ReadlistSlugSchema.parse(source),
			}),
		).toBe(0);
	});

	it("says nothing was dropped, because the link is still in a readlist the reader keeps", async () => {
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
		const source = await createReadlist(agent);
		const destination = await createReadlist(agent);
		await seedInto(harness, source, "https://example.com/only-here");

		await deleteReadlistMovingTo(agent, source, destination);

		expect(dequeued).toEqual([]);
	});

	it("refuses the readlist every reader is given as a destination, which already holds every article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createReadlist(agent);
		await seedInto(harness, source, "https://example.com/kept");
		const userId = await userIdOf(harness);

		const response = await deleteReadlistMovingTo(agent, source, "default");

		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
		expect(
			await harness.articleStore.countReadlistArticles({
				userId,
				readlist: ReadlistSlugSchema.parse(source),
			}),
		).toBe(1);
	});

	it("refuses a readlist handing its articles to itself", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createReadlist(agent);

		const response = await deleteReadlistMovingTo(agent, source, source);

		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
		expect(queueSlugs(parse((await agent.get("/queue")).text))).toEqual(["default", source]);
	});

	it("refuses a destination the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createReadlist(agent);

		const response = await deleteReadlistMovingTo(agent, source, "ffffffffffffffff");

		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("deletes as it always did when the reader leaves the articles behind", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const source = await createReadlist(agent);
		const destination = await createReadlist(agent);
		await seedInto(harness, source, "https://example.com/left-behind");
		const userId = await userIdOf(harness);

		await deleteReadlistMovingTo(agent, source, "");

		expect(
			await harness.articleStore.countReadlistArticles({
				userId,
				readlist: ReadlistSlugSchema.parse(destination),
			}),
		).toBe(0);
		expect(queueSlugs(parse((await agent.get("/queue")).text))).toEqual(["default", destination]);
	});
});
