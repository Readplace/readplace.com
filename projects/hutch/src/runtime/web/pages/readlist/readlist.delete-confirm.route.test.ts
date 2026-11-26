import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

async function saveArticles(
	agent: Awaited<ReturnType<typeof loginAgent>>,
	urls: string[],
): Promise<void> {
	for (const url of urls) {
		await agent.post("/queue/save").type("form").send({ url });
	}
}

function readlistDocument(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("Readlist delete confirmation", () => {
	it("renders one confirmation panel per article, in a container directly under <main>", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/one", "https://example.com/two"]);

		const doc = readlistDocument((await agent.get("/queue")).text);
		const panels = doc.querySelectorAll("[data-test-confirm-popover='delete']");

		expect(panels.length).toBe(2);
		for (const panel of panels) {
			// Page level, not inside the card: a pending card replaces its own
			// subtree every 3s and would rip an open confirmation out mid-decision.
			const container = panel.parentElement;
			expect(container?.classList.contains("article-delete__decisions")).toBe(true);
			expect(container?.parentElement?.tagName).toBe("MAIN");
			expect(container?.parentElement?.hasAttribute("data-test-readlist-page")).toBe(true);
			expect(panel.closest(".readlist-article")).toBeNull();
			expect(panel.getAttribute("popover")).toBe("auto");
			expect(panel.getAttribute("role")).toBe("dialog");
			// popover=auto traps nothing and leaves the page live, so claiming
			// modality to a screen reader would be a lie.
			expect(panel.hasAttribute("aria-modal")).toBe(false);
		}
	});

	it("points every card's trigger at that same card's panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/first", "https://example.com/second"]);

		const doc = readlistDocument((await agent.get("/queue")).text);
		const triggersByArticle = new Map(
			[...doc.querySelectorAll(".readlist-article")].map((card) => [
				card.getAttribute("data-test-article"),
				card.querySelector("[data-test-action='delete']")?.getAttribute("popovertarget"),
			]),
		);
		const panelsByArticle = new Map(
			[...doc.querySelectorAll("[data-test-confirm-popover='delete']")].map((panel) => [
				panel.getAttribute("data-test-confirm-subject"),
				panel.getAttribute("id"),
			]),
		);

		expect(triggersByArticle.size).toBe(2);
		expect(triggersByArticle).toEqual(panelsByArticle);
	});

	it("keeps every popover and heading id unique across the page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, [
			"https://example.com/a",
			"https://example.com/b",
			"https://example.com/c",
		]);

		const doc = readlistDocument((await agent.get("/queue")).text);
		const ids = [
			...doc.querySelectorAll("[data-test-confirm-popover='delete']"),
		].flatMap((panel) => [
			panel.getAttribute("id"),
			panel.querySelector(".confirm-popover__title")?.getAttribute("id"),
		]);

		expect(ids.length).toBe(6);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("labels and describes the panel from its own copy and the article title", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/described"]);

		const doc = readlistDocument((await agent.get("/queue")).text);
		const panel = doc.querySelector("[data-test-confirm-popover='delete']");
		assert(panel, "confirmation panel must be rendered");

		const title = doc.getElementById(panel.getAttribute("aria-labelledby") ?? "");
		assert(title, "aria-labelledby must resolve");
		expect(title.tagName).toBe("H2");
		expect(title.textContent).toBe("Remove this article from this readlist?");

		const [subjectId, bodyId] = (panel.getAttribute("aria-describedby") ?? "").split(" ");
		expect(doc.getElementById(bodyId ?? "")?.textContent).toBe(
			"Removing your last saved copy can permanently delete its highlights and notes. Saving the article again won't restore them.",
		);
		const cardTitle = doc.querySelector("[data-test-article-title]")?.textContent;
		assert(cardTitle, "the card must show its title");
		expect(doc.getElementById(subjectId ?? "")?.textContent).toBe(cardTitle);
	});

	it("puts an in-page question for each article beside the panels, reached from the card's menu by fragment", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/first", "https://example.com/second"]);

		const doc = readlistDocument((await agent.get("/queue")).text);

		const cards = [...doc.querySelectorAll(".readlist-article")];
		expect(cards).toHaveLength(2);
		for (const card of cards) {
			const articleId = card.getAttribute("data-test-article");
			const link = card.querySelector("[data-test-action='delete-fallback']");
			assert(link, "every card must offer the in-page question");
			const href = link.getAttribute("href") ?? "";
			expect(href).toBe(`#confirm-remove-${articleId}`);
			const section = doc.getElementById(href.slice(1));
			assert(section, "the fragment must land on the article's question");
			expect(section.closest(".readlist-article")).toBeNull();
			expect(section.closest("main")).not.toBeNull();
			const cancel = section.querySelector("[data-test-action='delete-fallback-cancel']");
			const returnId = (cancel?.getAttribute("href") ?? "").slice(1);
			expect(doc.getElementById(returnId)).toBe(card.querySelector("[data-test-action='article-menu']"));
			const action = new URL(section.querySelector("form")?.getAttribute("action") ?? "", TEST_APP_ORIGIN);
			expect([action.pathname, action.searchParams.get("utm_source")]).toEqual([`/queue/${articleId}/delete`, "queue-card"]);
		}
	});

	it("posts the delete from inside the panel, preserving the readlist view state", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/done-tab"]);
		const listDoc = readlistDocument((await agent.get("/queue")).text);
		const articleId = listDoc
			.querySelector("[data-test-article-list] .readlist-article")
			?.getAttribute("data-test-article");
		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

		const doc = readlistDocument((await agent.get("/queue?tab=done&order=asc")).text);
		const cta = doc.querySelector("[data-test-action='delete-confirm']");
		assert(cta, "confirm call to action must be rendered");
		expect(cta.textContent).toBe("Delete from this readlist");

		const form = cta.closest("form");
		assert(form, "the confirm call to action must submit a real form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");
		// Not readlist-article__action-form: that class carries the status toggle's
		// in-flight loader machinery and is counted by the listing route test.
		expect(form.classList.contains("confirm-popover__actions")).toBe(true);
		expect(form.classList.contains("readlist-article__action-form")).toBe(false);

		const action = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(action.pathname).toBe(`/queue/${articleId}/delete`);
		expect(action.searchParams.get("tab")).toBe("done");
		expect(action.searchParams.get("order")).toBe("asc");
		expect(action.searchParams.get("utm_content")).toBe("delete");
	});

	it("offers no close control and lets the auto popover dismiss", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/dismissable"]);

		const doc = readlistDocument((await agent.get("/queue")).text);
		const panel = doc.querySelector("[data-test-confirm-popover='delete']");
		assert(panel, "confirmation panel must be rendered");
		expect(panel.getAttribute("popover")).toBe("auto");
		expect([...panel.querySelectorAll(".confirm-popover__header [data-test-action]")].map((action) => action.getAttribute("data-test-action"))).toEqual([]);
	});

	it("keeps asking after a plain deletion", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/one", "https://example.com/two"]);
		const listDoc = readlistDocument((await agent.get("/queue")).text);
		const [articleId] = [...listDoc.querySelectorAll(".readlist-article")].map((card) =>
			card.getAttribute("data-test-article"),
		);

		await agent.post(`/queue/${articleId}/delete`).type("form").send({});

		const doc = readlistDocument((await agent.get("/queue")).text);
		expect(doc.querySelectorAll("[data-test-confirm-popover='delete']").length).toBe(1);
	});

	it("deletes and silences the panel for good on the second button", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/one", "https://example.com/two"]);
		const listDoc = readlistDocument((await agent.get("/queue")).text);
		const [articleId] = [...listDoc.querySelectorAll(".readlist-article")].map((card) =>
			card.getAttribute("data-test-article"),
		);

		await agent.post(`/queue/${articleId}/delete`).type("form").send({ ack: "never" });

		const doc = readlistDocument((await agent.get("/queue")).text);
		const remaining = [...doc.querySelectorAll(".readlist-article")].map((card) =>
			card.getAttribute("data-test-article"),
		);
		expect(remaining).toHaveLength(1);
		expect(remaining).not.toContain(articleId);
		expect(doc.querySelectorAll("[data-test-confirm-popover='delete']").length).toBe(0);

		// The card's Delete control has to become the real mutation, or the reader
		// is left with a button whose popover no longer exists.
		const control = doc.querySelector("[data-test-action='delete']");
		assert(control, "the delete control must survive the acknowledgement");
		expect(control.getAttribute("type")).toBe("submit");
		expect(control.closest("form")?.getAttribute("method")).toBe("POST");
	});

	it("keeps the panel out of a polled card fragment once acknowledged", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/one", "https://example.com/two"]);
		const listDoc = readlistDocument((await agent.get("/queue")).text);
		const [first, second] = [...listDoc.querySelectorAll(".readlist-article")].map((card) =>
			card.getAttribute("data-test-article"),
		);
		await agent.post(`/queue/${first}/delete`).type("form").send({ ack: "never" });

		const fragment = readlistDocument((await agent.get(`/queue/${second}/card?poll=2`)).text);

		const control = fragment.querySelector("[data-test-action='delete']");
		assert(control, "the polled fragment must keep its delete control");
		expect(control.hasAttribute("popovertarget")).toBe(false);
		expect(control.getAttribute("type")).toBe("submit");
		const retired = fragment.getElementById(`readlist-delete-decisions-${second}`);
		assert(retired, "the fragment must retire the card's now-obsolete decisions");
		expect(retired.getAttribute("hx-swap-oob")).toBe("innerHTML");
		expect(retired.innerHTML).toBe("");
	});

	it("leaves the confirmation out of the polled card fragment", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/polled"]);
		const listDoc = readlistDocument((await agent.get("/queue")).text);
		const card = listDoc.querySelector("[data-test-article-list] .readlist-article");
		const articleId = card?.getAttribute("data-test-article");
		const pageTarget = card
			?.querySelector("[data-test-action='delete']")
			?.getAttribute("popovertarget");

		const fragment = readlistDocument((await agent.get(`/queue/${articleId}/card?poll=2`)).text);

		expect(
			fragment.querySelector("[data-test-action='delete']")?.getAttribute("popovertarget"),
		).toBe(pageTarget);
		// A panel in the fragment would duplicate the id, win tree-order
		// resolution, and then be destroyed by the next 3s poll.
		expect(fragment.querySelectorAll("[data-test-confirm-popover='delete']").length).toBe(0);
		// The open decision's nodes stay in place while the card refreshes.
		expect(fragment.querySelectorAll("[hx-swap-oob]").length).toBe(0);
	});

	it("retires a card's decisions when a status change removes just that card", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveArticles(agent, ["https://example.com/one", "https://example.com/two"]);
		const page = readlistDocument((await agent.get("/queue")).text);
		const [articleId, otherId] = [...page.querySelectorAll(".readlist-article")].map((card) =>
			card.getAttribute("data-test-article"),
		);

		const response = await agent
			.post(`/queue/${articleId}/status?swap=card`)
			.set("HX-Request", "true")
			.type("form")
			.send({ status: "read" });

		const fragment = readlistDocument(`<main>${response.text}</main>`);
		const retired = fragment.getElementById(`readlist-delete-decisions-${articleId}`);
		assert(retired, "the response must address the removed card's decisions");
		expect(retired.getAttribute("hx-swap-oob")).toBe("innerHTML");
		expect(retired.innerHTML).toBe("");
		expect(fragment.getElementById(`readlist-delete-decisions-${otherId}`)).toBeNull();
		expect(page.getElementById(`readlist-delete-decisions-${articleId}`)).not.toBeNull();
	});
});
