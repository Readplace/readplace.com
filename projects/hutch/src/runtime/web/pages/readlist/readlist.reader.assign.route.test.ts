import assert from "node:assert/strict";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";
import { markStatusConfirmPopoverId } from "./mark-status-confirm.component";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function createReadlist(agent: TestAgent, label: string): Promise<string> {
	const response = await agent.post("/queue/queues").type("form").send({ label });
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
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
	const slot = doc.querySelector("[data-test-readlists-slot]");
	assert(slot, "the reader toolbar must render the readlists slot");
	return slot;
}

function pickerOptions(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-assign-readlist]"), (el) =>
		el.getAttribute("data-test-assign-readlist"),
	);
}

function pickerRows(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-readlists-row]"), (el) =>
		el.getAttribute("data-test-readlists-row"),
	);
}

function readlistTags(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-reader-tags] [data-test-readlist-tag]"), (el) =>
		el.getAttribute("data-test-readlist-tag"),
	);
}

async function assignTo(params: {
	agent: TestAgent;
	articleId: string;
	readlist: string;
	returnTo?: string;
}): Promise<request.Response> {
	return params.agent
		.post(`/queue/${params.articleId}/assign`)
		.type("form")
		.send({ queue: params.readlist, returnTo: params.returnTo ?? `/queue/${params.articleId}/view` });
}

async function fileInPlace(params: {
	agent: TestAgent;
	articleId: string;
	readlist: string;
	returnTo?: string;
	client?: string | undefined;
}): Promise<request.Response> {
	const post = params.agent
		.post(`/queue/${params.articleId}/assign?swap=filing`)
		.set("HX-Request", "true")
		.set("HX-Boosted", "true");
	if (params.client !== undefined) post.set(NATIVE_CLIENT_HEADER, params.client);
	return post
		.type("form")
		.send({ queue: params.readlist, returnTo: params.returnTo ?? `/queue/${params.articleId}/view` });
}

function onPage(doc: Document, selector: string): Element {
	const element = doc.querySelector(selector);
	assert(element, `${selector} must render`);
	return element;
}

function oobOf(doc: Document, selector: string): Element {
	const element = onPage(doc, selector);
	expect(element.getAttribute("hx-swap-oob")).toBe("outerHTML");
	return element;
}

function withoutOob(element: Element): string {
	const copy = element.cloneNode(true);
	assert(copy.ownerDocument?.defaultView, "a parsed element belongs to a window");
	assert(copy instanceof copy.ownerDocument.defaultView.Element, "cloning an element yields an element");
	copy.removeAttribute("hx-swap-oob");
	return copy.outerHTML;
}

function statusToast(doc: Document): Element {
	const mount = doc.querySelector("main #status-toast");
	assert(mount, "the reader must carry the status toast mount");
	return mount;
}

function listedArticleIds(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
		el.getAttribute("data-test-article"),
	);
}

describe("the reader's add-to-readlist control", () => {
	it("shows only the create row for a reader with no readlists yet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveArticle(agent, "https://example.com/a");

		const doc = await openReader(agent, articleId);

		expect(pickerSlot(doc).classList.contains("article-body__readlists-slot--visible")).toBe(true);
		expect(pickerOptions(doc)).toEqual([]);
		expect(pickerRows(doc)).toEqual(["create"]);
		expect(readlistTags(doc)).toEqual([]);
	});

	it("offers only the readlists the article is not yet in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const later = await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const before = await openReader(agent, articleId);
		expect(pickerSlot(before).classList.contains("article-body__readlists-slot--visible")).toBe(
			true,
		);
		expect([...pickerOptions(before)].sort()).toEqual([work, later].sort());
		expect(readlistTags(before)).toEqual([]);

		await assignTo({ agent, articleId, readlist: work });

		const after = await openReader(agent, articleId);
		expect(pickerOptions(after)).toEqual([later]);
		expect(readlistTags(after)).toEqual([work]);
	});

	it("returns to the reader after assigning", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await assignTo({ agent, articleId, readlist: work });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view?filed_readlist=${work}`);
	});

	it("keeps the rest of the return path when it flashes the filing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await assignTo({
			agent,
			articleId,
			readlist: work,
			returnTo: `/queue/${articleId}/view?platform=ios`,
		});

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view?platform=ios&filed_readlist=${work}`);
	});

	it("returns without the flash when the article was already in that readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const response = await assignTo({ agent, articleId, readlist: work });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
	});

	it("confirms the filing with a toast whose Undo takes the article back out", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const deepWork = await createReadlist(agent, "Deep Work");
		const articleId = await saveArticle(agent, "https://example.com/a");
		const assigned = await assignTo({ agent, articleId, readlist: deepWork });

		const reader = parse((await agent.get(assigned.headers.location)).text);

		const toast = statusToast(reader);
		expect(toast.querySelector("[data-test-toast-message]")?.textContent).toBe("Added to Deep Work");
		const undo = toast.querySelector("[data-test-toast-action]")?.closest("form");
		assert(undo, "the toast must offer Undo");
		const action = new URL(undo.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect([undo.getAttribute("method"), action.pathname]).toEqual(["POST", `/queue/${articleId}/unassign`]);
		const fields = Object.fromEntries(
			Array.from(undo.querySelectorAll("input[type='hidden']"), (field) => [
				field.getAttribute("name"),
				field.getAttribute("value"),
			]),
		);
		expect(fields).toEqual({ queue: deepWork, returnTo: `/queue/${articleId}/view` });

		const undone = await agent.post(`${action.pathname}${action.search}`).type("form").send(fields);

		expect(undone.status).toBe(303);
		const back = parse((await agent.get(undone.headers.location)).text);
		expect(readlistTags(back)).toEqual([]);
		expect(pickerOptions(back)).toEqual([deepWork]);
		expect(statusToast(back).innerHTML).toBe("");
	});

	it("shows no toast for a flash naming a readlist the article is not in, a malformed slug, or a repeated flash", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const later = await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const readers = await Promise.all(
			[
				`filed_readlist=${later}`,
				"filed_readlist=Not%20A%20Slug",
				`filed_readlist=${work}&filed_readlist=${work}`,
			].map(async (flash) => parse((await agent.get(`/queue/${articleId}/view?${flash}`)).text)),
		);

		expect(readers.map((reader) => [statusToast(reader).innerHTML, readlistTags(reader)])).toEqual([
			["", [work]],
			["", [work]],
			["", [work]],
		]);
	});

	it("shows no toast in the app reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const reader = parse((await agent.get(`/queue/${articleId}/view?platform=ios&filed_readlist=${work}`)).text);

		expect([statusToast(reader).innerHTML, readlistTags(reader)]).toEqual(["", [work]]);
	});

	it("files the article at the top of the chosen readlist, keeping its read state", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		await saveArticle(agent, "https://example.com/a");
		await saveArticle(agent, "https://example.com/b");
		const first = await articleIdFor(agent, "https://example.com/a");
		const second = await articleIdFor(agent, "https://example.com/b");
		await agent.post(`/queue/${second}/status`).type("form").send({ status: "read" });

		await assignTo({ agent, articleId: first, readlist: work });
		await assignTo({ agent, articleId: second, readlist: work });

		const workUnread = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(workUnread)).toEqual([first]);
		const workRead = parse((await agent.get(`/queue?queue=${work}&tab=done`)).text);
		expect(listedArticleIds(workRead)).toEqual([second]);
		const myReadlist = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myReadlist)).toEqual([first]);
	});

	it("lands a newly assigned article at the top of the readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		await saveArticle(agent, "https://example.com/a");
		await saveArticle(agent, "https://example.com/b");
		const first = await articleIdFor(agent, "https://example.com/a");
		const second = await articleIdFor(agent, "https://example.com/b");

		await assignTo({ agent, articleId: second, readlist: work });
		await assignTo({ agent, articleId: first, readlist: work });

		const myReadlist = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myReadlist)).toEqual([second, first]);
		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([first, second]);
	});

	it("keeps one copy per readlist however often the reader assigns", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		await assignTo({ agent, articleId, readlist: work });
		await assignTo({ agent, articleId, readlist: work });

		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([articleId]);
	});

	it("rejects a readlist the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		expect((await assignTo({ agent, articleId, readlist: "someone-elses" })).status).toBe(404);
		expect((await assignTo({ agent, articleId, readlist: "default" })).status).toBe(404);
		expect((await assignTo({ agent, articleId: "not-an-id", readlist: "default" })).status).toBe(404);
	});

	it("takes the tag off and empties the readlist copy on unassign", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const response = await agent
			.post(`/queue/${articleId}/unassign`)
			.type("form")
			.send({ queue: work, returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view`);
		const onWork = parse((await agent.get(`/queue?queue=${work}`)).text);
		expect(listedArticleIds(onWork)).toEqual([]);
		const myReadlist = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myReadlist)).toEqual([articleId]);
		const reader = await openReader(agent, articleId);
		expect(readlistTags(reader)).toEqual([]);
		expect(pickerOptions(reader)).toEqual([work]);
	});

	it("keeps the reader reachable after unassigning the readlist it was opened from", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const openedFromWork = parse((await agent.get(`/queue/${articleId}/view?queue=${work}`)).text);
		const unassignForm = openedFromWork.querySelector(
			`[data-test-readlist-tag="${work}"] form`,
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
		expect(readlistTags(parse(landed.text))).toEqual([]);
	});

	it("polls never touch the tags, so a settling crawl cannot drop or overwrite them", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const poll = await agent.get(`/queue/${articleId}/reader?poll=1`);
		expect(poll.status).toBe(200);
		expect(parse(poll.text).querySelector("#reader-readlist-tags")).toBeNull();

		const summaryPoll = await agent.get(`/queue/${articleId}/summary?poll=1`);
		expect(summaryPoll.status).toBe(200);
		expect(parse(summaryPoll.text).querySelector("#reader-readlist-tags")).toBeNull();
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

	it("never unassigns the default readlist's copy", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await agent
			.post(`/queue/${articleId}/unassign`)
			.type("form")
			.send({ queue: "default", returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(303);
		const myReadlist = parse((await agent.get("/queue")).text);
		expect(listedArticleIds(myReadlist)).toEqual([articleId]);
	});

	it("answers a no-op redirect when the default copy is already gone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const later = await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });
		await agent.post(`/queue/${articleId}/delete`);

		const response = await assignTo({ agent, articleId, readlist: later });

		expect(response.status).toBe(303);
		const onLater = parse((await agent.get(`/queue?queue=${later}`)).text);
		expect(listedArticleIds(onLater)).toEqual([]);
	});

	it("stops offering the picker once the default copy is gone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });
		await agent.post(`/queue/${articleId}/delete`);

		const doc = parse((await agent.get(`/queue/${articleId}/view?queue=${work}`)).text);

		expect(pickerSlot(doc).classList.contains("article-body__readlists-slot--hidden")).toBe(true);
		expect(readlistTags(doc)).toEqual([work]);
	});

	it("marks every copy read from a readlist-scoped status post", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const response = await agent
			.post(`/queue/${articleId}/status?queue=${work}`)
			.type("form")
			.send({ status: "read" });

		expect(response.status).toBe(303);
		const workRead = parse((await agent.get(`/queue?queue=${work}&tab=done`)).text);
		expect(listedArticleIds(workRead)).toEqual([articleId]);
		expect(listedArticleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect(listedArticleIds(parse((await agent.get("/queue?tab=done")).text))).toEqual([articleId]);
	});

	it("keeps the chromeless marker on the poll URLs and filing forms of the iOS reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const reader = parse((await agent.get(`/queue/${articleId}/view?platform=ios`)).text);
		const tagForm = reader.querySelector(`[data-test-readlist-tag="${work}"] form`);
		assert(tagForm, "the tag must carry its un-assign form");
		expect(tagForm.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			`/queue/${articleId}/view?platform=ios`,
		);

		const poll = await agent.get(`/queue/${articleId}/reader?poll=1&platform=ios`);
		expect(poll.status).toBe(200);
		expect(parse(poll.text).querySelector(`[data-test-readlist-tag="${work}"]`)).toBeNull();

		const filed = parse((await fileInPlace({ agent, articleId, readlist: work, returnTo: `/queue/${articleId}/view?platform=ios` })).text);
		const filedForm = filed.querySelector(`[data-test-readlist-tag="${work}"] form`);
		assert(filedForm, "the swapped-in tag must carry its un-assign form");
		expect(filedForm.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			`/queue/${articleId}/view?platform=ios`,
		);
	});
});

describe("filing from the reader's picker over htmx", () => {
	it("answers 200 in place, with the page's scroll and URL under its control and no redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await fileInPlace({ agent, articleId, readlist: work });

		expect(response.status).toBe(200);
		expect(response.headers["hx-reswap"]).toBe("none show:none");
		expect(response.headers["hx-replace-url"]).toBe(`/queue/${articleId}/view`);
		expect(response.headers.location).toBeUndefined();
	});

	it("swaps in the tag with an un-assign form that returns to the reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const doc = parse((await fileInPlace({ agent, articleId, readlist: work })).text);

		expect(oobOf(doc, "#reader-readlist-tags").hasAttribute("hidden")).toBe(false);
		const form = doc.querySelector(`[data-test-readlist-tag="${work}"] form`);
		assert(form, "the tag must carry its un-assign form");
		expect(form.getAttribute("action")).toContain(`/queue/${articleId}/unassign`);
		expect(form.querySelector('input[name="queue"]')?.getAttribute("value")).toBe(work);
		expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(`/queue/${articleId}/view`);
	});

	it("swaps in a picker that no longer offers the slug and can file again in place", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const later = await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const doc = parse((await fileInPlace({ agent, articleId, readlist: work })).text);

		const slot = oobOf(doc, "#reader-readlists-slot");
		expect(pickerOptions(doc)).toEqual([later]);
		const form = slot.querySelector(`[data-test-assign-readlist="${later}"]`)?.closest("form");
		assert(form, "the offered readlist must carry its assign form");
		expect(form.getAttribute("action")).toContain("swap=filing");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
	});

	it("keeps the slot visible after the last readlist is taken, because creating a new one remains", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const doc = parse((await fileInPlace({ agent, articleId, readlist: work })).text);

		expect(pickerOptions(doc)).toEqual([]);
		expect(oobOf(doc, "#reader-readlists-slot").classList.contains("article-body__readlists-slot--visible")).toBe(true);
	});

	it("swaps in the toast with an Undo form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const doc = parse((await fileInPlace({ agent, articleId, readlist: work })).text);

		const toast = oobOf(doc, "#status-toast");
		expect(toast.querySelector("[data-test-toast-message]")?.textContent).toBe("Added to New Readlist");
		expect(toast.querySelector("[data-test-toast-action]")?.textContent?.trim()).toBe("Undo");
		expect(toast.querySelector("[data-test-toast-action]")?.closest("form")?.getAttribute("action")).toContain(
			`/queue/${articleId}/unassign`,
		);
	});

	it("does not depend on the single-URL read a followed GET would make", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const listUserSavesForUrl = fixture.articleStore.listUserSavesForUrl;
		let refuseSingleUrlRead = false;
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				listUserSavesForUrl: (input) =>
					refuseSingleUrlRead ? Promise.reject(new Error("the fragment must not read this")) : listUserSavesForUrl(input),
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		refuseSingleUrlRead = true;

		const response = await fileInPlace({ agent, articleId, readlist: work });

		expect(response.status).toBe(200);
		expect(readlistTags(parse(response.text))).toEqual([work]);
	});

	it("files A then B in a row, each answer holding what came before", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const a = await createReadlist(agent, "New Readlist");
		const b = await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const first = parse((await fileInPlace({ agent, articleId, readlist: a })).text);
		const second = parse((await fileInPlace({ agent, articleId, readlist: b })).text);

		expect(readlistTags(first)).toEqual([a]);
		expect(pickerOptions(first)).toEqual([b]);
		expect(readlistTags(second)).toEqual([a, b]);
		expect(pickerOptions(second)).toEqual([]);
		expect(second.querySelector("#status-toast [data-test-toast-message]")?.textContent).toBe(
			"Added to New Readlist 2",
		);
	});

	it("matches what a GET of the reader renders, element by element", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const fragment = parse((await fileInPlace({ agent, articleId, readlist: work })).text);
		const reader = await openReader(agent, articleId);
		const panel = `#${markStatusConfirmPopoverId(articleId)}`;

		for (const selector of ["#reader-readlist-tags", "#reader-readlists-slot", panel]) {
			expect(withoutOob(oobOf(fragment, selector))).toBe(onPage(reader, selector).outerHTML);
		}
	});

	it("refreshes the mark-status popover only while its confirmation is still asked", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const later = await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");
		const panel = `#${markStatusConfirmPopoverId(articleId)}`;

		const gated = parse((await fileInPlace({ agent, articleId, readlist: work })).text);
		expect(oobOf(gated, panel).textContent).toContain("New Readlist");

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read", ack: "never" });
		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "unread" });

		const acknowledged = parse((await fileInPlace({ agent, articleId, readlist: later })).text);
		expect(acknowledged.querySelector(panel)).toBeNull();
	});

	it.each([
		{ surface: "?platform=ios", query: "?platform=ios", client: undefined },
		{ surface: "shell=app", query: "?shell=app", client: undefined },
		{ surface: "the native client header", query: "", client: "ios" },
	])("leaves the toast empty on an app surface marked by $surface", async ({ query, client }) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await fileInPlace({
			agent,
			articleId,
			readlist: work,
			returnTo: `/queue/${articleId}/view${query}`,
			client,
		});

		const doc = parse(response.text);
		expect(readlistTags(doc)).toEqual([work]);
		expect(oobOf(doc, "#status-toast").children).toHaveLength(0);
	});

	it("answers with no toast when the article was already filed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });

		const response = await fileInPlace({ agent, articleId, readlist: work });

		expect(response.status).toBe(200);
		const doc = parse(response.text);
		expect(readlistTags(doc)).toEqual([work]);
		expect(oobOf(doc, "#status-toast").children).toHaveLength(0);
	});

	it("hides the slot when a stale picker races the removal of the article's default copy", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const findArticleById = fixture.articleStore.findArticleById;
		let foundBeforeTheRemoval: Awaited<ReturnType<typeof findArticleById>> = null;
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				findArticleById: async (id, userId) => {
					foundBeforeTheRemoval = (await findArticleById(id, userId)) ?? foundBeforeTheRemoval;
					return foundBeforeTheRemoval;
				},
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const later = await createReadlist(agent, "New Readlist 2");
		const articleId = await saveArticle(agent, "https://example.com/a");
		await assignTo({ agent, articleId, readlist: work });
		await agent.post(`/queue/${articleId}/delete`);

		const doc = parse((await fileInPlace({ agent, articleId, readlist: later })).text);

		expect(oobOf(doc, "#reader-readlists-slot").classList.contains("article-body__readlists-slot--hidden")).toBe(true);
		expect(readlistTags(doc)).toEqual([work]);
		expect(oobOf(doc, "#status-toast").children).toHaveLength(0);
	});

	it("redirects without replacing the URL when the article is missing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");

		const response = await fileInPlace({
			agent,
			articleId: "ffffffffffffffffffffffffffffffff",
			readlist: work,
		});

		expect(response.status).toBe(303);
		expect(response.headers["hx-replace-url"]).toBeUndefined();
	});

	it("redirects an htmx request that did not opt in with the marker", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await agent
			.post(`/queue/${articleId}/assign`)
			.set("HX-Request", "true")
			.type("form")
			.send({ queue: work, returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view?filed_readlist=${work}`);
	});

	it("redirects the marker when the browser has no htmx, so no-JS posts still land on the reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const work = await createReadlist(agent, "New Readlist");
		const articleId = await saveArticle(agent, "https://example.com/a");

		const response = await agent
			.post(`/queue/${articleId}/assign?swap=filing`)
			.type("form")
			.send({ queue: work, returnTo: `/queue/${articleId}/view` });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view?filed_readlist=${work}`);
	});
});
