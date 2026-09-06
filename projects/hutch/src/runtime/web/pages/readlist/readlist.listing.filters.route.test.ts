import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import type { RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";

const useApp = useTestServer();

describe("Readlist routes", () => {
	describe("POST /queue/save with existing article (skip freshness)", () => {
		it("should save user-article relationship without re-fetching", async () => {
			const skipFreshness: RefreshArticleIfStale = async () => ({ action: "skip" });
			const harness = useApp({
				...createDefaultTestAppFixture(TEST_APP_ORIGIN),
				freshness: { refreshArticleIfStale: skipFreshness },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue#latest-saved");
		});

		it("should save for unchanged content (304)", async () => {
			const unchangedFreshness: RefreshArticleIfStale = async () => ({ action: "unchanged" });
			const harness = useApp({
				...createDefaultTestAppFixture(TEST_APP_ORIGIN),
				freshness: { refreshArticleIfStale: unchangedFreshness },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			expect(response.status).toBe(303);
		});

		it("should publish LinkSaved event for refreshed content", async () => {
			let linkSavedPublished = false;
			const refreshedFreshness: RefreshArticleIfStale = async () => ({
				action: "refreshed",
				article: {
					ok: true as const,
					article: {
						title: "Refreshed",
						siteName: "example.com",
						excerpt: "Refreshed excerpt",
						wordCount: 100,
						content: "<p>New content</p>",
					},
				},
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					publishLinkSaved: async () => { linkSavedPublished = true; },
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
					publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
				freshness: { refreshArticleIfStale: refreshedFreshness },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			expect(response.status).toBe(303);
			expect(linkSavedPublished).toBe(true);
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
			expect(unreadTab?.textContent).toBe("To Read (2)");

			const counts = await agent.get("/queue/counts");
			const countsDoc = new JSDOM(counts.text).window.document;
			expect(countsDoc.getElementById("readlist-unread-label--default")?.textContent).toBe("To Read (2)");
		});

		it("should show unread count when viewing read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/1" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/2" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/3" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .readlist-article")?.getAttribute("data-test-article");
			await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

			const readResponse = await agent.get("/queue?status=read");
			const readDoc = new JSDOM(readResponse.text).window.document;
			const unreadTab = readDoc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To Read");

			const counts = await agent.get("/queue/counts?tab=done");
			const countsDoc = new JSDOM(counts.text).window.document;
			expect(countsDoc.getElementById("readlist-unread-label--default")?.textContent).toBe("To Read (2)");
		});

		it("should not show count on the Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const readTab = doc.querySelector('[data-test-filter="read"]');
			expect(readTab?.textContent).toBe("Read");
		});

		it("should show zero unread count on empty readlist", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const unreadTab = doc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To Read (0)");

			const counts = await agent.get("/queue/counts");
			const countsDoc = new JSDOM(counts.text).window.document;
			expect(countsDoc.getElementById("readlist-unread-label--default")?.textContent).toBe("To Read (0)");
		});

		it("should leave the unread tab uncounted at first byte when the queue spills past one page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			for (let i = 0; i < 21; i++) {
				await agent.post("/queue/save").type("form").send({ url: `https://example.com/page-${i}` });
			}

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const unreadTab = doc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To Read");
		});
	});

	describe("Status tab switch in-flight targets", () => {
		function inFlightTargets(doc: Document, tab: Element): Element[] {
			const nav = tab.closest("[data-test-filters]");
			assert(nav, "the pressed tab must sit inside the filters nav");
			const indicator = nav.getAttribute("hx-indicator");
			assert(indicator, "the filters nav must name where a tab switch paints its in-flight state");

			return indicator.split(",").flatMap((part) => {
				const selector = part.trim();
				if (selector.startsWith("closest ")) {
					const resolved = tab.closest(selector.slice("closest ".length));
					assert(resolved, `the pressed tab must resolve its "${selector}" in-flight target`);
					return [resolved];
				}
				return Array.from(doc.querySelectorAll(selector));
			});
		}

		it("should resolve the tabs' in-flight marker to the strip, the pressed tab and the page's only listing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/1" });

			for (const { path, pressed, content } of [
				{ path: "/queue", pressed: "read", content: "[data-test-article]" },
				{ path: "/queue?tab=done", pressed: "unread", content: "[data-test-empty-readlist]" },
			]) {
				const doc = new JSDOM((await agent.get(path)).text).window.document;
				const tab = doc.querySelector(`[data-test-filter="${pressed}"]`);
				assert(tab, `the ${pressed} tab must be rendered on ${path}`);

				const targets = inFlightTargets(doc, tab);
				expect(targets.map((el) => el.classList[0])).toEqual([
					"readlist__filters",
					"readlist__filter-link",
					"readlist__listing",
				]);
				expect(targets[1]).toBe(tab);
				expect(doc.querySelectorAll(".readlist__listing")).toHaveLength(1);

				const listing = targets[2];
				assert(listing, "the listing must be one of the in-flight targets");
				const shown = doc.querySelector(content);
				assert(shown, `${path} must render ${content} for the veil to cover`);
				expect(listing.contains(shown)).toBe(true);
			}
		});

		it("should make the status tabs' nav the only carrier of an in-flight marker", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/1" });

			for (const path of ["/queue", "/queue?tab=done"]) {
				const doc = new JSDOM((await agent.get(path)).text).window.document;
				const carriers = Array.from(doc.querySelectorAll("[hx-indicator]")).map((el) =>
					el.getAttribute("aria-label"),
				);
				expect(carriers).toEqual(["Article filters"]);
			}
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
			expect(doc.querySelector("form.readlist__import-form")).toBeNull();
			expect(doc.querySelector('[data-test-form="import-file"]')).toBeNull();
		});
	});
});
