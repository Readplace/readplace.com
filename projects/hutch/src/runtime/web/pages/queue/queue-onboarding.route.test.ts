import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { COOKIE_NAME, COOKIE_VALUE, DISMISS_COOKIE_NAME } from "@packages/onboarding-extension-signal";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import { createTestApp, type TestAppResult } from "../../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "../../../test-app-fakes";

async function loginAgent(app: TestAppResult['app'], auth: TestAppResult['auth']) {
	await auth.createUser({ email: "test@example.com", password: "password123" });
	const agent = request.agent(app);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });
	return agent;
}

describe("Queue onboarding", () => {
	it("shows onboarding visible with both steps incomplete on empty queue", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent.get("/queue");

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(installStep, "install-extension step must be rendered");
		expect(installStep.getAttribute("data-test-onboarding-complete")).toBe("false");

		const saveFirstStep = doc.querySelector('[data-test-onboarding-step="save-first-article"]');
		assert(saveFirstStep, "save-first-article step must be rendered");
		expect(saveFirstStep.getAttribute("data-test-onboarding-complete")).toBe("false");
	});

	it("keeps onboarding visible after saving an article when extension cookie is absent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(installStep);
		expect(installStep.getAttribute("data-test-onboarding-complete")).toBe("false");

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-first-article"]');
		assert(saveStep);
		expect(saveStep.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("marks install-extension complete when extension cookie is present", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const step = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		assert(step, "install-extension step must be rendered");
		expect(step.getAttribute("data-test-onboarding-complete")).toBe("true");
	});

	it("shows success message when both extension cookie and saved article are present", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		const response = await agent
			.get("/queue")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
		expect(success.querySelector(".onboarding__success-title")?.textContent).toMatch(/You did it!/);
	});

	it("shows 'Install the Chrome browser extension' for Chrome user-agent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install the Chrome browser extension");
	});

	it("shows 'Install the Firefox browser extension' for Firefox user-agent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install the Firefox browser extension");
	});

	it("shows 'Install a browser extension' for unrecognised user-agent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "curl/8.0");

		const doc = new JSDOM(response.text).window.document;
		const title = doc.querySelector('[data-test-onboarding-step="install-extension"] .onboarding__step-title');
		assert(title);
		expect(title.textContent).toBe("Install a browser extension");
	});

	it("shows success state even when viewing an empty filter tab", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article-on-unread-tab" });

		const response = await agent
			.get("/queue?status=read")
			.set("Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
	});

	it("does not render onboarding when dismiss cookie matches current version", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		expect(onboarding).toBeNull();
	});

	it("re-renders onboarding when dismiss cookie has a stale version", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("Cookie", `${DISMISS_COOKIE_NAME}=stale-version`);

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must re-render when cookie version is stale");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);
	});

	it("hides install-extension step for iPhone user-agent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1");

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must still be rendered");
		expect(onboarding.classList.contains("onboarding--visible")).toBe(true);

		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		expect(installStep).toBeNull();

		const saveStep = doc.querySelector('[data-test-onboarding-step="save-first-article"]');
		assert(saveStep, "save step must remain on mobile");
	});

	it("hides install-extension step for Android Chrome user-agent", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36");

		const doc = new JSDOM(response.text).window.document;
		const installStep = doc.querySelector('[data-test-onboarding-step="install-extension"]');
		expect(installStep).toBeNull();
	});

	it("shows the success state on mobile after a single save", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		const response = await agent
			.get("/queue")
			.set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1");

		const doc = new JSDOM(response.text).window.document;
		const onboarding = doc.querySelector("[data-test-onboarding]");
		assert(onboarding, "onboarding container must be rendered");
		expect(onboarding.classList.contains("onboarding--complete")).toBe(true);

		const success = doc.querySelector("[data-test-onboarding-success]");
		assert(success, "success section must be rendered");
	});

	it("POST /queue/dismiss-onboarding sets dismiss cookie to current version and redirects to /queue", async () => {
		const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(app, auth);

		const response = await agent.post("/queue/dismiss-onboarding");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const cookies = response.headers["set-cookie"];
		assert(cookies, "set-cookie header must be present");
		const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
		expect(cookieStr).toContain(`${DISMISS_COOKIE_NAME}=${ONBOARDING_VERSION}`);
	});
});
