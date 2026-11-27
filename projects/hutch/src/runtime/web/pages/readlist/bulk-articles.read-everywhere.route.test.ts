import assert from "node:assert/strict";
import type { Server } from "node:http";
import request from "supertest";
import { JSDOM } from "jsdom";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { loginAgent, useTestServer } from "../../../test-app";
import { newSelection } from "../../../bulk-articles/selection";
import { initInMemoryBulkSelections } from "../../../bulk-articles/selection-store";
import { initLocalBulkOperations } from "../../../bulk-articles/local-operations";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);
const view = (html: string) => new JSDOM(html).window.document;
const count = (doc: Document, label: string) => [...doc.querySelectorAll("main dt")].find(dt => dt.textContent === label)?.nextElementSibling?.textContent;
const HOUR = 3600_000;

async function loginSecondReader(server: Server, auth: { createUser: (input: { email: string; password: string }) => Promise<unknown> }) {
	await auth.createUser({ email: "second@example.com", password: "password123" });
	const agent = request.agent(server);
	await agent.post("/login").type("form").send({ email: "second@example.com", password: "password123" });
	return agent;
}

describe("before the new action is admitted", () => {
	const store = initInMemoryBulkSelections();
	const dispatch = jest.fn(async () => {});
	const useApp = useTestServer({ bulkArticles: { store, dispatch, readEverywhere: false } });

	it("offers only the narrower action and asks a reader holding an older form to refresh instead of creating a job", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { server, auth } = useApp(fixture);
		const agent = await loginAgent(server, auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.org/held" });
		const form = view((await agent.get("/queue").expect(200)).text).querySelector("form[action*='/manage/preview']");
		assert(form);
		expect(form.querySelector("button[value=read]")?.textContent).toBe(t("manage.action.read"));
		expect(form.querySelector("button[value=read-everywhere]")).toBeNull();
		const refused = await agent.post("/queue/manage/preview").type("form").send({ extent: "all", action: "read-everywhere" }).expect(409);
		const page = view(refused.text);
		expect(page.querySelector("main [role=alert]")?.textContent).toBe(t("manage.staleForm"));
		expect(page.querySelector("main a")?.textContent).toBe(t("manage.back"));
		expect(refused.headers.location).toBeUndefined();
		expect(dispatch).not.toHaveBeenCalled();
	});
});

describe("marking selected articles read in every readlist", () => {
	const useLocalApp = useTestServer();

	it("marks one article read in All, Weekend and Work and leaves unselected and other readers' articles unread", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { server, auth } = useLocalApp(fixture);
		const agent = await loginAgent(server, auth);
		const shared = "https://example.org/shared-reading";
		const unrelated = "https://example.org/unrelated-reading";
		await agent.post("/queue/save").type("form").send({ url: unrelated });
		await agent.post("/queue/save").type("form").send({ url: shared });
		const other = await loginSecondReader(server, auth);
		await other.post("/queue/save").type("form").send({ url: shared });
		const user = await fixture.auth.findUserByEmail("test@example.com");
		const second = await fixture.auth.findUserByEmail("second@example.com");
		assert(user && second);
		for (const label of ["Weekend", "Work"]) await agent.post("/queue/queues").type("form").send({ label });
		const lists = await fixture.articleStore.listReadlistDefinitions(user.userId);
		const saved = await fixture.articleStore.findArticleByUrl(shared);
		const unrelatedSave = await fixture.articleStore.findArticleByUrl(unrelated);
		assert(saved && unrelatedSave && lists.length === 2);
		for (const list of lists) {
			await fixture.articleStore.assignSavedArticleToReadlist({ userId: user.userId, readlist: list.slug, from: DEFAULT_READLIST_SLUG, url: shared, savedAt: new Date() });
			await fixture.articleStore.assignSavedArticleToReadlist({ userId: user.userId, readlist: list.slug, from: DEFAULT_READLIST_SLUG, url: unrelated, savedAt: new Date() });
		}

		const listing = view((await agent.get("/queue").expect(200)).text);
		const button = listing.querySelector("form[action*='/manage/preview'] button[value=read-everywhere]");
		expect(button?.textContent).toBe("Mark as read in every readlist");
		expect(view((await agent.get("/queue?tab=done").expect(200)).text).querySelector("button[value=read-everywhere]")).toBeNull();
		await agent.post("/queue/manage/preview?tab=done").type("form").send({ extent: "all", action: "read-everywhere" }).expect(409);

		const card = [...listing.querySelectorAll("input[name=visible]")].map(input => input.getAttribute("value"));
		expect(card).toContain(saved.id.value);
		const preview = await agent.post("/queue/manage/preview").type("form")
			.send({ extent: "page", action: "read-everywhere", visible: saved.id.value }).expect(303);
		const status = async () => view((await agent.get(preview.headers.location).expect(200)).text);
		const before = await status();
		expect(before.querySelector(".bulk-status p")?.textContent?.trim()).toBe("Mark as read in every readlist");
		expect(count(before, "Selected")).toBe("1");
		await agent.post(`${preview.headers.location}/confirm`).expect(303);
		const finished = await status();
		expect(finished.querySelector("main [role=status]")?.textContent).toBe("Finished");
		expect(count(finished, "Completed")).toBe("1");
		expect(count(finished, "Skipped")).toBe("0");

		expect(await fixture.articleStore.findArticleById(saved.id, user.userId)).toMatchObject({ status: "read" });
		for (const list of lists) {
			expect(await fixture.articleStore.findReadlistArticleById({ id: saved.id, userId: user.userId, readlist: list.slug })).toMatchObject({ status: "read" });
			expect(await fixture.articleStore.findReadlistArticleById({ id: unrelatedSave.id, userId: user.userId, readlist: list.slug })).toMatchObject({ status: "unread" });
		}
		expect(await fixture.articleStore.findArticleById(unrelatedSave.id, user.userId)).toMatchObject({ status: "unread" });
		expect(await fixture.articleStore.findArticleById(saved.id, second.userId)).toMatchObject({ status: "unread" });
		const readTab = view((await agent.get("/queue?tab=done").expect(200)).text);
		expect([...readTab.querySelectorAll("input[name=visible]")].map(input => input.getAttribute("value"))).toEqual([saved.id.value]);
	});

	it("keeps the legacy action's narrower label and scope for a job created with it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { server, auth } = useLocalApp(fixture);
		const agent = await loginAgent(server, auth);
		const url = "https://example.org/legacy-reading";
		await agent.post("/queue/save").type("form").send({ url });
		await agent.post("/queue/queues").type("form").send({ label: "Morning" });
		const user = await fixture.auth.findUserByEmail("test@example.com");
		assert(user);
		const [list] = await fixture.articleStore.listReadlistDefinitions(user.userId);
		assert(list);
		await fixture.articleStore.assignSavedArticleToReadlist({ userId: user.userId, readlist: list.slug, from: DEFAULT_READLIST_SLUG, url, savedAt: new Date() });
		const legacy = await agent.post("/queue/manage/preview").type("form").send({ extent: "all", action: "read" }).expect(303);
		const preview = view((await agent.get(legacy.headers.location).expect(200)).text);
		expect(preview.querySelector(".bulk-status p")?.textContent?.trim()).toBe(t("manage.action.read"));
		await agent.post(`${legacy.headers.location}/confirm`).expect(303);
		const saved = await fixture.articleStore.findArticleByUrl(url);
		assert(saved);
		expect(await fixture.articleStore.findArticleById(saved.id, user.userId)).toMatchObject({ status: "read" });
		expect(await fixture.articleStore.findReadlistArticleById({ id: saved.id, userId: user.userId, readlist: list.slug })).toMatchObject({ status: "unread" });
	});

	it("skips an article whose save changed after preview and counts it once", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { server, auth } = useLocalApp(fixture);
		const agent = await loginAgent(server, auth);
		const urls = ["https://example.org/kept-unread", "https://example.org/changed-before-confirm"];
		for (const url of urls) await agent.post("/queue/save").type("form").send({ url });
		const preview = await agent.post("/queue/manage/preview").type("form").send({ extent: "all", action: "read-everywhere" }).expect(303);
		const user = await fixture.auth.findUserByEmail("test@example.com");
		const changed = await fixture.articleStore.findArticleByUrl(urls[1]);
		assert(user && changed);
		await fixture.articleStore.updateArticleStatus(changed.id, user.userId, "read");
		await fixture.articleStore.updateArticleStatus(changed.id, user.userId, "unread");
		await agent.post(`${preview.headers.location}/confirm`).expect(303);
		const finished = view((await agent.get(preview.headers.location).expect(200)).text);
		expect(count(finished, "Completed")).toBe("1");
		expect(count(finished, "Skipped")).toBe("1");
		expect(await fixture.articleStore.findArticleById(changed.id, user.userId)).toMatchObject({ status: "unread" });
	});
});

describe("unfinished work of the new action", () => {
	const store = initInMemoryBulkSelections();
	const dispatch = jest.fn(async () => {});
	const useApp = useTestServer({ bulkArticles: { store, dispatch, readEverywhere: true } });

	it("names the remainder of a failed run as unfinished articles and offers to retry it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { server, auth } = useApp(fixture);
		const agent = await loginAgent(server, auth);
		const user = await fixture.auth.findUserByEmail("test@example.com");
		assert(user);
		const job = newSelection(user.userId, { extent: "all", source: "all", status: "unread", page: 1, order: "desc", action: { kind: "read-everywhere" } }, new Date());
		await store.create(job);
		store.checkpoint({ ...job, state: "failed", failedState: "running", generation: 4, selected: 10, completed: 1, failed: 9 });
		const location = `/queue/manage/${job.id}`;
		const failed = view((await agent.get(location).expect(200)).text);
		expect(count(failed, "Completed")).toBe("1");
		expect(count(failed, "Unfinished articles")).toBe("9");
		expect(count(failed, "Failed")).toBeUndefined();
		expect(failed.querySelector("main form button")?.textContent).toBe("Retry unfinished work");
		await agent.post(`${location}/retry`).expect(303);
		expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: job.id, generation: 4, intent: "retry" }));
		const resumed = await store.get(user.userId, job.id);
		assert(resumed);
		store.checkpoint({ ...resumed, state: "completed", generation: 5, completed: 10 });
		const finished = view((await agent.get(location).expect(200)).text);
		expect(count(finished, "Completed")).toBe("10");
		expect(count(finished, "Failed")).toBe("0");

		const legacy = newSelection(user.userId, { extent: "all", source: "all", status: "unread", page: 1, order: "desc", action: { kind: "read" } }, new Date());
		await store.create(legacy);
		store.checkpoint({ ...legacy, state: "failed", failedState: "running", generation: 2, selected: 3, completed: 1, failed: 2 });
		const historical = view((await agent.get(`/queue/manage/${legacy.id}`).expect(200)).text);
		expect(count(historical, "Failed")).toBe("2");
		expect(count(historical, "Unfinished articles")).toBeUndefined();
	});
});

describe("the new action's confirmation window", () => {
	const useLocalApp = useTestServer();

	it("shows the confirm-by time and refuses the preview once it expired", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let instant = Date.now();
		fixture.shared.now = () => new Date(instant);
		const { server, auth } = useLocalApp(fixture);
		const agent = await loginAgent(server, auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.org/window" });
		instant = Date.now() + 60_000;
		const created = instant;
		const preview = await agent.post("/queue/manage/preview").type("form").send({ extent: "all", action: "read-everywhere" }).expect(303);
		const first = view((await agent.get(preview.headers.location).expect(200)).text);
		expect(first.querySelector("main time")?.getAttribute("datetime")).toBe(new Date(Math.floor(created / 1000) * 1000 + HOUR).toISOString());
		instant = created + 25 * HOUR;
		await agent.get(preview.headers.location).expect(410);
		await agent.post(`${preview.headers.location}/confirm`).expect(410);
	});
});

describe("a local preparation that outlives the confirmation window", () => {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	let instant = Date.now();
	const now = () => new Date(instant);
	fixture.shared.now = now;
	const pages: number[] = [];
	const ops = initLocalBulkOperations({
		articles: { ...fixture.articleStore, findArticlesByUser: async query => {
			pages.push(query.page ?? 1);
			instant += 25 * HOUR;
			return fixture.articleStore.findArticlesByUser(query);
		} },
		findArticleById: fixture.articleStore.findArticleById, findUserById: fixture.auth.findUserById,
		listSenderIssues: fixture.inboxEmail.inboxEmailStore.listEmailsByUserId, listIssueLinks: fixture.inboxEmail.inboxEmailLinkStore.listLinksByEmail,
		resolveCanonicalIdentity: async url => url, publishLinkQueued: fixture.events.publishLinkQueued, publishLinkDequeued: fixture.events.publishLinkDequeued, now,
	});
	const useApp = useTestServer({ bulkArticles: ops });

	it("reads the final page once, settles the dispatcher and answers the preview with 410", async () => {
		const { server, auth } = useApp(fixture);
		const agent = await loginAgent(server, auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.org/late-page" });
		instant = Date.now() + 60_000;
		const preview = await agent.post("/queue/manage/preview").type("form").send({ extent: "all", action: "read-everywhere" }).expect(303);
		expect(pages).toEqual([1]);
		await agent.get(preview.headers.location).expect(410);
		const user = await fixture.auth.findUserByEmail("test@example.com");
		assert(user);
		expect(await ops.store.get(user.userId, String(preview.headers.location.split("/").at(-1)))).toMatchObject({ state: "preparing", selected: 0 });
	});
});
