import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { QueueSlugSchema } from "@packages/domain/queue";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function articleIds(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-article]"), (el) =>
		el.getAttribute("data-test-article"),
	).filter((id): id is string => Boolean(id));
}

async function createQueueAndOpen(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues?feature=queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a queue must land the reader on it");
	return slug;
}

async function seedInto(harness: TestHarness, queue: string, url: string) {
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return harness.articleStore.saveQueueArticle({
		userId,
		queue: QueueSlugSchema.parse(queue),
		url,
		metadata: { title: url, siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" },
		savedAt: new Date(),
	});
}

async function readerWithTwoQueues(harness: TestHarness): Promise<{
	agent: TestAgent;
	queue: string;
	articleId: string;
}> {
	const agent = await loginAgent(harness.server, harness.auth);
	const queue = await createQueueAndOpen(agent);
	await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });
	await seedInto(harness, queue, "https://example.com/a");
	const [articleId] = articleIds(parse((await agent.get("/queue")).text));
	assert(articleId, "the saved article must render a card");
	return { agent, queue, articleId };
}

function panels(doc: Document): Element[] {
	return [...doc.querySelectorAll("[data-test-confirm-popover='mark-status']")];
}

describe("Mark-as-read confirmation", () => {
	it("stays out of the way of a reader who owns no custom queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/solo" });

		const doc = parse((await agent.get("/queue")).text);

		expect(panels(doc)).toHaveLength(0);
		const form = doc.querySelector("[data-test-action='mark-read']")?.closest("form");
		assert(form, "the card must still carry its plain mark-read form");
		expect(form.getAttribute("action")).toContain("swap=card");
		expect(form.getAttribute("hx-target")).toBe("closest .queue-article");
	});

	it("renders one panel per article at <main> level once the reader owns a queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await readerWithTwoQueues(harness);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/b" });

		const doc = parse((await agent.get("/queue?feature=queues")).text);
		const rendered = panels(doc);

		expect(rendered).toHaveLength(2);
		for (const panel of rendered) {
			expect(panel.parentElement?.tagName).toBe("MAIN");
			expect(panel.closest(".queue-article")).toBeNull();
			expect(panel.getAttribute("popover")).toBe("auto");
			expect(panel.getAttribute("role")).toBe("dialog");
			expect(panel.hasAttribute("aria-modal")).toBe(false);
		}
	});

	it("hands the card's own test hook to the trigger and renames the no-popover form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await readerWithTwoQueues(harness);

		const doc = parse((await agent.get("/queue?feature=queues")).text);
		const trigger = doc.querySelector("[data-test-action='mark-read']");
		const fallback = doc.querySelector("[data-test-action='mark-read-fallback']");

		assert(trigger, "the popover trigger must answer to the card's mark-read hook");
		assert(fallback, "the plain form must stay as the no-popover fallback");
		expect(trigger.tagName).toBe("BUTTON");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.closest("form")).toBeNull();
		expect(fallback.getAttribute("type")).toBe("submit");
		expect(fallback.closest("form")?.classList.contains("queue-article__status-fallback")).toBe(
			true,
		);
	});

	it("points every card's trigger at that same card's panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await readerWithTwoQueues(harness);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/b" });

		const doc = parse((await agent.get("/queue?feature=queues")).text);
		const triggersByArticle = new Map(
			[...doc.querySelectorAll(".queue-article")].map((card) => [
				card.getAttribute("data-test-article"),
				card.querySelector("[data-test-action='mark-read']")?.getAttribute("popovertarget"),
			]),
		);
		const panelsByArticle = new Map(
			panels(doc).map((panel) => [
				panel.getAttribute("data-test-confirm-subject"),
				panel.getAttribute("id"),
			]),
		);

		expect(triggersByArticle.size).toBe(2);
		expect(triggersByArticle).toEqual(panelsByArticle);
	});

	it("names only the queues that article actually sits in, one bullet each", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await readerWithTwoQueues(harness);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/default-only" });

		const doc = parse((await agent.get("/queue?feature=queues")).text);
		const listed = panels(doc).map((panel) =>
			[...panel.querySelectorAll(".confirm-popover__items li")].map((li) => li.textContent),
		);

		expect(listed).toContainEqual(["My Queue", "New Queue"]);
		expect(listed).toContainEqual(["My Queue"]);
		for (const panel of panels(doc)) {
			expect(panel.querySelector(".confirm-popover__body")?.textContent).toBe(
				"This article will be marked as read in all queues it belongs to:",
			);
		}
	});

	it("dismisses with the close control rather than changing anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await readerWithTwoQueues(harness);

		const doc = parse((await agent.get("/queue?feature=queues")).text);
		const [panel] = panels(doc);
		assert(panel, "the confirmation panel must be rendered");
		const close = doc.querySelector("[data-test-action='mark-status-dismiss']");
		assert(close, "close control must be rendered");

		expect(close.getAttribute("type")).toBe("button");
		expect(close.getAttribute("popovertargetaction")).toBe("hide");
		expect(close.getAttribute("popovertarget")).toBe(panel.getAttribute("id"));
		expect(close.closest("form")).toBeNull();
	});

	it("marks the article read in every queue when the reader confirms once", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, queue, articleId } = await readerWithTwoQueues(harness);

		await agent
			.post(`/queue/${articleId}/status?feature=queues&queue=${queue}`)
			.type("form")
			.send({ status: "read" });

		expect(articleIds(parse((await agent.get("/queue?tab=done")).text))).toEqual([articleId]);
		expect(
			articleIds(parse((await agent.get(`/queue?feature=queues&queue=${queue}&tab=done`)).text)),
		).toEqual([articleId]);
	});

	it("keeps showing the panel after a plain confirmation", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await readerWithTwoQueues(harness);

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

		expect(panels(parse((await agent.get("/queue?feature=queues&tab=done")).text))).toHaveLength(1);
	});

	it("performs the change and silences the panel for good on the second button", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, queue, articleId } = await readerWithTwoQueues(harness);

		await agent
			.post(`/queue/${articleId}/status?feature=queues&queue=${queue}`)
			.type("form")
			.send({ status: "read", ack: "never" });

		const done = parse((await agent.get("/queue?feature=queues&tab=done")).text);
		expect(articleIds(done)).toEqual([articleId]);
		expect(panels(done)).toHaveLength(0);
		expect(
			articleIds(parse((await agent.get(`/queue?feature=queues&queue=${queue}&tab=done`)).text)),
		).toEqual([articleId]);
		const form = done.querySelector("[data-test-action='mark-unread']")?.closest("form");
		assert(form, "the card must be back on its plain mark-unread form");
		expect(form.getAttribute("action")).toContain("swap=card");
	});

	it("keeps the panel gone on every later visit and in the reader too", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await readerWithTwoQueues(harness);
		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read", ack: "never" });

		const reader = parse((await agent.get(`/queue/${articleId}/view`)).text);

		expect(panels(reader)).toHaveLength(0);
		expect(reader.querySelector("[data-test-mark-read-btn]")?.getAttribute("data-test-action")).toBe(
			"mark-unread",
		);
	});

	it("asks the same question from the reader, from one panel both controls open", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await readerWithTwoQueues(harness);

		const doc = parse((await agent.get(`/queue/${articleId}/view`)).text);
		const rendered = panels(doc);
		const [panel] = rendered;
		assert(panel, "the reader must render its confirmation panel");

		expect(rendered).toHaveLength(1);
		expect(panel.parentElement?.tagName).toBe("MAIN");
		expect(panel.querySelector(".confirm-popover__body")?.textContent).toBe(
			"This article will be marked as read in all queues it belongs to:",
		);
		expect(
			[...panel.querySelectorAll(".confirm-popover__items li")].map((li) => li.textContent),
		).toEqual(["My Queue", "New Queue"]);
		const triggers = [...doc.querySelectorAll(".article-body__confirm-trigger")];
		expect(triggers).not.toHaveLength(0);
		for (const trigger of triggers) {
			expect(trigger.getAttribute("popovertarget")).toBe(panel.getAttribute("id"));
			expect(trigger.getAttribute("type")).toBe("button");
		}
		const fallback = doc.querySelector("[data-test-mark-read-btn]");
		assert(fallback, "the reader must keep its plain mark-read form");
		expect(fallback.getAttribute("data-test-action")).toBe("mark-read-fallback");
		expect(fallback.closest("form")?.classList.contains("article-body__mark-read-fallback")).toBe(
			true,
		);
	});

	it("leaves the confirmation out of the polled card fragment", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await readerWithTwoQueues(harness);
		const listing = parse((await agent.get("/queue?feature=queues")).text);
		const pageTarget = listing
			.querySelector("[data-test-action='mark-read']")
			?.getAttribute("popovertarget");

		const fragment = parse((await agent.get(`/queue/${articleId}/card?poll=2&feature=queues`)).text);

		expect(
			fragment.querySelector("[data-test-action='mark-read']")?.getAttribute("popovertarget"),
		).toBe(pageTarget);
		expect(panels(fragment)).toHaveLength(0);
	});
});
