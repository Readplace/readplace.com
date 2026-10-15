import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { z } from "zod";
import { loginAgent, useTestServer } from "../../../test-app";
import { READLIST_LIMIT_MESSAGE } from "./readlist.error";

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

async function createReadlist(agent: TestAgent, label: string): Promise<void> {
	await agent.post("/queue/queues").type("form").send({ label });
}

async function openReader(agent: TestAgent, articleId: string): Promise<Document> {
	const response = await agent.get(`/queue/${articleId}/view`);
	expect(response.status).toBe(200);
	return parse(response.text);
}

function readlistTagLabels(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-reader-tags] [data-test-readlist-tag]"), (el) =>
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
	htmx?: boolean;
}): Promise<request.Response> {
	const post = params.agent.post(`/queue/${params.articleId}/create-and-assign`).type("form");
	return (params.htmx === true ? post.set("HX-Request", "true") : post).send({
		label: params.label,
		returnTo: `/queue/${params.articleId}/view`,
	});
}

function filedFlash(location: string): { path: string; filed: string | null } {
	const landing = new URL(location, TEST_APP_ORIGIN);
	return { path: landing.pathname, filed: landing.searchParams.get("filed_readlist") };
}

function toastMessage(doc: Document): string | null | undefined {
	const mount = doc.querySelector("main #status-toast");
	assert(mount, "the reader must carry the status toast mount");
	return mount.querySelector("[data-test-toast-message]")?.textContent;
}

const HxLocationSchema = z
	.object({ path: z.string(), source: z.string(), target: z.string(), select: z.string(), swap: z.string() })
	.strict();

function hxLocation(response: { headers: Record<string, string> }): z.infer<typeof HxLocationSchema> {
	const header = response.headers["hx-location"];
	assert(header, "the dialog's answer must tell htmx where to land");
	return HxLocationSchema.parse(JSON.parse(header));
}

describe("the reader's inline create-a-readlist control", () => {
	it("creates the named readlist, files the article into it, and returns to the reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await createAndAssign({ agent, articleId, label: "Reading" });

		expect(response.status).toBe(303);
		const landing = filedFlash(response.headers.location);
		expect(landing.path).toBe(`/queue/${articleId}/view`);
		const reader = parse((await agent.get(response.headers.location)).text);
		expect(readlistTagLabels(reader)).toEqual(["Reading"]);
		expect(Array.from(reader.querySelectorAll("[data-test-reader-tags] [data-test-readlist-tag]"), (tag) =>
			tag.getAttribute("data-test-readlist-tag"),
		)).toEqual([landing.filed]);
		expect(toastMessage(reader)).toBe("Added to Reading");
		expect(pickerOptions(reader)).toEqual([]);
		assert(createRow(reader), "the create row stays available under the cap");
	});

	it("flashes the filing into a readlist that already carried the typed name", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent, "Deep Work");
		const articleId = await saveArticle(agent, "https://example.com/a");
		const [deepWork] = pickerOptions(await openReader(agent, articleId));

		const response = await createAndAssign({ agent, articleId, label: "deep work" });

		expect(response.status).toBe(303);
		expect(filedFlash(response.headers.location)).toEqual({ path: `/queue/${articleId}/view`, filed: deepWork });
		expect(toastMessage(parse((await agent.get(response.headers.location)).text))).toBe("Added to Deep Work");
	});

	it("files into the readlist that already carries the typed name, whatever its casing, without duplicating it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await createAndAssign({ agent, articleId, label: "Work" });

		const again = await createAndAssign({ agent, articleId, label: "work" });

		expect(again.headers.location).toBe(`/queue/${articleId}/view`);
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
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
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
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
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
		for (let created = 1; created <= 7; created += 1) await createReadlist(agent, `Readlist ${created}`);
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

describe("the reader's create dialog, posted through htmx", () => {
	it("lands back on the reader where it was, carrying the filing flash", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await createAndAssign({ agent, articleId, label: "Reading", htmx: true });

		expect(response.status).toBe(204);
		const location = hxLocation(response);
		const landing = filedFlash(location.path);
		assert(landing.filed, "a created readlist must flash the filing");
		expect(location).toEqual({
			path: `/queue/${articleId}/view?filed_readlist=${landing.filed}`,
			source: "#reader-readlist-create",
			target: "main",
			select: "main",
			swap: "outerHTML show:none",
		});
		expect(toastMessage(parse((await agent.get(location.path)).text))).toBe("Added to Reading");
	});

	it("re-renders the dialog's form with the typed name and the reason for a refused name, writing nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const answers = [];
		for (const label of ["All", "   "]) {
			const response = await createAndAssign({ agent, articleId, label, htmx: true });
			const form = parse(response.text).querySelector('form[data-test-form="readlist-create"]');
			assert(form, "a refused name must answer with the dialog's form");
			const input = form.querySelector("[data-test-readlist-create-input]");
			assert(input, "the re-rendered form must carry the name field");
			answers.push({
				status: response.status,
				action: form.getAttribute("action"),
				fields: Array.from(form.querySelectorAll("input, label"), (field) =>
					field.tagName === "LABEL" ? "label" : `${field.getAttribute("type")}:${field.getAttribute("name")}`,
				),
				returnTo: form.querySelector("input[name='returnTo']")?.getAttribute("value"),
				value: input.getAttribute("value"),
				invalid: input.getAttribute("aria-invalid"),
				error: form.querySelector("[data-test-readlist-create-error]")?.textContent,
			});
		}

		const refused = {
			status: 422,
			action: `/queue/${articleId}/create-and-assign`,
			fields: ["hidden:returnTo", "label", "text:label"],
			returnTo: `/queue/${articleId}/view`,
			invalid: "true",
		};
		expect(answers).toEqual([
			{ ...refused, value: "All", error: "Pick a name other than All, the readlist that holds every save." },
			{ ...refused, value: "   ", error: `Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.` },
		]);
		expect(readlistTagLabels(await openReader(agent, articleId))).toEqual([]);
	});

	it("files into the readlist that already carries the typed name, landing back on the reader with the filing flash", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent, "Deep Work");
		const articleId = await saveArticle(agent, "https://example.com/a");
		const [deepWork] = pickerOptions(await openReader(agent, articleId));

		const response = await createAndAssign({ agent, articleId, label: "deep work", htmx: true });

		expect(response.status).toBe(204);
		expect(hxLocation(response)).toEqual({
			path: `/queue/${articleId}/view?filed_readlist=${deepWork}`,
			source: "#reader-readlist-create",
			target: "main",
			select: "main",
			swap: "outerHTML show:none",
		});
		const reader = parse((await agent.get(hxLocation(response).path)).text);
		expect(toastMessage(reader)).toBe("Added to Deep Work");
		expect(readlistTagLabels(reader)).toEqual(["Deep Work"]);
		expect(pickerOptions(reader)).toEqual([]);
	});

	it("refuses a dialog that posts no name as an empty one, writing nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await agent
			.post(`/queue/${articleId}/create-and-assign`)
			.type("form")
			.set("HX-Request", "true")
			.send({ returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(422);
		expect(parse(response.text).querySelector("[data-test-readlist-create-error]")?.textContent).toBe(
			`Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.`,
		);
		expect(readlistTagLabels(await openReader(agent, articleId))).toEqual([]);
	});

	it("refuses an eighth readlist in the dialog, naming the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		for (let created = 1; created <= 7; created += 1) await createReadlist(agent, `Readlist ${created}`);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await createAndAssign({ agent, articleId, label: "Eighth", htmx: true });

		expect(response.status).toBe(422);
		expect(parse(response.text).querySelector("[data-test-readlist-create-error]")?.textContent).toBe(
			READLIST_LIMIT_MESSAGE,
		);
		expect(pickerOptions(await openReader(agent, articleId))).toHaveLength(7);
	});

	it("sends the dialog to the top of the return path for an article the reader no longer holds", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");
		await agent.post(`/queue/${articleId}/delete`);

		const response = await createAndAssign({ agent, articleId, label: "Later", htmx: true });

		expect(response.status).toBe(204);
		expect(hxLocation(response)).toEqual({
			path: `/queue/${articleId}/view`,
			source: "#reader-readlist-create",
			target: "main",
			select: "main",
			swap: "outerHTML show:none scroll:html:top",
		});
	});

	it("404s an unparseable article id without answering the dialog", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/queue/not-an-id/create-and-assign")
			.type("form")
			.set("HX-Request", "true")
			.send({ label: "Later", returnTo: "/queue/not-an-id/view" });

		expect([response.status, response.text, response.headers["hx-location"]]).toEqual([404, "", undefined]);
	});
});
