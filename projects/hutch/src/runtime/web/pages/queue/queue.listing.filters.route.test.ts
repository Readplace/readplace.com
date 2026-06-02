import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema } from "@packages/domain/article";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import type { PublishStaleCheckRequested } from "@packages/test-fixtures/providers/events";

const useApp = useTestServer();

const cachedRow = {
	metadata: { title: "Cached", siteName: "example.com", excerpt: "Cached", wordCount: 100 },
	estimatedReadTime: MinutesSchema.parse(1),
};

describe("Queue routes", () => {
	describe("POST /queue/save with an already-cached article", () => {
		it("saves the user-article relationship and redirects without re-fetching", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, auth);
			await articleStore.saveArticleGlobally({
				url: "https://example.com/existing",
				...cachedRow,
				savedAt: new Date(),
			});

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue#latest-saved");
		});

		it("delegates the content refresh to the stale-check Lambda instead of publishing LinkSaved", async () => {
			const staleChecksRequested: Parameters<PublishStaleCheckRequested>[0][] = [];
			let linkSavedPublished = false;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishLinkSaved: async () => { linkSavedPublished = true; },
					publishStaleCheckRequested: async (p) => { staleChecksRequested.push(p); },
				},
			});
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, auth);
			await articleStore.saveArticleGlobally({
				url: "https://example.com/existing",
				...cachedRow,
				savedAt: new Date(),
			});

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			expect(response.status).toBe(303);
			expect(staleChecksRequested).toEqual([{ url: "https://example.com/existing" }]);
			expect(linkSavedPublished).toBe(false);
		});
	});

	describe("Unread tab count", () => {
		it("should show unread count on the Unread tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/1" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/2" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const unreadTab = doc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To read (2)");
		});

		it("should show unread count when viewing read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/1" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/2" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/3" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .queue-article")?.getAttribute("data-test-article");
			await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

			const readResponse = await agent.get("/queue?status=read");
			const readDoc = new JSDOM(readResponse.text).window.document;
			const unreadTab = readDoc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To read (2)");
		});

		it("should not show count on the Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const readTab = doc.querySelector('[data-test-filter="read"]');
			expect(readTab?.textContent).toBe("Done");
		});

		it("should show zero unread count on empty queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const unreadTab = doc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To read (0)");
		});
	});

	describe("CORS for browser extensions", () => {
		it("should allow requests from browser extensions", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.get("/queue")
				.set("Origin", "moz-extension://abc123");

			expect(response.status).toBe(200);
			expect(response.headers["access-control-allow-origin"]).toBe("moz-extension://abc123");
		});

		it("should allow requests from the legacy hutch-app.com origin", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.get("/queue")
				.set("Origin", "https://hutch-app.com");

			expect(response.status).toBe(200);
			expect(response.headers["access-control-allow-origin"]).toBe("https://hutch-app.com");
		});

		it("should reject requests from non-extension origins", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.options("/queue")
				.set("Origin", "https://evil.com")
				.set("Access-Control-Request-Method", "GET");

			expect(response.headers["access-control-allow-origin"]).toBeUndefined();
		});
	});

	describe("GET /queue?url=", () => {
		it("should pre-fill save input and add auto-submit attribute", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue?url=https%3A%2F%2Fexample.com%2Farticle");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector('[data-test-form="save-article"]');
			expect(form?.hasAttribute("data-auto-submit")).toBe(true);
			const input = form?.querySelector('input[name="url"]');
			expect(input?.getAttribute("value")).toBe("https://example.com/article");
		});

		it("should include auto-submit script", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue?url=https%3A%2F%2Fexample.com%2Farticle");

			expect(response.text).toContain("data-auto-submit");
			expect(response.text).toContain("requestSubmit");
		});

		it("should not add auto-submit when url is absent", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector('[data-test-form="save-article"]');
			expect(form?.hasAttribute("data-auto-submit")).toBe(false);
			const input = form?.querySelector('input[name="url"]');
			expect(input?.getAttribute("value")).toBe("");
		});
	});

	describe("GET /queue Import Links nav", () => {
		it("surfaces the Import Links nav item and does not render the upload form on /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const navButton = doc.querySelector('[data-test-nav-item="import"]');
			assert(navButton, "Import Links nav item must be rendered for authenticated users");
			const navForm = navButton.closest("form");
			assert(navForm, "Import Links nav item must be wrapped in a form");
			const navAction = navForm.getAttribute("action");
			assert(navAction, "Import Links nav item form must have an action");
			expect(new URL(navAction, "https://readplace.com").pathname).toBe("/import");
			expect(doc.querySelector("form.queue__import-form")).toBeNull();
			expect(doc.querySelector('[data-test-form="import-file"]')).toBeNull();
		});
	});
});
