import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

const useApp = useTestServer();

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

const PER_REQUEST_NONCE = /nonce="[^"]*"/g;

function mainMarkup(doc: Document): string {
	const main = doc.querySelector("main.queue");
	assert(main, "the queue page must render a main landmark");
	return main.innerHTML.replace(PER_REQUEST_NONCE, 'nonce="[normalised]"');
}

function queueNavLinks(doc: Document): Element[] {
	const nav = doc.querySelector("main.queue nav.queue-nav");
	assert(nav, "the queue nav must render inside the swappable main");
	return Array.from(nav.querySelectorAll("[data-test-queue]"));
}

/** Only the queue page's own <main> — the global header nav also links to
 * /queue, and leaving the queue surface is where a dev toggle is meant to drop. */
function queueUrlsIn(doc: Document): string[] {
	const main = doc.querySelector("main.queue");
	assert(main, "the queue page must render a main landmark");
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
	assert(form, "the queue page must render the save bar");
	return form.getAttribute("action") ?? "";
}

function countsUrl(doc: Document): string {
	const trigger = doc.querySelector("[data-test-queue-counts]");
	assert(trigger, "the queue page must arm the counts loader");
	return trigger.getAttribute("hx-get") ?? "";
}

async function createQueue(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues?feature=queues");
	assert.equal(response.status, 303, "creating a queue must redirect to it");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert.ok(slug, "creating a queue must land the reader on it");
	return slug;
}

describe("Queue nav", () => {
	describe("GET /queue", () => {
		it("should name the one queue the reader has and mark it as the one being viewed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue?feature=queues")).text);

			const links = queueNavLinks(doc);
			expect(links.map((el) => el.getAttribute("data-test-queue"))).toEqual(["default"]);
			expect(links.map((el) => el.textContent)).toEqual(["My Queue"]);
			expect(links.map((el) => el.getAttribute("aria-current"))).toEqual(["page"]);
		});

		it("should title the document with the queue being viewed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue")).text);

			expect(doc.title).toBe("My Queue — Readplace");
		});

		it("should pair the queue nav with the listing it scopes", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue?feature=queues")).text);

			const body = doc.querySelector("main.queue .queue__body");
			assert(body, "the queue nav and the listing must share a container");
			expect(Array.from(body.children).map((el) => el.className.split(" ")[0])).toEqual([
				"queue-nav",
				"queue__content",
			]);
			const saveForm = body.querySelector('.queue__content [data-test-form="save-article"]');
			assert(saveForm, "the save bar must live inside the queue panel");
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
			expect(labels).toEqual(["Main", "Queues", "Article filters"]);
		});

		it("should render the queue being viewed the same way whether or not the URL names it", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const bare = parse((await agent.get("/queue?feature=queues")).text);
			const named = parse((await agent.get("/queue?feature=queues&queue=default")).text);

			expect(mainMarkup(named)).toBe(mainMarkup(bare));
		});

		it("should fall back to the default queue when the URL names a queue the reader does not have", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/queue?feature=queues&queue=someone-elses");

			expect(response.status).toBe(200);
			const doc = parse(response.text);
			expect(queueNavLinks(doc).map((el) => el.getAttribute("data-test-queue"))).toEqual([
				"default",
			]);
			expect(queueNavLinks(doc).map((el) => el.textContent)).toEqual(["My Queue"]);
		});

		it("should keep the read-state filter selectable while the URL names the queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue?feature=queues&queue=default&tab=done")).text);

			const active = Array.from(doc.querySelectorAll(".queue__filter-link--active")).map((el) =>
				el.getAttribute("data-test-filter"),
			);
			expect(active).toEqual(["read"]);
		});

		it("should carry the queues toggle on every link and form the page emits, so the rail survives a click", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });

			const doc = parse((await agent.get("/queue?feature=queues&queue=default")).text);

			const urls = queueUrlsIn(doc);
			expect(urls.length).toBeGreaterThan(0);
			expect(urls.filter((url) => !url.includes("feature=queues"))).toEqual([]);
		});

		it("should leave the default queue unnamed and name every other queue the reader opens", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const queue = await createQueue(agent);
			await agent
				.post(`/queue/save?feature=queues&queue=${queue}`)
				.type("form")
				.send({ url: "https://example.com/a" });

			const onDefault = parse((await agent.get("/queue?feature=queues")).text);
			expect(saveFormAction(onDefault)).toBe(
				"/queue/save?feature=queues&utm_source=queue&utm_medium=internal&utm_content=save",
			);
			expect(countsUrl(onDefault)).toBe("/queue/counts?feature=queues");

			const onWork = parse((await agent.get(`/queue?feature=queues&queue=${queue}`)).text);
			expect(saveFormAction(onWork)).toBe(
				`/queue/save?queue=${queue}&feature=queues&utm_source=queue&utm_medium=internal&utm_content=save`,
			);
			expect(countsUrl(onWork)).toBe(`/queue/counts?queue=${queue}&feature=queues`);
			const cardUrls = queueUrlsIn(onWork).filter((url) => url.includes("/queue/0"));
			expect(cardUrls.length).toBeGreaterThan(0);
			expect(cardUrls.filter((url) => !url.includes(`queue=${queue}`))).toEqual([]);
		});

		it("should keep the reader on the flagged view when clamping a page past the end of the listing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/queue?feature=queues&queue=default&page=2");

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe("/queue?feature=queues");
		});
	});

	describe("GET /queue without the queues feature", () => {
		it("should render the single-queue page the feature wraps", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue")).text);

			const main = doc.querySelector("main.queue");
			assert(main, "the queue page must render a main landmark");
			expect(main.className).toBe("queue");
			const body = main.querySelector(".queue__body");
			assert(body, "the listing container must render in both modes");
			expect(Array.from(body.children).map((el) => el.className.split(" ")[0])).toEqual([
				"queue__content",
			]);
			expect(doc.querySelector(".queue__title")?.textContent).toBe("My Queue");
		});

		it("should mark the page for the tabbed layout only when the feature asks for it", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const flagged = parse((await agent.get("/queue?feature=queues")).text);

			const main = flagged.querySelector("main.queue");
			assert(main, "the queue page must render a main landmark");
			expect(main.className).toBe("queue queue--queues");
			const header = main.querySelector(".queue__header");
			assert(header, "the title block must stay rendered for the styles to hide");
			expect(flagged.title).toBe("My Queue — Readplace");
		});
	});

	describe("POST /queue/:id/status", () => {
		it("should send the reader back to a listing URL that does not name the queue", async () => {
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
