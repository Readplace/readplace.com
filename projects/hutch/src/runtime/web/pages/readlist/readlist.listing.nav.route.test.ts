import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;

const useApp = useTestServer();

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

const PER_REQUEST_NONCE = /nonce="[^"]*"/g;

function mainMarkup(doc: Document): string {
	const main = doc.querySelector("main.readlist");
	assert(main, "the readlist page must render a main landmark");
	return main.innerHTML.replace(PER_REQUEST_NONCE, 'nonce="[normalised]"');
}

function readlistNavLinks(doc: Document): Element[] {
	const nav = doc.querySelector("main.readlist nav.readlist-nav");
	assert(nav, "the readlist nav must render inside the swappable main");
	return Array.from(nav.querySelectorAll("[data-test-readlist]"));
}

/** Only the readlist page's own <main> — the global header nav also links to
 * /queue, and leaving the readlist surface is where a dev toggle is meant to drop. */
function readlistUrlsIn(doc: Document): string[] {
	const main = doc.querySelector("main.readlist");
	assert(main, "the readlist page must render a main landmark");
	const attributeBySelector = [
		["a[href]", "href"],
		["form[action]", "action"],
		["[hx-get]", "hx-get"],
	] as const;
	return attributeBySelector
		.flatMap(([selector, attribute]) =>
			Array.from(main.querySelectorAll(selector)).map((el) => el.getAttribute(attribute)),
		)
		.filter((url): url is string => Boolean(url?.startsWith("/queue")));
}

function saveFormAction(doc: Document): string {
	const form = doc.querySelector('[data-test-form="save-article"]');
	assert(form, "the readlist page must render the save bar");
	return form.getAttribute("action") ?? "";
}

async function seedInto(harness: TestHarness, readlist: string, url: string) {
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return harness.articleStore.saveReadlistArticle({
		userId,
		readlist: ReadlistSlugSchema.parse(readlist),
		url,
		metadata: { title: url, siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" },
		savedAt: new Date(),
	});
}

function countsUrl(doc: Document): string {
	const trigger = doc.querySelector("[data-test-readlist-counts]");
	assert(trigger, "the readlist page must arm the counts loader");
	return trigger.getAttribute("hx-get") ?? "";
}

async function createReadlist(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues?feature=queues");
	assert.equal(response.status, 303, "creating a readlist must redirect to it");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert.ok(slug, "creating a readlist must land the reader on it");
	return slug;
}

describe("Readlist nav", () => {
	describe("GET /queue", () => {
		it("should name the one readlist the reader has and mark it as the one being viewed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue?feature=queues")).text);

			const links = readlistNavLinks(doc);
			expect(links.map((el) => el.getAttribute("data-test-readlist"))).toEqual(["default"]);
			expect(links.map((el) => el.textContent)).toEqual(["All"]);
			expect(links.map((el) => el.getAttribute("aria-current"))).toEqual(["page"]);
		});

		it("should title the document with the readlist being viewed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue")).text);

			expect(doc.title).toBe("All — Readplace");
		});

		it("should pair the readlist nav with the listing it scopes", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue?feature=queues")).text);

			const body = doc.querySelector("main.readlist .readlist__body");
			assert(body, "the readlist nav and the listing must share a container");
			expect(Array.from(body.children).map((el) => el.className.split(" ")[0])).toEqual([
				"readlist-nav",
				"readlist__content",
			]);
			const saveForm = body.querySelector('.readlist__content [data-test-form="save-article"]');
			assert(saveForm, "the save bar must live inside the readlist panel");
			expect(saveForm.getAttribute("method")).toBe("POST");
		});

		it("should give every navigation landmark on the page its own name", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });

			const doc = parse((await agent.get("/queue?feature=queues")).text);

			const labels = Array.from(doc.querySelectorAll("nav")).map((el) =>
				el.getAttribute("aria-label"),
			);
			expect(labels).toEqual(["Main", "Readlists", "Article filters"]);
		});

		it("should render the readlist being viewed the same way whether or not the URL names it", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const bare = parse((await agent.get("/queue?feature=queues")).text);
			const named = parse((await agent.get("/queue?feature=queues&queue=default")).text);

			expect(mainMarkup(named)).toBe(mainMarkup(bare));
		});

		it("should fall back to the default readlist when the URL names a readlist the reader does not have", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/queue?feature=queues&queue=someone-elses");

			expect(response.status).toBe(200);
			const doc = parse(response.text);
			expect(readlistNavLinks(doc).map((el) => el.getAttribute("data-test-readlist"))).toEqual([
				"default",
			]);
			expect(readlistNavLinks(doc).map((el) => el.textContent)).toEqual(["All"]);
		});

		it("should keep the read-state filter selectable while the URL names the readlist", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue?feature=queues&queue=default&tab=done")).text);

			const active = Array.from(doc.querySelectorAll(".readlist__filter-link--active")).map((el) =>
				el.getAttribute("data-test-filter"),
			);
			expect(active).toEqual(["read"]);
		});

		it("should carry the readlists toggle on every link and form the page emits, so the rail survives a click", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });

			const doc = parse((await agent.get("/queue?feature=queues&queue=default")).text);

			const urls = readlistUrlsIn(doc);
			expect(urls.length).toBeGreaterThan(0);
			expect(urls.filter((url) => !url.includes("feature=queues"))).toEqual([]);
		});

		it("should leave the default readlist unnamed and name every other readlist the reader opens", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent);
			await seedInto(harness, readlist, "https://example.com/a");

			const onDefault = parse((await agent.get("/queue?feature=queues")).text);
			expect(countsUrl(onDefault)).toBe("/queue/counts?feature=queues");

			const onWork = parse((await agent.get(`/queue?feature=queues&queue=${readlist}`)).text);
			expect(countsUrl(onWork)).toBe(`/queue/counts?queue=${readlist}&feature=queues`);
			const cardUrls = readlistUrlsIn(onWork).filter((url) => url.includes("/queue/0"));
			expect(cardUrls.length).toBeGreaterThan(0);
			expect(cardUrls.filter((url) => !url.includes(`queue=${readlist}`))).toEqual([]);
		});

		it("should point the save bar at the default readlist from every readlist the reader opens", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent);

			const onDefault = parse((await agent.get("/queue?feature=queues")).text);
			const onWork = parse((await agent.get(`/queue?feature=queues&queue=${readlist}`)).text);

			const expectedSaveAction =
				"/queue/save?feature=queues&utm_source=queue&utm_medium=internal&utm_content=save";
			expect(saveFormAction(onDefault)).toBe(expectedSaveAction);
			expect(saveFormAction(onWork)).toBe(expectedSaveAction);
		});

		it("should keep the reader on the flagged view when clamping a page past the end of the listing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/queue?feature=queues&queue=default&page=2");

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe("/queue?feature=queues");
		});
	});

	describe("GET /queue without the readlists feature", () => {
		it("should render the single-readlist page the feature wraps", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue")).text);

			const main = doc.querySelector("main.readlist");
			assert(main, "the readlist page must render a main landmark");
			expect(main.className).toBe("readlist");
			const body = main.querySelector(".readlist__body");
			assert(body, "the listing container must render in both modes");
			expect(Array.from(body.children).map((el) => el.className.split(" ")[0])).toEqual([
				"readlist__content",
			]);
			expect(doc.querySelector(".readlist__title")?.textContent).toBe("All");
		});

		it("should mark the page for the tabbed layout only when the feature asks for it", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const flagged = parse((await agent.get("/queue?feature=queues")).text);

			const main = flagged.querySelector("main.readlist");
			assert(main, "the readlist page must render a main landmark");
			expect(main.className).toBe("readlist readlist--readlists");
			const header = main.querySelector(".readlist__header");
			assert(header, "the title block must stay rendered for the styles to hide");
			expect(flagged.title).toBe("All — Readplace");
		});
	});

	describe("POST /queue/:id/status", () => {
		it("should send the reader back to a listing URL that does not name the readlist", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });
			const doc = parse((await agent.get("/queue")).text);
			const articleId = doc.querySelector("[data-test-article]")?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render a card");

			const response = await agent
				.post(`/queue/${articleId}/status?queue=default`)
				.type("form")
				.send({ status: "read" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/queue?status_changed=read&status_article=${articleId}`,
			);
		});
	});
});
