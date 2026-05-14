import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

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
		it("should redirect to login with return URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/save?url=https://example.com/article");

			expect(response.status).toBe(303);
			const location = response.headers.location;
			expect(location).toContain("/login");
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

	describe("login round-trip", () => {
		it("should carry URL through login and redirect to queue with url", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });
			const agent = request.agent(harness.server);

			const saveResponse = await agent.get("/save?url=https://example.com/article");
			expect(saveResponse.status).toBe(303);
			const loginRedirect = saveResponse.headers.location;
			expect(loginRedirect).toContain("/login");
			expect(loginRedirect).toContain("return=");

			const returnParam = decodeURIComponent(loginRedirect.split("return=")[1]);
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

		it("preserves the full originalUrl (utm included) in the /login return param", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/save?url=https://example.com/article&utm_source=medium");

			expect(response.status).toBe(303);
			const location = response.headers.location;
			expect(location.startsWith("/login")).toBe(true);
			const returnParam = new URL(`http://localhost${location}`).searchParams.get("return");
			expect(returnParam).toBe("/save?url=https://example.com/article&utm_source=medium");
		});
	});
});
