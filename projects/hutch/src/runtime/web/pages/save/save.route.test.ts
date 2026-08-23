import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent, BROWSER_REQUEST_HEADERS } from "../../../test-app";
import type { ViewSaveIntentEvent } from "@packages/web-analytics";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const GOOGLEBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";
const READPLACE_IOS = "Readplace/94 CFNetwork/3860.700.1 Darwin/25.6.0";

function saveIntents(harness: { analytics: { events: Array<{ event: string }> } }): ViewSaveIntentEvent[] {
	return harness.analytics.events.filter(
		(e): e is ViewSaveIntentEvent => e.event === "view_save_intent",
	);
}

const useApp = useTestServer();

describe("Save routes", () => {
	describe("GET /save (no url, unauthenticated)", () => {
		it("should render an error page with a meta refresh to home", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/save");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toMatch(/text\/html/);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			assert(meta, "meta refresh must be rendered");
			expect(meta.getAttribute("content")).toBe("5;url=/");
		});

		it("should show a fallback link to home", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/save");
			const doc = new JSDOM(response.text).window.document;
			const link = doc.querySelector(".save-error__link");
			assert(link, "fallback link must be rendered");
			expect(link.getAttribute("href")).toBe("/");
		});
	});

	describe("GET /save (no url, authenticated)", () => {
		it("should render an error page with a meta refresh to queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const response = await agent.get("/save");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toMatch(/text\/html/);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			assert(meta, "meta refresh must be rendered");
			expect(meta.getAttribute("content")).toBe("5;url=/queue");
		});

		it("should show a fallback link to queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const response = await agent.get("/save");
			const doc = new JSDOM(response.text).window.document;
			const link = doc.querySelector(".save-error__link");
			assert(link, "fallback link must be rendered");
			expect(link.getAttribute("href")).toBe("/queue");
		});

		it("should display the countdown seconds", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const response = await agent.get("/save");
			const doc = new JSDOM(response.text).window.document;
			const countdown = doc.querySelector(".save-error__seconds");
			assert(countdown, "countdown element must be rendered");
			expect(countdown.textContent).toBe("5");
		});
	});

	describe("GET /save?url=invalid", () => {
		it("should render an error page for an invalid URL when unauthenticated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/save?url=not-a-url");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toMatch(/text\/html/);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			assert(meta, "meta refresh must be rendered");
			expect(meta.getAttribute("content")).toBe("5;url=/");
		});

		it("should render an error page for an invalid URL when authenticated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const response = await agent.get("/save?url=not-a-url");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toMatch(/text\/html/);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			assert(meta, "meta refresh must be rendered");
			expect(meta.getAttribute("content")).toBe("5;url=/queue");
		});
	});

	describe("GET /save with Referer but no url param", () => {
		it("should ignore the Referer and render the error page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const response = await agent
				.get("/save")
				.set("Referer", "https://publisher.com/article-1");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toMatch(/text\/html/);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			assert(meta, "meta refresh must be rendered");
			expect(meta.getAttribute("content")).toBe("5;url=/queue");
		});
	});

	describe("GET /save?url=https://example.com (unauthenticated)", () => {
		it("should redirect to signup with return URL — an anonymous saver is almost always a new visitor, so the account-creation page converts the intent far better than the sign-in page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/save?url=https://example.com/article");

			expect(response.status).toBe(303);
			const location = response.headers.location;
			expect(location.startsWith("/signup")).toBe(true);
			expect(location).toContain("return=");
			const returnUrl = decodeURIComponent(location.split("return=")[1]);
			expect(returnUrl).toBe("/save?url=https://example.com/article");
		});
	});

	describe("GET /save?url=https://example.com (authenticated)", () => {
		it("should redirect to queue with url", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/save?url=https://example.com/article");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?url=https%3A%2F%2Fexample.com%2Farticle");
		});
	});

	describe("returning-user round-trip via login", () => {
		it("still carries the URL back to the queue for an existing user who reaches sign-in from the signup page (the return param round-trips through login unchanged)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });
			const agent = request.agent(harness.server);

			const saveResponse = await agent.get("/save?url=https://example.com/article");
			expect(saveResponse.status).toBe(303);
			const signupRedirect = saveResponse.headers.location;
			expect(signupRedirect.startsWith("/signup")).toBe(true);
			expect(signupRedirect).toContain("return=");

			// An existing user follows the "Already have an account? Sign in" link,
			// which preserves the return param, then logs in.
			const returnParam = decodeURIComponent(signupRedirect.split("return=")[1]);
			await agent
				.post(`/login?return=${encodeURIComponent(returnParam)}`)
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			const postLoginResponse = await agent.get(returnParam);
			expect(postLoginResponse.status).toBe(303);
			expect(postLoginResponse.headers.location).toBe("/queue?url=https%3A%2F%2Fexample.com%2Farticle");
		});
	});

	describe("utm_* passthrough", () => {
		it("forwards utm_* params on the authenticated /queue redirect", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/save?url=https://example.com/article&utm_source=medium&utm_campaign=spring");

			expect(response.status).toBe(303);
			const parsed = new URL(response.headers.location, "http://localhost");
			expect(parsed.pathname).toBe("/queue");
			expect(parsed.searchParams.get("url")).toBe("https://example.com/article");
			expect(parsed.searchParams.get("utm_source")).toBe("medium");
			expect(parsed.searchParams.get("utm_campaign")).toBe("spring");
		});

		it("drops non-utm query params from the /queue redirect", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/save?url=https://example.com/article&foo=bar&utm_source=twitter");

			expect(response.status).toBe(303);
			const parsed = new URL(response.headers.location, "http://localhost");
			expect(parsed.searchParams.get("foo")).toBeNull();
			expect(parsed.searchParams.get("utm_source")).toBe("twitter");
		});

		it("preserves the full originalUrl (utm included) in the /signup return param", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/save?url=https://example.com/article&utm_source=medium");

			expect(response.status).toBe(303);
			const location = response.headers.location;
			expect(location.startsWith("/signup")).toBe(true);
			const returnParam = new URL(`http://localhost${location}`).searchParams.get("return");
			expect(returnParam).toBe("/save?url=https://example.com/article&utm_source=medium");
		});
	});

	describe("view_save_intent analytics emission", () => {
		it("emits one view_save_intent for an anonymous save click before redirecting to /signup — the warmest funnel moment, now routed to account creation instead of the sign-in page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.get("/save?url=https://example.com/article")
				.set(BROWSER_REQUEST_HEADERS);

			expect(response.status).toBe(303);
			const intents = saveIntents(harness);
			assert.equal(intents.length, 1, "exactly one view_save_intent");
			expect(intents[0]).toMatchObject({
				stream: "analytics",
				event: "view_save_intent",
				path: "/save",
				article_host: "example.com",
				content_class: "third_party",
				surface: "reader_view",
				outcome: "prompted_to_sign_up",
				is_authenticated: 0,
			});
			expect(typeof intents[0].visitor_id).toBe("string");
			expect(typeof intents[0].visitor_hash).toBe("string");
			expect(typeof intents[0].pending_save_id).toBe("string");
		});

		it("mints a pending-save cookie carrying the same id as the event so the blocked save links to the eventual signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.get("/save?url=https://example.com/article")
				.set(BROWSER_REQUEST_HEADERS);

			const setCookieHeader: string | string[] = response.headers["set-cookie"];
			const setCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
			const pendingCookie = setCookies.find((c) => c.startsWith("hutch_psid="));
			assert(pendingCookie, "a hutch_psid cookie must be set");
			const cookieValue = decodeURIComponent(pendingCookie.split(";")[0].split("=")[1]);
			expect(cookieValue).toBe(saveIntents(harness)[0].pending_save_id);
		});

		it("classifies a save of our own content (readplace.com) as own", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await request(harness.server)
				.get("/save?url=https://readplace.com/blog/something")
				.set(BROWSER_REQUEST_HEADERS);

			expect(saveIntents(harness)[0]).toMatchObject({ article_host: "readplace.com", content_class: "own" });
		});

		it("classifies by the article's own domain, not the referrer: an own-domain referrer saving a third-party article is still a third-party save", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await request(harness.server)
				.get("/save?url=https://example.com/article")
				.set({ ...BROWSER_REQUEST_HEADERS, Referer: "https://readplace.com/some/reader/page" });

			expect(saveIntents(harness)[0]).toMatchObject({
				article_host: "example.com",
				content_class: "third_party",
				referrer_host: "readplace.com",
			});
		});

		it("still redirects to signup and still mints the pending-save cookie, but emits no view_save_intent, when the Referer is our own host — only the measurement is gated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.get("/save?url=https://example.com/article")
				.set({ ...BROWSER_REQUEST_HEADERS, Referer: `${TEST_APP_ORIGIN}/view/example.com/article` });

			expect(response.status).toBe(303);
			expect(response.headers.location.startsWith("/signup")).toBe(true);
			const setCookieHeader: string | string[] = response.headers["set-cookie"];
			const setCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
			assert(
				setCookies.find((c) => c.startsWith("hutch_psid=")),
				"the pending-save cookie must still be minted so signup attribution survives",
			);
			assert.equal(saveIntents(harness).length, 0, "no view_save_intent for a self-referring request");
		});

		it("does not emit view_save_intent for a bot user-agent (keeps the funnel free of crawler-followed Save links)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.get("/save?url=https://example.com/article")
				.set({ ...BROWSER_REQUEST_HEADERS, "User-Agent": GOOGLEBOT });

			expect(response.status).toBe(303);
			assert.equal(saveIntents(harness).length, 0, "no view_save_intent for a bot");
		});

		it("mints the pending-save cookie and emits view_save_intent for our own iOS client, whose CFNetwork User-Agent isbot() reports as a crawler", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.get("/save?url=https://example.com/article")
				.set({ "User-Agent": READPLACE_IOS, "Accept-Language": "en-AU,en;q=0.9" });

			expect(response.status).toBe(303);
			expect(response.headers.location.startsWith("/signup")).toBe(true);
			const setCookieHeader: string | string[] = response.headers["set-cookie"];
			const setCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
			assert(
				setCookies.find((c) => c.startsWith("hutch_psid=")),
				"a save from our own app must mint the pending-save cookie so signup attribution survives",
			);
			assert.equal(saveIntents(harness).length, 1, "a save from our own app is a real save intent");
			expect(saveIntents(harness)[0]).toMatchObject({ client: "ios_app" });
		});

		it("records a plain browser save as the web client", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await request(harness.server)
				.get("/save?url=https://example.com/article")
				.set(BROWSER_REQUEST_HEADERS);

			expect(saveIntents(harness)[0]).toMatchObject({ client: "web", surface: "reader_view" });
		});

		it("records a save from the app's in-app web sheet as the iOS client, without moving its surface", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await request(harness.server)
				.get("/save?url=https://example.com/article&shell=app")
				.set(BROWSER_REQUEST_HEADERS);

			expect(saveIntents(harness)[0]).toMatchObject({ client: "ios_app", surface: "reader_view" });
		});

		it("does not emit view_save_intent for an authenticated save (that path goes straight to the queue, not the funnel)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/save?url=https://example.com/article").set(BROWSER_REQUEST_HEADERS);

			expect(response.status).toBe(303);
			assert.equal(saveIntents(harness).length, 0, "no view_save_intent when already authenticated");
		});
	});

	describe("pending-save linkage (signup-blocked save → account creation)", () => {
		it("stamps the same pending_save_id on the blocked view_save_intent and the eventual user_created conversion", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = request.agent(harness.server);

			await agent.get("/save?url=https://example.com/article").set(BROWSER_REQUEST_HEADERS);
			const intent = saveIntents(harness)[0];
			assert(intent.pending_save_id, "the blocked save must mint a pending_save_id");

			const signup = await agent.post("/signup").type("form").send({
				email: "blocked-then-signed-up@example.com",
				password: "password123",
				loadedAt: String(Date.now() - 5000),
			});
			expect(signup.status).toBe(303);

			const conversion = harness.conversions.events.find((e) => e.event === "user_created");
			assert(conversion, "signup must emit a user_created conversion");
			expect(conversion.pending_save_id).toBe(intent.pending_save_id);
		});

		it("clears the pending-save cookie once consumed so a second signup on the same browser cannot inherit the id", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = request.agent(harness.server);

			await agent.get("/save?url=https://example.com/article").set(BROWSER_REQUEST_HEADERS);

			const signup = await agent.post("/signup").type("form").send({
				email: "clears-pending-save@example.com",
				password: "password123",
				loadedAt: String(Date.now() - 5000),
			});
			expect(signup.status).toBe(303);

			const setCookieHeader: string | string[] = signup.headers["set-cookie"];
			const setCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
			const pendingCookieDirective = setCookies.find((c) => c.startsWith("hutch_psid="));
			assert(pendingCookieDirective, "signup must send a hutch_psid clear directive");
			expect(pendingCookieDirective).toMatch(/^hutch_psid=;/);
		});
	});
});
