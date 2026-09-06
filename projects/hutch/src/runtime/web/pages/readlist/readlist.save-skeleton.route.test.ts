import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function skeletonIn(doc: Document): Element {
	const el = doc.querySelector("[data-test-save-skeleton]");
	assert(el, "the listing must always carry the save skeleton so htmx has something to reveal");
	return el;
}

function skeletonOf(html: string): Element {
	return skeletonIn(documentOf(html));
}

describe("GET /queue save skeleton", () => {
	it("reveals through the save form's own request indicator", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		const doc = documentOf(response.text);
		const form = doc.querySelector('[data-test-form="save-article"]');
		assert(form, "the save form must render on the All queue");
		expect(form.getAttribute("hx-indicator")).toBe("closest form, .readlist-save-skeleton");
		expect(doc.querySelectorAll(".readlist-save-skeleton").length).toBe(1);
		expect(skeletonOf(response.text).getAttribute("aria-hidden")).toBe("true");
	});

	it("is armed above the empty first-save state so the first save has a row to land in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		const doc = documentOf(response.text);
		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "a fresh queue must render the empty state");
		const skeleton = skeletonIn(doc);
		expect(skeleton.classList.contains("readlist-save-skeleton--armed")).toBe(true);
		expect(skeleton.previousElementSibling?.classList.contains("readlist__sort")).toBe(true);
		expect(skeleton.nextElementSibling).toBe(empty);
	});

	it("is armed above the cards once the All queue holds articles", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });

		const response = await agent.get("/queue");

		const doc = documentOf(response.text);
		const list = doc.querySelector("[data-test-article-list]");
		assert(list, "a populated queue must render the article list");
		const skeleton = skeletonIn(doc);
		expect(skeleton.classList.contains("readlist-save-skeleton--armed")).toBe(true);
		expect(skeleton.nextElementSibling).toBe(list);
	});

	it("stays inert on the Read tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue?tab=done");

		expect(skeletonOf(response.text).classList.contains("readlist-save-skeleton--inert")).toBe(true);
	});

	it("stays inert oldest-first", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue?order=asc");

		expect(skeletonOf(response.text).classList.contains("readlist-save-skeleton--inert")).toBe(true);
	});

	it("stays inert past the first page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		for (let i = 0; i < 21; i++) {
			await agent.post("/queue/save").type("form").send({ url: `https://example.com/p-${i}` });
		}

		const response = await agent.get("/queue?page=2");

		expect(response.status).toBe(200);
		expect(skeletonOf(response.text).classList.contains("readlist-save-skeleton--inert")).toBe(true);
	});

	it("stays inert on a readlist the save bar does not post to", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const created = await agent.post("/queue/queues");
		const location = created.headers.location;
		assert(location, "creating a readlist must redirect onto it");

		const response = await agent.get(location);

		const doc = documentOf(response.text);
		const skeleton = doc.querySelector("[data-test-save-skeleton]");
		assert(skeleton, "the skeleton renders on every readlist");
		expect(skeleton.classList.contains("readlist-save-skeleton--inert")).toBe(true);
		const form = doc.querySelector('[data-test-form="save-article"]');
		assert(form, "the save form is present but hidden on a reader-made readlist");
		expect(form.className).toContain("readlist__save-form--hidden");
	});

	it("stays inert when access is read-only", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const agent = await loginAgent(harness.server, harness.auth);
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the logged-in test user must exist");
		await subscriptionProviders.upsertActive({
			userId: user.userId,
			subscriptionId: "sub_ro",
			customerId: "cus_ro",
		});
		await subscriptionProviders.markCancelledByUserId({ userId: user.userId });

		const response = await agent.get("/queue");

		const doc = documentOf(response.text);
		expect(skeletonOf(response.text).classList.contains("readlist-save-skeleton--inert")).toBe(true);
		const form = doc.querySelector('[data-test-form="save-article"]');
		assert(form, "the save form renders disabled for a read-only reader");
		expect(form.className).toContain("readlist__save-form--disabled");
	});
});

describe("GET /queue save error surfaced from the save redirect", () => {
	const cases = [
		{ code: "malformed_url", message: "Please enter a valid URL" },
		{ code: "unsupported_scheme", message: "Only http and https URLs can be saved" },
		{ code: "private_network", message: "Private-network and loopback addresses can't be saved" },
	] as const;

	for (const { code, message } of cases) {
		it(`renders the pill with code ${code} and asks htmx not to scroll it away`, async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get(`/queue?error_code=${code}`);

			expect(response.status).toBe(200);
			expect(response.headers["hx-reswap"]).toBe("outerHTML show:none");
			const pill = documentOf(response.text).querySelector("[data-test-save-error]");
			assert(pill, "the page the redirect lands on must render the error pill");
			expect(pill.textContent).toBe(message);
			expect(pill.getAttribute("data-test-saveable-url-code")).toBe(code);
		});
	}

	it("sends no HX-Reswap header on a plain listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(response.headers["hx-reswap"]).toBeUndefined();
	});
});
