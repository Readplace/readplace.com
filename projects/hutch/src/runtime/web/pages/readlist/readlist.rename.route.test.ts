import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
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
	const response = await agent.post("/queue/queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it, ready to name");
	return slug;
}

async function renameReadlist(agent: TestAgent, slug: string, label: string) {
	return agent.post(`/queue/queues/${slug}/rename`).type("form").send({ label });
}

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

async function renameFromBrowser(agent: TestAgent, slug: string, label: string) {
	return agent
		.post(`/queue/queues/${slug}/rename`)
		.set("Accept", BROWSER_ACCEPT)
		.type("form")
		.send({ label });
}

function readlistTab(doc: Document, slug: string): Element {
	const tab = doc.querySelector(`[data-test-readlist="${slug}"]`);
	assert(tab, `the ${slug} readlist must render a tab`);
	return tab;
}

describe("POST /queue/queues/:slug/rename", () => {
	it("takes the name the reader typed and keeps the readlist where it was", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);

		const response = await renameReadlist(agent, readlist, "Work Reading");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ slug: readlist, label: "Work Reading" });
		const doc = parse((await agent.get("/queue")).text);
		const tab = readlistTab(doc, readlist);
		expect(tab.textContent).toBe("Work Reading");
		expect(tab.getAttribute("href")).toContain(`queue=${readlist}`);
	});

	it("trims the name before storing it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);

		const response = await renameReadlist(agent, readlist, "   Deep Work   ");

		expect(response.body.label).toBe("Deep Work");
		expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
			"Deep Work",
		);
	});

	it("lets a readlist keep the name it already has, rather than numbering it against itself", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);
		await renameReadlist(agent, readlist, "Work Reading");

		const response = await renameReadlist(agent, readlist, "Work Reading");

		expect(response.status).toBe(200);
		expect(response.body.label).toBe("Work Reading");
	});

	it("numbers a name the reader's other readlist already carries", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createReadlist(agent);
		await renameReadlist(agent, first, "Work Reading");
		const second = await createReadlist(agent);

		const response = await renameReadlist(agent, second, "Work Reading");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ slug: second, label: "Work Reading 2" });
		const doc = parse((await agent.get("/queue")).text);
		expect(readlistTab(doc, first).textContent).toBe("Work Reading");
		expect(readlistTab(doc, second).textContent).toBe("Work Reading 2");
		expect(readlistTab(doc, first).getAttribute("href")).not.toBe(
			readlistTab(doc, second).getAttribute("href"),
		);
	});

	it("hands back the name it stored, so the tab can show what actually landed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createReadlist(agent);
		await renameReadlist(agent, first, "Work Reading");
		const second = await createReadlist(agent);

		const response = await renameReadlist(agent, second, "Work Reading");

		expect(response.body.label).toBe("Work Reading 2");
		const doc = parse((await agent.get("/queue")).text);
		expect(readlistTab(doc, second).textContent).toBe("Work Reading 2");
	});

	it("matches a taken name whatever its capitalisation, storing the casing the reader typed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createReadlist(agent);
		await renameReadlist(agent, first, "Work");
		const second = await createReadlist(agent);

		const response = await renameReadlist(agent, second, "work");

		expect(response.status).toBe(200);
		expect(response.body.label).toBe("work 2");
	});

	it("refuses a name with no room left for the number that tells it apart", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const longest = "a".repeat(READLIST_LABEL_MAX_LENGTH);
		const first = await createReadlist(agent);
		await renameReadlist(agent, first, longest);
		const second = await createReadlist(agent);

		const response = await renameReadlist(agent, second, longest);

		expect(response.status).toBe(422);
		expect(response.body.error).toBe("name-taken");
	});

	it("numbers a name the built-in readlist carries", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);

		const response = await renameReadlist(agent, readlist, "All");

		expect(response.status).toBe(200);
		expect(
			Array.from(
				parse((await agent.get("/queue")).text).querySelectorAll(
					"[data-test-readlist]",
				),
				(el) => el.textContent,
			),
		).toEqual(["All", "All 2"]);
	});

	it("refuses a name too long to render in full", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);

		const response = await renameReadlist(agent, readlist, "a".repeat(READLIST_LABEL_MAX_LENGTH + 1));

		expect(response.status).toBe(422);
		expect(response.body).toEqual({
			error: "invalid-name",
			message: `Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.`,
		});
	});

	it("refuses a name emptied of everything but spaces", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);

		const response = await renameReadlist(agent, readlist, "   ");

		expect(response.status).toBe(422);
		expect(response.body.error).toBe("invalid-name");
	});

	it("takes a name made only of emoji, which the readlist's own id addresses", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);

		const response = await renameReadlist(agent, readlist, "🎉🎉");

		expect(response.status).toBe(200);
		expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
			"🎉🎉",
		);
	});

	it("does not rename a readlist the reader does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameReadlist(agent, "ffffffffffffffff", "Mine");

		expect(response.status).toBe(404);
		expect(response.body).toEqual({
			error: "unknown-readlist",
			message: "That readlist no longer exists.",
		});
	});

	it("does not rename the readlist every reader is given", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameReadlist(agent, "default", "Everything");

		expect(response.status).toBe(404);
		expect(response.body.error).toBe("unknown-readlist");
	});

	it("does not rename a readlist whose address could never have been minted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameReadlist(agent, "Not A Slug", "Mine");

		expect(response.status).toBe(404);
		expect(response.body.error).toBe("unknown-readlist");
	});

	it("reports the readlist gone when it disappears between the check and the write", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				renameReadlistDefinition: async () => ({ renamed: false }),
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent);

		const response = await renameReadlist(agent, readlist, "Work Reading");

		expect(response.status).toBe(404);
		expect(response.body.error).toBe("unknown-readlist");
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

	describe("without JavaScript, when the browser asks for HTML", () => {
		it("redirects back to the renamed readlist so the form submit lands on a page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent);

			const response = await renameFromBrowser(agent, readlist, "Work Reading");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue?queue=${readlist}`);
			expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
				"Work Reading",
			);
		});

		it("renames through the plain form the menu offers a no-popover browser", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent);

			const menu = parse((await agent.get("/queue")).text).querySelector(
				`[data-test-readlist-menu="${readlist}"]`,
			);
			assert(menu, "the custom readlist must carry its menu in the rail");
			const form = menu.querySelector('form[data-test-form="readlist-rename-fallback"]');
			assert(form, "a no-popover browser must find a plain rename form in the menu");
			const action = form.getAttribute("action");
			assert(action, "the fallback form must post somewhere");
			const input = form.querySelector("[data-test-readlist-rename-fallback-input]");
			assert(input, "the fallback form must carry a name field");
			const field = input.getAttribute("name");
			assert(field, "the name field must be named");
			const target = new URL(action, TEST_APP_ORIGIN);

			const response = await agent
				.post(`${target.pathname}${target.search}`)
				.set("Accept", BROWSER_ACCEPT)
				.type("form")
				.send({ [field]: "Deep Work" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue?queue=${readlist}`);
			expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
				"Deep Work",
			);
		});

		it("redirects a refused name back to the readlist instead of answering JSON", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent);

			const response = await renameFromBrowser(
				agent,
				readlist,
				"a".repeat(READLIST_LABEL_MAX_LENGTH + 1),
			);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/queue?queue=${readlist}&queue_error=rename_invalid-name`,
			);
		});

		it("redirects an unknown readlist to a page rather than a 404 body", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await renameFromBrowser(agent, "ffffffffffffffff", "Mine");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?queue_error=rename_unknown-readlist");
		});
	});

	describe("for a non-browser client", () => {
		it("keeps the JSON rejection when the client sends an Accept that names neither HTML nor JSON", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/queue/queues/ffffffffffffffff/rename")
				.set("Accept", "text/plain")
				.type("form")
				.send({ label: "Mine" });

			expect(response.status).toBe(404);
			expect(response.body.error).toBe("unknown-readlist");
		});

		it("keeps the JSON success body for a client that asks for JSON", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent);

			const response = await agent
				.post(`/queue/queues/${readlist}/rename`)
				.set("Accept", "application/json")
				.type("form")
				.send({ label: "Work Reading" });

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ slug: readlist, label: "Work Reading" });
		});
	});
});
