import { newSelection } from "../../../bulk-articles/selection";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";
import { initInMemoryBulkSelections } from "../../../bulk-articles/selection-store";

const store = initInMemoryBulkSelections();
const dispatch = jest.fn(async () => {});
const useApp = useTestServer({ bulkArticles: { store, dispatch, readEverywhere: true } });

it("previews the visible owned identities and only requests work after an explicit confirmation", async () => {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { server, auth } = useApp(fixture);
	const agent = await loginAgent(server, auth);
	await agent.post("/queue/save").type("form").send({ url: "https://example.org/first" });
	const listing = new JSDOM((await agent.get("/queue").expect(200)).text).window.document;
	const form = listing.querySelector<HTMLFormElement>("form[action*='/manage/preview']");
	assert(form);
	expect(form.querySelector("select")).toBeNull();
	expect(form.querySelector("details.menu button[value=remove]")).toBeTruthy();
	const visible = form.querySelector<HTMLInputElement>("input[name=visible]")?.value;
	assert(visible);
	await agent.post("/queue/save").type("form").send({ url: "https://example.org/later" });
	const action = form.getAttribute("action");
	assert(action);
	const preview = await agent.post(action).type("form").send({ action: "remove", extent: "page", visible }).expect(303);
	const location = preview.headers.location;
	const html = new JSDOM((await agent.get(location).expect(200)).text).window.document;
	expect(html.querySelector("dd")?.textContent).toBe("1");
	expect(html.querySelector("main")?.textContent).toContain("Remove from the default readlist");
	expect(dispatch).not.toHaveBeenCalled();
	await agent.post(`${location}/confirm`).expect(303);
	expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: location.split("/").at(-1), generation: 1, intent: "confirm" }));
	await agent.post(`${location}/confirm`).expect(409);
	const accepted = new JSDOM((await agent.get(location).expect(200)).text).window.document;
	expect(accepted.querySelector("main [role=status]")?.textContent).toBe("Applying changes");
	expect(accepted.querySelector("main")?.getAttribute("hx-trigger")).toBe("every 5s");
	expect(accepted.querySelector("main a")?.textContent).toBe("Refresh progress");
	await agent.get("/queue/manage/unrelated").expect(404);
	const foreign = newSelection(UserIdSchema.parse("another-reader"), { extent: "all", source: "all", status: "read", page: 1, order: "desc", action: { kind: "remove" } }, new Date());
	await store.create(foreign);
	await agent.get(`/queue/manage/${foreign.id}`).expect(404);
	await agent.post(`/queue/manage/${foreign.id}/confirm`).expect(404);
});

const useLocalApp = useTestServer();

it("previews all matching articles across pages, retains later arrivals and restores only eligible originals", async () => {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { server, auth } = useLocalApp(fixture);
	const agent = await loginAgent(server, auth);
	const urls = Array.from({ length: 23 }, (_, i) => `https://example.org/bulk-source-${i}`);
	for (const url of urls) await agent.post("/queue/save").type("form").send({ url });
	const prepare = await agent.post("/queue/manage/preview").type("form").send({ extent: "all", action: "remove" }).expect(303);
	const status = async () => new JSDOM((await agent.get(prepare.headers.location).expect(200)).text).window.document;
	const count = (doc: Document, label: string) => [...doc.querySelectorAll("main dt")].find(dt => dt.textContent === label)?.nextElementSibling?.textContent;
	expect(count(await status(), "Selected")).toBe("23");
	await agent.post("/queue/save").type("form").send({ url: "https://example.org/later-arrival" });
	const user = await fixture.auth.findUserByEmail("test@example.com");
	const first = await fixture.articleStore.findArticleByUrl(urls[0]);
	assert(user && first);
	await fixture.articleStore.updateArticleStatus(first.id, user.userId, "read");
	await fixture.articleStore.updateArticleStatus(first.id, user.userId, "unread");
	await agent.post(`${prepare.headers.location}/confirm`).expect(303);
	await agent.post(`${prepare.headers.location}/confirm`).expect(409);
	const removed = await status();
	expect(count(removed, "Skipped")).toBe("1");
	expect(count(removed, "Restorable")).toBe("22");
	await agent.post("/queue/save").type("form").send({ url: urls[1] });
	await agent.post(`${prepare.headers.location}/restore`).expect(303);
	const restored = await status();
	expect(count(restored, "Restored")).toBe("21");
	expect(count(restored, "Restorable")).toBe("0");
	expect(await fixture.articleStore.countArticlesByUser({ userId: user.userId })).toBe(24);
}, 30000);

it("names the filing destination in the preview and keeps its copy unread when the default readlist is marked read", async () => {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { server, auth } = useLocalApp(fixture);
	const agent = await loginAgent(server, auth);
	const url = "https://example.org/weekend-reading";
	await agent.post("/queue/save").type("form").send({ url });
	await agent.post("/queue/queues").type("form").send({ label: "Weekend" });
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user);
	const [destination] = await fixture.articleStore.listReadlistDefinitions(user.userId);
	assert(destination);
	const filing = await agent.post("/queue/manage/preview").type("form")
		.send({ extent: "all", action: `file/${destination.slug}` }).expect(303);
	const preview = new JSDOM((await agent.get(filing.headers.location).expect(200)).text).window.document;
	expect(preview.querySelector(".bulk-status p")?.textContent).toBe("Add to readlist Weekend");
	await agent.post(`${filing.headers.location}/confirm`).expect(303);
	const reading = await agent.post("/queue/manage/preview").type("form").send({ extent: "all", action: "read" }).expect(303);
	await agent.post(`${reading.headers.location}/confirm`).expect(303);
	const saved = await fixture.articleStore.findArticleByUrl(url);
	assert(saved);
	expect(await fixture.articleStore.findArticleById(saved.id, user.userId)).toMatchObject({ status: "read" });
	expect(await fixture.articleStore.findReadlistArticleById({ id: saved.id, userId: user.userId, readlist: destination.slug })).toMatchObject({ status: "unread" });
});

it("names the job's return link for the home readlist it opens", async () => {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { server, auth } = useLocalApp(fixture);
	const agent = await loginAgent(server, auth);
	await agent.post("/queue/save").type("form").send({ url: "https://example.org/default-only" });
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user);
	const slug = ReadlistSlugSchema.parse("weekend");
	const createdAt = new Date("2026-11-01T01:00:00Z");
	await fixture.articleStore.createReadlistDefinition({ userId: user.userId, slug, label: "Weekend", createdAt });
	await agent.post(`/queue/queues/${slug}/home?createdAt=${encodeURIComponent(createdAt.toISOString())}`)
		.type("form").send({ returnTo: "/queue?queue=default" }).expect(303);
	const explicitDefault = new JSDOM((await agent.get("/queue?queue=default").expect(200)).text).window.document;
	expect(explicitDefault.querySelector('[data-test-readlist][aria-current="page"]')?.getAttribute("data-test-readlist")).toBe("default");
	const preview = await agent.post("/queue/manage/preview").type("form").send({ extent: "all", action: "read" }).expect(303);
	const status = new JSDOM((await agent.get(preview.headers.location).expect(200)).text).window.document;
	expect(status.querySelector(".bulk-status p")?.textContent?.trim()).toBe("Mark as read in the default readlist");
	const back = [...status.querySelectorAll<HTMLAnchorElement>("main a")].find((link) => link.textContent === "Open home readlist");
	assert(back, "the job page must link back to the home readlist");
	const href = new URL(back.href, TEST_APP_ORIGIN);
	expect(href.pathname).toBe("/queue");
	expect(href.searchParams.get("utm_content")).toBe("back");
	const followed = new JSDOM((await agent.get(`${href.pathname}${href.search}`).expect(200)).text).window.document;
	expect(followed.querySelector('[data-test-readlist][aria-current="page"]')?.getAttribute("data-test-readlist")).toBe(slug);
});
