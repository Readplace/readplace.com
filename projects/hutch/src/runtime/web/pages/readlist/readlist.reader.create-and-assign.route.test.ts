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

async function createReadlist(agent: TestAgent): Promise<void> {
	await agent.post("/queue/queues");
}

async function openReader(agent: TestAgent, articleId: string): Promise<Document> {
	const response = await agent.get(`/queue/${articleId}/view`);
	expect(response.status).toBe(200);
	return parse(response.text);
}

function readlistTagLabels(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-readlist-tag]"), (el) =>
		(el.firstChild?.textContent ?? "").trim(),
	);
}

function pickerOptions(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-assign-readlist]"), (el) =>
		el.getAttribute("data-test-assign-readlist"),
	);
}

function createRow(doc: Document): Element | null {
	return doc.querySelector('[data-test-readlists-row="create"]');
}

async function createAndAssign(params: {
	agent: TestAgent;
	articleId: string;
	label: string;
}): Promise<request.Response> {
	return params.agent
		.post(`/queue/${params.articleId}/create-and-assign`)
		.type("form")
		.send({ label: params.label, returnTo: `/queue/${params.articleId}/view` });
}

describe("the reader's inline create-a-readlist control", () => {
	it("creates the named readlist, files the article into it, and returns to the reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await createAndAssign({ agent, articleId, label: "Reading" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);

		const reader = await openReader(agent, articleId);
		expect(readlistTagLabels(reader)).toEqual(["Reading"]);
		expect(pickerOptions(reader)).toEqual([]);
		assert(createRow(reader), "the create row stays available under the cap");
	});

	it("files into the readlist that already carries the typed name, whatever its casing, without duplicating it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await createAndAssign({ agent, articleId, label: "Work" });

		await createAndAssign({ agent, articleId, label: "work" });

		const reader = await openReader(agent, articleId);
		expect(readlistTagLabels(reader)).toEqual(["Work"]);
		expect(pickerOptions(reader)).toEqual([]);
	});

	it("refuses the built-in readlist's name and writes nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await createAndAssign({ agent, articleId, label: "All" });

		expect(response.status).toBe(303);
		const reader = await openReader(agent, articleId);
		expect(readlistTagLabels(reader)).toEqual([]);
		expect(pickerOptions(reader)).toEqual([]);
	});

	it("writes nothing for a name that is only whitespace", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await createAndAssign({ agent, articleId, label: "   " });

		expect(response.status).toBe(303);
		expect(readlistTagLabels(await openReader(agent, articleId))).toEqual([]);
	});

	it("writes nothing — not even an empty readlist — once the default copy is gone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await agent.post(`/queue/${articleId}/delete`);

		const response = await createAndAssign({ agent, articleId, label: "Later" });
		expect(response.status).toBe(303);

		const otherId = await saveArticle(agent, "https://example.com/b");
		expect(pickerOptions(await openReader(agent, otherId))).toEqual([]);
	});

	it("404s an unparseable article id", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/queue/not-an-id/create-and-assign")
			.type("form")
			.send({ label: "Later", returnTo: "/queue/not-an-id/view" });

		expect(response.status).toBe(404);
	});

	it("refuses to mint an eighth readlist, returning to the reader with nothing filed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		for (let created = 0; created < 7; created += 1) await createReadlist(agent);
		const articleId = await saveArticle(agent, "https://example.com/a");
		expect(pickerOptions(await openReader(agent, articleId))).toHaveLength(7);

		const response = await createAndAssign({ agent, articleId, label: "Eighth" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
		const reader = await openReader(agent, articleId);
		expect(pickerOptions(reader)).toHaveLength(7);
		expect(readlistTagLabels(reader)).toEqual([]);
	});

	it("sends a signed-out visitor to log in rather than creating anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/ffffffffffffffffffffffffffffffff/create-and-assign")
			.type("form")
			.send({ label: "Later", returnTo: "/queue" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("refuses a read-only visitor with the inactive redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const email = "readonly-create@example.com";
		await harness.auth.createUser({ email, password: "password123" });
		const lookup = await harness.auth.findUserByEmail(email);
		assert(lookup, "the read-only user must exist");
		const agent = request.agent(harness.server);
		await agent.post("/login").type("form").send({ email, password: "password123" });
		await harness.subscriptionProviders.upsertActive({
			userId: lookup.userId,
			subscriptionId: "sub_readonly",
			customerId: "cus_readonly",
		});
		await harness.subscriptionProviders.markCancelledByUserId({ userId: lookup.userId });

		const response = await agent
			.post("/queue/ffffffffffffffffffffffffffffffff/create-and-assign")
			.type("form")
			.send({ label: "Later", returnTo: "/queue/ffffffffffffffffffffffffffffffff/view" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});
});
