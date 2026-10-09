import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH, READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { seedInto } from "../../test-helpers/readlist-seed";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

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
		el.querySelectorAll('[data-test-action="mark-unread"]').length === 1 ? "read" : "unread",
	);
}

async function createReadlist(agent: TestAgent, label: string) {
	return agent.post("/queue/queues").type("form").send({ label });
}

function openedSlug(location: string): string {
	const slug = new URL(location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

function renameable(doc: Document): (string | null)[] {
	return Array.from(
		doc.querySelectorAll('[data-test-readlist-menu] [data-test-action="readlist-rename"]'),
		(trigger) => trigger.closest("[data-test-readlist-menu]")?.getAttribute("data-test-readlist-menu") ?? null,
	);
}

async function createReadlistAndOpen(agent: TestAgent, label: string): Promise<string> {
	const response = await createReadlist(agent, label);
	return openedSlug(response.headers.location);
}

function queueLabels(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-readlist]"), (el) => el.textContent);
}

async function save(agent: TestAgent, url: string) {
	return agent.post("/queue/save").type("form").send({ url });
}

async function saveFrom(agent: TestAgent, readlist: string, url: string) {
	return agent.post(`/queue/save?queue=${readlist}`).type("form").send({ url });
}

function saveCardIn(doc: Document): Element {
	const card = doc.querySelector("[data-test-save-card]");
	assert(card, "the readlist page must render the save card");
	return card;
}

function deleteTriggerTargets(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll('[data-test-action="readlist-delete"]'), (el) =>
		el.getAttribute("popovertarget"),
	);
}

function deleteConfirmPanels(doc: Document): Element[] {
	return Array.from(doc.querySelectorAll('[data-test-confirm-popover="readlist-delete"]'));
}

function migrateTargetsOf(panel: Element): (string | null)[] {
	return Array.from(panel.querySelectorAll("[data-test-migrate-target]"), (el) =>
		el.getAttribute("data-test-migrate-target"),
	);
}

function deleteConfirmTitles(doc: Document): (string | null)[] {
	return deleteConfirmPanels(doc).map((panel) => {
		const title = doc.getElementById(`${panel.id}-title`);
		assert(title, "every delete confirmation must carry a title");
		return title.textContent;
	});
}

function deleteFallbackActions(doc: Document): string[] {
	return Array.from(doc.querySelectorAll(".readlist-nav__delete-fallback"), (form) => {
		const action = form.getAttribute("action");
		assert(action, "every delete fallback must post somewhere");
		return action;
	});
}

function deleteConfirmActions(doc: Document): string[] {
	return deleteConfirmPanels(doc).map((panel) => {
		const action = panel.querySelector("form")?.getAttribute("action");
		assert(action, "every delete confirmation must post somewhere");
		return action;
	});
}

function viewedReadlistOf(action: string): string | null {
	return new URL(action, TEST_APP_ORIGIN).searchParams.get("queue");
}

describe("POST /queue/queues", () => {
	it("creates the readlist under the name the reader typed and lands them on it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createReadlist(agent, "Ideas & Inspiration");

		expect(response.status).toBe(303);
		const slug = openedSlug(response.headers.location);
		expect(response.headers.location).toBe(`/queue?queue=${slug}`);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(queueLabels(doc)).toEqual(["All", "Ideas & Inspiration"]);
		expect(doc.querySelector("[data-test-empty-title]")?.textContent).toBe(
			"No articles in this readlist yet",
		);
	});

	it("stores the name trimmed, with the casing the reader typed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		await createReadlist(agent, "   deep WORK  ");

		expect(queueLabels(parse((await agent.get("/queue")).text))).toEqual(["All", "deep WORK"]);
	});

	it("refuses a name it cannot store, keeps the reader where they were and says why", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const viewed = await createReadlistAndOpen(agent, "Finance");

		const refusals = [];
		for (const label of ["   ", "a".repeat(READLIST_LABEL_MAX_LENGTH + 1), "all", "FINANCE"]) {
			const response = await agent
				.post(`/queue/queues?queue=${viewed}`)
				.type("form")
				.send({ label });
			const location = new URL(response.headers.location, TEST_APP_ORIGIN);
			const alert = parse((await agent.get(response.headers.location)).text).querySelector(
				'[data-test-alert="readlist"]',
			);
			refusals.push({
				status: response.status,
				queue: location.searchParams.get("queue"),
				error: location.searchParams.get("queue_error"),
				title: alert?.querySelector("[data-test-alert-title]")?.textContent,
			});
		}

		const title = "Couldn't create the readlist";
		expect(refusals).toEqual([
			{ status: 303, queue: viewed, error: "create_invalid-name", title },
			{ status: 303, queue: viewed, error: "create_invalid-name", title },
			{ status: 303, queue: viewed, error: "create_reserved-name", title },
			{ status: 303, queue: viewed, error: "create_name-taken", title },
		]);
		expect(queueLabels(parse((await agent.get("/queue")).text))).toEqual(["All", "Finance"]);
	});

	it("answers the dialog's script with the refusal it shows under the field", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent, "Finance");

		const answers = [];
		for (const label of ["   ", "a".repeat(READLIST_LABEL_MAX_LENGTH + 1), "All", "finance"]) {
			const response = await agent
				.post("/queue/queues")
				.set("Accept", "application/json")
				.type("form")
				.send({ label });
			answers.push({ status: response.status, body: response.body });
		}

		const invalid = {
			error: "invalid-name",
			message: `Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.`,
		};
		expect(answers).toEqual([
			{ status: 422, body: invalid },
			{ status: 422, body: invalid },
			{
				status: 422,
				body: {
					error: "reserved-name",
					message: "Pick a name other than All, the readlist that holds every save.",
				},
			},
			{
				status: 422,
				body: {
					error: "name-taken",
					message: "You already have a readlist with that name, so pick another one.",
				},
			},
		]);
		expect(queueLabels(parse((await agent.get("/queue")).text))).toEqual(["All", "Finance"]);
	});

	it("answers the dialog's script with only where the new readlist lives", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/queue/queues")
			.set("Accept", "application/json")
			.type("form")
			.send({ label: "Deep Work" });

		expect(response.status).toBe(201);
		const slug = openedSlug(response.body.location);
		expect(response.body).toEqual({ location: `/queue?queue=${slug}` });
		expect(queueLabels(parse((await agent.get("/queue")).text))).toEqual(["All", "Deep Work"]);
	});

	it("offers a create dialog from the rail, backed by a plain form for browsers without popovers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const viewed = await createReadlistAndOpen(agent, "Finance");

		const doc = parse((await agent.get(`/queue?queue=${viewed}`)).text);

		const trigger = doc.querySelector('[data-test-action="new-readlist"]');
		assert(trigger, "the rail must offer its create row");
		const dialog = doc.querySelector('[data-test-confirm-popover="readlist-create"]');
		assert(dialog, "the create row must open a dialog");
		expect(trigger.getAttribute("popovertarget")).toBe(dialog.id);
		const tagged = `/queue/queues?queue=${viewed}&utm_source=queue-nav&utm_medium=internal&utm_content=new-readlist`;
		const form = dialog.querySelector('[data-test-form="readlist-create"]');
		assert(form, "the dialog must post through its form");
		expect(form.getAttribute("action")).toBe(tagged);
		const input = dialog.querySelector("[data-test-readlist-create-input]");
		assert(input, "the dialog must offer the name field");
		expect(input.getAttribute("maxlength")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(input.getAttribute("placeholder")).toBe("Enter readlist name");
		const fallback = doc.querySelector('[data-test-form="readlist-create-fallback"]');
		assert(fallback, "the rail must keep a no-popover create form");
		expect(fallback.getAttribute("action")).toBe(tagged);
		expect(doc.querySelectorAll('script[src="/client-dist/readlist.client.js"]')).toHaveLength(1);
	});

	it("addresses a readlist by an opaque id, not by what it is called", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const slug = await createReadlistAndOpen(agent, "New Readlist");

		expect(slug).toMatch(/^[a-f0-9]{16}$/);
	});

	it("offers the readlist the reader is on for renaming, with the script that does it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await createReadlist(agent, "New Readlist");

		const slug = openedSlug(response.headers.location);
		const doc = parse((await agent.get(response.headers.location)).text);
		const link = doc.querySelector(`[data-test-readlist="${slug}"]`);
		assert(link, "the created readlist must render a rail link");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toContain(`queue=${slug}`);
		expect(renameable(doc)).toEqual([slug]);
		const dialog = doc.querySelector('[data-test-confirm-popover="readlist-rename"]');
		assert(dialog, "the rail's Edit must open a rename dialog");
		const form = dialog.querySelector('[data-test-form="readlist-rename"]');
		assert(form, "the rename dialog must post to the rename route");
		expect(form.getAttribute("action")).toBe(
			`/queue/queues/${slug}/rename?utm_source=queue-nav&utm_medium=internal&utm_content=rename-readlist`,
		);
		const input = dialog.querySelector("[data-test-readlist-rename-input]");
		assert(input, "the rename dialog must offer the name field");
		expect(input.getAttribute("maxlength")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(doc.querySelector('script[src="/client-dist/readlist.client.js"]')).not.toBeNull();
	});

	it("withholds the rename from a reader who has lost write access", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlistAndOpen(agent, "New Readlist");
		const lookup = await harness.auth.findUserByEmail("test@example.com");
		assert(lookup, "the logged-in reader must exist");
		await harness.subscriptionProviders.upsertTrialing({
			userId: lookup.userId,
			trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
		});

		const doc = parse((await agent.get(`/queue?queue=${slug}`)).text);

		expect(renameable(doc)).toEqual([]);
		expect(doc.querySelector('[data-test-action="new-readlist"]')).toBeNull();
		expect(doc.querySelector(`[data-test-readlist="${slug}"]`)?.getAttribute("href")).toContain(
			`queue=${slug}`,
		);
	});

	it("never offers the readlist every reader is given for renaming", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlistAndOpen(agent, "New Readlist");

		const onDefault = parse((await agent.get("/queue")).text);
		const onCreated = parse((await agent.get(`/queue?queue=${slug}`)).text);

		expect(renameable(onDefault)).toEqual([slug]);
		expect(renameable(onCreated)).toEqual([slug]);
	});

	it("stops the reader at the per-account readlist cap and says so", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		for (let index = 1; index <= READLIST_MAX_PER_USER; index += 1) {
			await createReadlist(agent, `Readlist ${index}`);
		}

		const response = await createReadlist(agent, "One Too Many");

		expect(response.headers.location).toContain("queue_error=limit");
		const doc = parse((await agent.get(response.headers.location)).text);
		const flash = doc.querySelector('[data-test-alert="readlist"]');
		assert(flash, "the cap must be explained where the reader pressed the control");
		expect(flash.classList.contains("alert--visible")).toBe(true);
		expect(flash.getAttribute("data-test-alert-variant")).toBe("error");
		expect(flash.getAttribute("role")).toBe("alert");
		expect(flash.querySelector("[data-test-alert-title]")?.textContent).toBe(
			"Readlist limit reached",
		);
		expect(flash.textContent).toContain(
			`You can create up to ${READLIST_MAX_PER_USER} readlists.`,
		);
	});

	it("points the dialog's script at the limit alert when the reader is at the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		for (let index = 1; index <= READLIST_MAX_PER_USER; index += 1) {
			await createReadlist(agent, `Readlist ${index}`);
		}

		const response = await agent
			.post("/queue/queues?queue=default")
			.set("Accept", "application/json")
			.type("form")
			.send({ label: "One Too Many" });

		expect(response.status).toBe(409);
		expect(response.body).toEqual({
			error: "limit-reached",
			message: `You can create up to ${READLIST_MAX_PER_USER} readlists. Delete an existing readlist before creating a new one.`,
			location: "/queue?queue_error=limit",
		});
	});

	it("sends a signed-out visitor to log in rather than creating anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post("/queue/queues");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("a URL saved into more than one readlist", () => {
	it("keeps an independent copy in each readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await save(agent, "https://example.com/a");
		await seedInto(harness, { readlist, url: "https://example.com/a" });

		const onDefault = parse((await agent.get("/queue")).text);
		const onWork = parse((await agent.get(`/queue?queue=${readlist}`)).text);

		expect(articleIds(onDefault)).toEqual(articleIds(onWork));
		expect(articleIds(onWork)).toHaveLength(1);
	});

	it("marks every copy read from whichever readlist the reader was looking at", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await save(agent, "https://example.com/a");
		await seedInto(harness, { readlist, url: "https://example.com/a" });
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent
			.post(`/queue/${articleId}/status?queue=${readlist}`)
			.type("form")
			.send({ status: "read" });

		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect(articleIds(parse((await agent.get("/queue?tab=done")).text))).toEqual([articleId]);
		const workDone = parse((await agent.get(`/queue?queue=${readlist}&tab=done`)).text);
		expect(articleIds(workDone)).toEqual([articleId]);
	});

	it("reverses every copy when the reader marks it unread again", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await save(agent, "https://example.com/a");
		await seedInto(harness, { readlist, url: "https://example.com/a" });
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");
		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "unread" });

		expect(cardStatuses(parse((await agent.get("/queue")).text))).toEqual(["unread"]);
		expect(cardStatuses(parse((await agent.get(`/queue?queue=${readlist}`)).text))).toEqual([
			"unread",
		]);
	});

	it("deletes one copy without touching the other", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await save(agent, "https://example.com/a");
		await seedInto(harness, { readlist, url: "https://example.com/a" });
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		const response = await agent.post(`/queue/${articleId}/delete?queue=${readlist}`);

		expect(response.headers.location).toBe(`/queue?queue=${readlist}`);
		expect(articleIds(parse((await agent.get(`/queue?queue=${readlist}`)).text))).toEqual([]);
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
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await save(agent, "https://example.com/a");
		await seedInto(harness, { readlist, url: "https://example.com/a" });
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent.post(`/queue/${articleId}/delete?queue=${readlist}`);
		expect(dequeued).toEqual([]);

		await agent.post(`/queue/${articleId}/delete`);
		expect(dequeued).toEqual(["https://example.com/a"]);
	});

	it("keeps the link announced when the default copy goes first and a readlist still holds it", async () => {
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
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await save(agent, "https://example.com/a");
		await seedInto(harness, { readlist, url: "https://example.com/a" });
		const [articleId] = articleIds(parse((await agent.get("/queue")).text));
		assert(articleId, "the saved article must render a card");

		await agent.post(`/queue/${articleId}/delete`);
		expect(dequeued).toEqual([]);

		await agent.post(`/queue/${articleId}/delete?queue=${readlist}`);
		expect(dequeued).toEqual(["https://example.com/a"]);
	});
});

describe("a readlist the reader opened", () => {
	it("lists, counts and paginates only its own saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await save(agent, "https://example.com/default-only");
		await seedInto(harness, { readlist, url: "https://example.com/work-only" });

		const onWork = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		expect(
			Array.from(onWork.querySelectorAll("[data-test-article-url]"), (el) => el.textContent),
		).toEqual(["example.com"]);
		expect(articleIds(onWork)).toHaveLength(1);

		const counts = await agent.get(`/queue/counts?queue=${readlist}`);
		expect(parse(`<main>${counts.text}</main>`).getElementById("readlist-count")?.textContent).toBe("1 Saved Article");
	});

	it("drops the save into the default readlist however the request names another", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");

		const response = await saveFrom(agent, readlist, "https://example.com/only-here");

		expect(response.headers.location).toBe("/queue#latest-saved");
		expect(articleIds(parse((await agent.get("/queue")).text))).toHaveLength(1);
		expect(articleIds(parse((await agent.get(`/queue?queue=${readlist}`)).text))).toEqual([]);
	});

	it("shows the save bar on a custom readlist and points the empty state at the default readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");

		const onWork = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		const onDefault = parse((await agent.get("/queue")).text);

		expect(saveCardIn(onWork).className).toBe("readlist-save");
		expect(saveCardIn(onDefault).className).toBe("readlist-save");
		const empty = onWork.querySelector("[data-test-empty-readlist]");
		assert(empty, "an untouched readlist must render its empty state");
		expect(empty.textContent).toContain(
			"Choose an article from All and add it here to start organising this readlist.",
		);
	});

	it("redirects a link rejected from a custom readlist to All with its error code", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");

		const response = await saveFrom(agent, readlist, "chrome://extensions/");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?error_code=unsupported_scheme");
	});

	it("posts the save form on a custom readlist to the default readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		const doc = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		const form = saveCardIn(doc).querySelector('[data-test-form="save-article"]');
		assert(form, "the custom readlist's save card must render its form");
		const action = form.getAttribute("action");
		assert(action, "the save form must post somewhere");
		const target = new URL(action, TEST_APP_ORIGIN);

		expect(target.pathname).toBe("/queue/save");
		expect(target.searchParams.has("queue")).toBe(false);
	});

	it("opens the owner reader for an article only that readlist holds", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await seedInto(harness, { readlist, url: "https://example.com/only-here" });
		const doc = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		const readerHref = doc.querySelector("[data-test-article-title]")?.getAttribute("href");
		assert(readerHref, "the card title must link to the reader");
		expect(readerHref).toContain(`queue=${readlist}`);

		const response = await agent.get(readerHref);

		expect(response.status).toBe(200);
	});

	it("returns an MCP reader link to its named readlist after login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const ownerAgent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(ownerAgent, "New Readlist");
		await seedInto(harness, { readlist, url: "https://example.com/mcp-only-here" });
		const articleId = articleIds(parse((await ownerAgent.get(`/queue?queue=${readlist}`)).text))[0];
		assert(articleId, "the named readlist must contain the MCP article");

		const loggedOutAgent = request.agent(harness.server);
		const markedPath = `/queue/${articleId}/view?from=mcp&queue=${readlist}`;
		const loginRedirect = await loggedOutAgent.get(markedPath);

		expect(loginRedirect.status).toBe(303);
		expect(loginRedirect.headers.location).toBe(
			`/login?return=${encodeURIComponent(markedPath)}`,
		);

		const login = await loggedOutAgent
			.post(loginRedirect.headers.location)
			.type("form")
			.send({ email: "test@example.com", password: "password123" });

		expect(login.status).toBe(303);
		expect(login.headers.location).toBe(markedPath);

		const markerRedirect = await loggedOutAgent.get(login.headers.location);

		expect(markerRedirect.status).toBe(303);
		expect(markerRedirect.headers.location).toBe(`/queue/${articleId}/view?queue=${readlist}`);

		const reader = await loggedOutAgent.get(markerRedirect.headers.location);

		expect(reader.status).toBe(200);
	});
});

describe("the readlist every reader is given", () => {
	it("links each owned readlist from the rail", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await seedInto(harness, { readlist, url: "https://example.com/work-only" });

		const doc = parse((await agent.get("/queue")).text);

		expect(queueLabels(doc)).toEqual(["All", "New Readlist"]);
		const workTab = doc.querySelector(`[data-test-readlist="${readlist}"]`);
		assert(workTab, "the owned readlist must render its tab");
		expect(workTab.getAttribute("href")).toBe(
			`/queue?queue=${readlist}&utm_source=queue-nav&utm_medium=internal&utm_content=queue-${readlist}`,
		);

		const onWork = parse((await agent.get(`/queue?queue=${readlist}`)).text);
		expect(
			Array.from(onWork.querySelectorAll("[data-test-article-title]"), (el) => el.textContent),
		).toEqual(["https://example.com/work-only"]);
	});

	it("keeps the save bar on a readlist URL that was never minted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlistAndOpen(agent, "New Readlist");

		const doc = parse((await agent.get("/queue?queue=never-minted")).text);

		const form = saveCardIn(doc).querySelector('[data-test-form="save-article"]');
		assert(form, "the save card must render its form");
		const action = form.getAttribute("action");
		assert(action, "the save form must post somewhere");
		expect(new URL(action, TEST_APP_ORIGIN).pathname).toBe("/queue/save");
	});

	it("counts and lists only its own saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");
		await seedInto(harness, { readlist, url: "https://example.com/work-only" });

		expect(articleIds(parse((await agent.get("/queue")).text))).toEqual([]);
		expect(
			parse(`<main>${(await agent.get("/queue/counts")).text}</main>`).getElementById("readlist-count")?.textContent,
		).toBe("0 Saved Articles");
	});
});

describe("the readlists the reader made, seen from the rail", () => {
	it("offers each owned readlist for deleting from the rail, with a confirmation of its own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createReadlistAndOpen(agent, "New Readlist");
		const second = await createReadlistAndOpen(agent, "New Readlist 2");

		const doc = parse((await agent.get("/queue")).text);

		const panels = deleteConfirmPanels(doc);
		expect(deleteTriggerTargets(doc)).toEqual([
			`readlist-remove-confirm-${first}`,
			`readlist-remove-confirm-${second}`,
		]);
		expect(panels.map((panel) => panel.getAttribute("id"))).toEqual(deleteTriggerTargets(doc));
		expect(panels.map(migrateTargetsOf)).toEqual([[], []]);
		expect(deleteFallbackActions(doc)).toEqual([
			`/queue/queues/${first}/delete?utm_source=queue-nav&utm_medium=internal&utm_content=delete-readlist`,
			`/queue/queues/${second}/delete?utm_source=queue-nav&utm_medium=internal&utm_content=delete-readlist`,
		]);
	});

	it("asks where the articles go for a readlist that holds some, offering the other readlist first", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createReadlistAndOpen(agent, "Ideas & Inspiration");
		const second = await createReadlistAndOpen(agent, "Finance");
		await seedInto(harness, { readlist: first, url: "https://example.com/filed-first" });

		const doc = parse((await agent.get("/queue")).text);

		expect(deleteConfirmTitles(doc)).toEqual(["Move or delete articles", "Delete this readlist?"]);
		expect(deleteConfirmPanels(doc).map(migrateTargetsOf)).toEqual([[second], []]);
	});

	it("keeps the plain question for a readlist with articles when no other readlist could take them", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "Ideas & Inspiration");
		await seedInto(harness, { readlist, url: "https://example.com/filed-alone" });

		const doc = parse((await agent.get("/queue")).text);

		expect(deleteConfirmTitles(doc)).toEqual(["Delete this readlist?"]);
	});

	it("carries the readlist being viewed on every delete", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const viewed = await createReadlistAndOpen(agent, "New Readlist");
		await createReadlistAndOpen(agent, "New Readlist 2");

		const doc = parse((await agent.get(`/queue?queue=${viewed}`)).text);

		expect(deleteFallbackActions(doc).map(viewedReadlistOf)).toEqual([viewed, viewed]);
		expect(deleteConfirmActions(doc).map(viewedReadlistOf)).toEqual([viewed, viewed]);
	});

	it("offers every readlist the reader made for renaming, from whichever one they are on", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlistAndOpen(agent, "New Readlist");

		const doc = parse((await agent.get("/queue")).text);

		expect(renameable(doc)).toEqual([readlist]);
		expect(deleteTriggerTargets(doc)).toEqual([`readlist-remove-confirm-${readlist}`]);
	});
});
